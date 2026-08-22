import { render } from 'preact'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { NO_CHECK, type CountCheck } from '../src/count'
import { startEngine, type TriageRow, type TriageState } from '../src/engine'
import { applyHiding, revealAll } from '../src/hide/apply'
import type { HideVerdict } from '../src/hide/policy'
import { forgetSessionFindings } from '../src/panel/actions'
import { App } from '../src/panel/App'
import { badges, emptyState, keptReason, listedRows, unreadCount } from '../src/panel/rows'
import { DEFAULT_PREFS } from '../src/prefs'
import type { Finding, Thread, ThreadAuthors } from '../src/types'
import { loadFixture } from './support/fixture'

const PR_URL = 'https://github.com/owner/repo/pull/1'

beforeAll(() => {
  ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(PR_URL)
})

/**
 * What GitHub rendered inside the thread, which is what every action reaches
 * for.
 *
 *   'none'        no form at all: a reader who cannot write to the repository
 *   'resolve'     an open thread with the resolve form
 *   'unresolve'   a resolved thread, expanded, with the unresolve form
 *   'collapsed'   a resolved thread nobody has expanded: a toggle and no form
 *
 * All four are states of one page, not of one reader. 'collapsed' is the one
 * B4 turned up: the unresolve form does not exist until the thread is expanded,
 * verified on a repository the reader can write to. See `unresolveThread`.
 */
type ThreadShape = 'none' | 'resolve' | 'unresolve' | 'collapsed'

const THREAD_MARKUP: Record<ThreadShape, string> = {
  none: '',
  resolve:
    '<form action="/owner/repo/pull/1/threads/1/resolve" method="post">' +
    '<button type="submit">Resolve conversation</button></form>',
  unresolve:
    '<button data-action="click:review-thread-collapsible#toggle" aria-expanded="true" type="button"></button>' +
    '<form action="/owner/repo/pull/1/threads/1/unresolve" method="post">' +
    '<button type="submit">Unresolve conversation</button></form>',
  collapsed:
    '<button data-action="click:review-thread-collapsible#toggle" aria-expanded="false" type="button"></button>',
}

/**
 * A real element per row, in the real document, because the actions reach into
 * the page through it and the title reads its hidden state back off it.
 *
 * Appended rather than left detached so `applyHiding` can own the whole hidden
 * set the way it does on a page: a class it cannot find is a class it cannot
 * take off again.
 */
function threadEl(shape: ThreadShape): Element {
  const el = document.createElement('review-thread-collapsible')
  el.innerHTML = THREAD_MARKUP[shape]
  for (const form of el.querySelectorAll('form')) {
    form.addEventListener('submit', (event) => event.preventDefault())
  }
  document.body.append(el)
  threadEls.push(el)
  return el
}

const threadEls: Element[] = []

/**
 * A row built by hand. The defaults describe the case the drawer exists for: a
 * readable, unresolved, fully CodeRabbit finding that was hidden, so every case
 * below is that row with one thing changed.
 */
function row(over: {
  thread?: Partial<Thread>
  authors?: Partial<ThreadAuthors> | null
  finding?: Partial<Finding> | null
  verdict?: HideVerdict
  /** Give the thread GitHub's resolve form, which most readers never see. */
  resolvable?: boolean
  /** Or one of the other three shapes; overrides `resolvable` when given. */
  shape?: ThreadShape
} = {}): TriageRow {
  const authors: ThreadAuthors | null =
    over.authors === null
      ? null
      : {
          comments: 1,
          fromCodeRabbit: 1,
          fromHumans: 0,
          pending: 0,
          allFromCodeRabbit: true,
          rootIsCodeRabbit: true,
          ...over.authors,
        }

  return {
    thread: {
      el: threadEl(over.shape ?? (over.resolvable === true ? 'resolve' : 'none')),
      timelineItem: null,
      id: '1',
      file: 'src/app.ts',
      resolved: false,
      outdated: false,
      collapsed: false,
      deferredUrl: null,
      authors,
      problems: [],
      ...over.thread,
    },
    finding:
      over.finding === null
        ? null
        : {
            title: 'Guard against a null user',
            category: 'Potential issue',
            severity: 'major',
            effort: '~10 minutes',
            aiPrompt: null,
            permalink: null,
            ...over.finding,
          },
    verdict: over.verdict ?? { hide: true },
  }
}

const kept = (reason: Exclude<HideVerdict, { hide: true }>['reason']): HideVerdict => ({
  hide: false,
  reason,
})

/** A check that is warning: CodeRabbit said `claimed` and the page holds `found`. */
const short = (claimed: number, found: number): CountCheck => ({
  claimed,
  found,
  missing: Math.max(0, claimed - found),
})

/**
 * A published state, and the page that goes with it.
 *
 * The hiding is applied here because a pass applies it before it publishes:
 * `verdict.hide` and the class on the element are one fact in the engine, and a
 * harness where they disagree would let a row claim in a test to be in the
 * timeline when the panel would never show it that way.
 */
function stateOf(rows: TriageRow[], over: Partial<TriageState> = {}): TriageState {
  const threads = rows.map((r) => r.thread)
  const hidden = rows.filter((r) => r.verdict.hide)

  applyHiding(
    hidden.map((r) => r.thread.el),
    document,
  )

  return {
    kind: 'classic',
    threads,
    rows,
    notes: [],
    hidden: new Set(hidden.map((r) => r.thread.id)),
    // Quiet by default: a page with no summary makes no claim, so every case
    // below that does not name a check is a page the check has nothing to say
    // about. The cases that want it firing pass their own.
    check: NO_CHECK,
    counts: {
      total: threads.length,
      unresolved: threads.filter((t) => !t.resolved).length,
      hidden: hidden.length,
      unparsed: rows.filter(
        (r) => !r.verdict.hide && (r.verdict.reason === 'unparsed' || r.verdict.reason === 'fetch-failed'),
      ).length,
    },
    // Overridden by the cases that assert the drawer asks for the fetch.
    readResolved: () => {},
    // The defaults, so every case below draws a safe mode drawer sorted by
    // severity unless it says otherwise, and no case writes to storage.
    prefs: DEFAULT_PREFS,
    setPrefs: () => {},
    ...over,
  }
}

const hosts: HTMLElement[] = []

afterEach(() => {
  while (hosts.length > 0) {
    const host = hosts.pop()
    if (host) {
      render(null, host)
      host.remove()
    }
  }
  // Resolving in one case must not leave a row listed in the next, and neither
  // must a hidden thread or a reveal of one.
  forgetSessionFindings()
  revealAll(document)
  while (threadEls.length > 0) threadEls.pop()?.remove()
  vi.restoreAllMocks()
})

function mount(state: TriageState): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  hosts.push(host)
  render(<App state={state} />, host)
  return host
}

/** Preact renders a state change on a microtask, so a click has to settle. */
async function click(host: HTMLElement, selector: string): Promise<void> {
  host.querySelector<HTMLElement>(selector)?.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Open the drawer, which is what every case below the handle's own starts with. */
async function open(host: HTMLElement): Promise<HTMLElement> {
  await click(host, '.handle')
  return host
}

/** The number on the closed handle, which is the worklist and not the page. */
const handleCount = (host: HTMLElement): string | null =>
  host.querySelector('.handle-count')?.textContent ?? null

/**
 * Reach an action that now lives behind the row's ⋯ rather than beside it.
 * Opening the menu is part of the action, so every case says so once.
 */
async function fromMenu(host: HTMLElement, selector: string): Promise<void> {
  await click(host, '.icon.more')
  await click(host, selector)
}

describe('listedRows', () => {
  it('lists a hidden finding, because a row is the only place it still exists', () => {
    expect(listedRows(stateOf([row()]))).toHaveLength(1)
  })

  it.each(['human-activity', 'pending', 'unparsed'] as const)(
    'lists a finding kept in the timeline for %s',
    (reason) => {
      expect(listedRows(stateOf([row({ verdict: kept(reason) })]))).toHaveLength(1)
    },
  )

  it('leaves out a thread that is provably not CodeRabbit s', () => {
    expect(listedRows(stateOf([row({ verdict: kept('not-coderabbit') })]))).toEqual([])
  })

  it('leaves out a collapsed thread and counts it instead', () => {
    const state = stateOf([row({ thread: { collapsed: true, resolved: true }, verdict: kept('collapsed') })])

    expect(listedRows(state)).toEqual([])
    expect(unreadCount(state)).toBe(1)
  })
})

describe('emptyState', () => {
  function empty(state: TriageState) {
    return emptyState(state, listedRows(state))
  }

  it.each(['react', 'unknown'] as const)('says a %s build could not be read', (kind) => {
    expect(empty(stateOf([], { kind }))).toBe('unsupported')
  })

  it('says there are no findings only when nothing at all was found', () => {
    expect(empty(stateOf([]))).toBe('no-findings')
  })

  // The distinction invariant 3 is about: a page whose threads could not be
  // read is never reported as a page with nothing on it.
  it('does not say "no findings" when there are threads it could not read', () => {
    expect(empty(stateOf([row({ verdict: kept('collapsed') })]))).toBe('all-done')
  })

  it('says the work is done when every listed finding is resolved', () => {
    expect(empty(stateOf([row({ thread: { resolved: true } })]))).toBe('all-done')
  })

  it('says nothing at all while there is work left', () => {
    expect(empty(stateOf([row()]))).toBeNull()
  })
})

describe('badges', () => {
  it('is empty on a plain open finding', () => {
    expect(badges(row())).toEqual([])
  })

  it('reports resolved, outdated, pending, a human reply and an unreadable thread', () => {
    expect(badges(row({ thread: { resolved: true } }))).toContain('Resolved')
    expect(badges(row({ thread: { outdated: true } }))).toContain('Outdated')
    expect(badges(row({ authors: { comments: 2, fromHumans: 1, pending: 1 } }))).toContain('Pending')
    expect(badges(row({ authors: { comments: 2, fromHumans: 1, allFromCodeRabbit: false } }))).toContain('Human reply')
    expect(badges(row({ authors: null, verdict: kept('unparsed') }))).toContain('Unparsed')
  })

  // Your own unsubmitted comment counts as human authorship, so without the
  // subtraction one draft would light both badges and read as a conversation.
  it('does not call your own pending comment a human reply', () => {
    expect(badges(row({ authors: { comments: 2, fromHumans: 1, pending: 1 } }))).not.toContain('Human reply')
  })
})

describe('keptReason', () => {
  it('is null on a hidden finding', () => {
    expect(keptReason(row())).toBeNull()
  })

  it('names the reason on every kept finding', () => {
    for (const reason of ['human-activity', 'pending', 'unparsed', 'collapsed', 'not-coderabbit'] as const) {
      expect(keptReason(row({ verdict: kept(reason) }))).toContain('Left in the timeline')
    }
  })
})

describe('the panel', () => {
  it('shows the handle and no drawer until it is clicked', () => {
    const host = mount(stateOf([row(), row({ thread: { id: '2' } })]))

    expect(handleCount(host)).toBe('2')
    expect(host.querySelector('.drawer')).toBeNull()
  })

  it('counts the worklist rather than every unresolved thread on the page', () => {
    const host = mount(stateOf([row(), row({ thread: { id: '2' }, verdict: kept('not-coderabbit') })]))

    expect(handleCount(host)).toBe('1')
  })

  /**
   * The tab is a meter as well as a count, so three blockers and ten nitpicks
   * do not read alike from across the screen. A finding with no severity is
   * still a segment, or the parts would add up to less than the number.
   */
  it('breaks the count down by severity, worst first, on the handle', () => {
    const host = mount(
      stateOf([
        row({ thread: { id: '1' }, finding: { severity: 'trivial' } }),
        row({ thread: { id: '2' }, finding: { severity: 'critical' } }),
        row({ thread: { id: '3' }, finding: { severity: 'critical' } }),
        row({ thread: { id: '4' }, finding: { severity: null } }),
      ]),
    )

    expect([...host.querySelectorAll('.meter-part')].map((p) => p.className)).toEqual([
      'meter-part critical',
      'meter-part trivial',
      'meter-part none',
    ])
    expect(host.querySelector('.handle-title')?.textContent).toBe('4 open findings')
    expect([...host.querySelectorAll('.handle-part')].map((p) => p.textContent)).toEqual([
      '2 critical',
      '1 trivial',
      '1 none',
    ])
  })

  it('opens on the handle and closes again on either control', async () => {
    const host = mount(stateOf([row()]))

    await click(host, '.handle')
    expect(host.querySelector('.drawer')).not.toBeNull()
    expect(host.querySelector('.tab.open')?.textContent).toContain('1')

    await click(host, '.close')
    expect(host.querySelector('.drawer')).toBeNull()

    // Open, the handle is the thin collapse tab on the drawer's own edge, and
    // it is the same button doing the same job from the other side.
    await click(host, '.handle')
    expect(host.querySelector('.handle')?.classList.contains('collapsed')).toBe(true)
    await click(host, '.handle')
    expect(host.querySelector('.drawer')).toBeNull()
  })

  it('warns on the handle when a build cannot be read, and says so in the drawer', async () => {
    const host = mount(stateOf([], { kind: 'react' }))

    expect(host.querySelector('.handle')?.classList.contains('warn')).toBe(true)

    await click(host, '.handle')
    expect(host.querySelector('.empty-title')?.textContent).toBe('This page could not be read')
  })

  it('warns on the handle when a thread could not be read', async () => {
    const host = mount(stateOf([row({ authors: null, verdict: kept('unparsed') })]))

    expect(host.querySelector('.handle')?.classList.contains('warn')).toBe(true)

    await click(host, '.handle')
    expect(host.querySelector('.notice.warn')?.textContent).toContain('1 thread could not be read')
  })

  it('warns on the handle when the page holds fewer findings than CodeRabbit posted', async () => {
    const host = mount(stateOf([row()], { check: short(27, 3) }))

    expect(host.querySelector('.handle')?.classList.contains('warn')).toBe(true)
    expect(host.querySelector('.handle')?.getAttribute('title')).toContain('24 not in the page')
  })

  it('names both numbers at the top of the drawer', async () => {
    const host = mount(stateOf([row()], { check: short(27, 3) }))
    await click(host, '.handle')

    const notice = host.querySelector('.notice.warn')
    expect(notice?.textContent).toContain('CodeRabbit posted 27 findings')
    expect(notice?.textContent).toContain('3 are in this page')
  })

  it('does not warn when the page holds more findings than the total', async () => {
    const host = mount(stateOf([row()], { check: { claimed: 102, found: 103, missing: 0 } }))

    expect(host.querySelector('.handle')?.classList.contains('warn')).toBe(false)
    await click(host, '.handle')
    expect(host.querySelector('.notice.warn')).toBeNull()
  })

  /**
   * The reassuring sentence and its correction must never share a drawer. With
   * the check warning there is nothing on the page to conclude anything from,
   * so the empty state says nothing and the warning speaks alone.
   */
  it('does not claim "no findings" over a page that is not all here', async () => {
    const host = mount(stateOf([], { check: short(27, 0) }))
    await click(host, '.handle')

    expect(host.querySelector('.empty-title')).toBeNull()
    expect(host.querySelector('.notice.warn')?.textContent).toContain('CodeRabbit posted 27 findings')
  })

  it('does not claim "nothing left to do" over one either', async () => {
    const host = mount(stateOf([row({ thread: { resolved: true } })], { check: short(27, 1) }))
    await click(host, '.handle')

    expect(host.querySelector('.empty-title')).toBeNull()
  })

  it('draws a row per finding, with its severity, title, file and badges', async () => {
    const host = mount(stateOf([row({ thread: { outdated: true } })]))
    await click(host, '.handle')

    const listed = host.querySelector('.row')
    // Under the severity headings the heading is the colour, so the row does
    // not repeat it. See the case below for the axes that do not group.
    expect(host.querySelector('.group-toggle .dot')?.classList.contains('major')).toBe(true)
    expect(listed?.querySelector('.dot')).toBeNull()
    expect(listed?.querySelector('.row-title')?.textContent).toBe('Guard against a null user')
    expect(listed?.querySelector('.row-file')?.textContent).toBe('app.ts')
    expect(listed?.querySelector('.pill-cat')?.textContent).toBe('Potential issue')
    expect(listed?.querySelector('.pill-effort')?.textContent).toBe('~10 minutes')
    expect([...listed!.querySelectorAll('.badge')].map((b) => b.textContent)).toEqual(['Outdated'])
  })

  /**
   * Category and effort are two halves of CodeRabbit's own first line, so they
   * are drawn as one outline with a rule between them rather than as two lines
   * of the row. The dot is the category's hue, which is the only place a
   * category is a colour anywhere on the panel.
   */
  it('draws the category and the effort as one pill', async () => {
    const host = await open(
      mount(stateOf([row({ finding: { category: 'Security & Privacy', effort: 'Quick win' } })])),
    )

    const pill = host.querySelector('.pill')
    expect(pill?.querySelector('.pill-dot')?.classList.contains('security')).toBe(true)
    expect(pill?.querySelector('.pill-cat')?.textContent).toBe('Security')
    expect(pill?.querySelector('.pill-rule')).not.toBeNull()
    expect(pill?.querySelector('.pill-effort')?.textContent).toBe('Quick win')
  })

  /**
   * The pill prints one word where CodeRabbit wrote a clause, so the clause it
   * dropped has to stay within reach. Same bargain the file name makes on the
   * line above: shortened on the row, whole on the tooltip.
   */
  it('keeps the whole category on the pill tooltip', async () => {
    const host = await open(
      mount(stateOf([row({ finding: { category: 'Maintainability & Code Quality' } })])),
    )

    expect(host.querySelector('.pill-cat')?.textContent).toBe('Maintainability')

    host.querySelector<HTMLElement>('.pill-cat')?.dispatchEvent(new FocusEvent('focus'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(host.querySelector('.tip')?.textContent).toBe('Maintainability & Code Quality')
  })

  /**
   * A category this panel has no hue and no short word for is still CodeRabbit's
   * own word for the finding, so it prints entire and draws in the grey the
   * words beside it are. And a label that dropped nothing gets no tooltip, which
   * would only repeat what is already on the row.
   */
  it('prints an unmapped category in full, with no hue and no tooltip', async () => {
    const host = await open(
      mount(stateOf([row({ finding: { category: 'Refactor suggestion' } })])),
    )

    expect(host.querySelector('.pill-dot')?.className).toBe('pill-dot')
    expect(host.querySelector('.pill-cat')?.textContent).toBe('Refactor suggestion')

    host.querySelector<HTMLElement>('.pill-cat')?.dispatchEvent(new FocusEvent('focus'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(host.querySelector('.tip')).toBeNull()
  })

  /**
   * The triple's three parts move together in `parseTriple`, so half a pill is
   * not a shape the page produces. It is still a shape the type allows, and a
   * rule dividing one word from nothing would be a divider with one side.
   */
  it('draws no rule when only one half of the pill is there', async () => {
    const only = (finding: { category?: string | null; effort?: string | null }) =>
      open(mount(stateOf([row({ finding })])))

    const noEffort = await only({ effort: null })
    expect(noEffort.querySelector('.pill-rule')).toBeNull()
    expect(noEffort.querySelector('.pill-effort')).toBeNull()

    const noCategory = await only({ category: null })
    expect(noCategory.querySelector('.pill-rule')).toBeNull()
    expect(noCategory.querySelector('.pill-dot')).toBeNull()
    expect(noCategory.querySelector('.pill-effort')?.textContent).toBe('~10 minutes')
  })

  /**
   * The directories above a finding are the same for everything near it and do
   * not fit on a 404 pixel row. The name is what a reader recognises, and the
   * whole path is on the tooltip, so nothing is merely truncated away.
   */
  it('names the file and keeps the whole path on the row', async () => {
    const deep = 'app/Domain/Docs/Repositories/CachedDocsRepository.php'
    const host = mount(stateOf([row({ thread: { file: deep } })]))
    await click(host, '.handle')

    expect(host.querySelector('.row-file')?.textContent).toBe('CachedDocsRepository.php')

    const file = host.querySelector<HTMLElement>('.row-file')
    file?.dispatchEvent(new FocusEvent('focus'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(host.querySelector('.tip')?.textContent).toBe(deep)
  })

  /**
   * A tooltip is centred on the control it names, so the tick box at the
   * drawer's left edge puts half of one past that edge and over the collapse
   * tab. The tab is painted above the drawer, and the drawer's own z-index
   * makes it a stacking context, so a tooltip rendered inside the drawer would
   * sit behind the tab whatever number it carried. It is drawn beside the
   * drawer instead. See `Tips` in `overlay.ts`.
   */
  it('draws the tooltip outside the drawer, where the collapse tab cannot cover it', async () => {
    const host = await open(mount(stateOf([row()])))

    host.querySelector<HTMLElement>('.check')?.dispatchEvent(new FocusEvent('focus'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const tip = host.querySelector('.tip')
    expect(tip?.textContent).toBe('Resolve issue')
    expect(host.querySelector('.drawer')?.contains(tip)).toBe(false)
  })

  /**
   * The dot is the only place a severity appears on an axis that does not group
   * by it, so dropping it outright would lose what the heading was carrying.
   */
  it('puts the dot back on the row when the heading is not the colour', async () => {
    const host = await open(mount(stateOf([row()])))

    await click(host, '.sort-button')
    host.querySelectorAll<HTMLElement>('.sort-option')[1].click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(host.querySelector('.group-toggle')).toBeNull()
    expect(host.querySelector('.row .dot')?.classList.contains('major')).toBe(true)
  })

  it('marks a finding with no severity rather than leaving it blank', async () => {
    const host = mount(stateOf([row({ finding: { severity: null, category: null, effort: null } })]))
    await click(host, '.handle')

    expect(host.querySelector('.group-label')?.textContent).toBe('No severity stated')
    expect(host.querySelector('.group-toggle .dot')?.classList.contains('none')).toBe(true)
    expect(host.querySelector('.row-pill')).toBeNull()

    // And on an axis with no headings the row says it, in its own words.
    await click(host, '.sort-button')
    host.querySelectorAll<HTMLElement>('.sort-option')[1].click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const dot = host.querySelector('.row .dot')
    expect(dot?.classList.contains('none')).toBe(true)
    expect(dot?.getAttribute('aria-label')).toBe('Severity: not stated')
  })

  // Without this a reader who sees a CodeRabbit comment still in the timeline
  // cannot tell a deliberate exception from a broken extension.
  it('says why a finding is still in the timeline, and says nothing when it was hidden', async () => {
    const host = mount(stateOf([row({ verdict: kept('human-activity') }), row({ thread: { id: '2' } })]))
    await click(host, '.handle')

    const reasons = [...host.querySelectorAll('.row-reason')].map((p) => p.textContent)
    expect(reasons).toEqual(['Left in the timeline: someone replied to it'])
  })

  it('admits to the resolved threads it has not read back yet', async () => {
    const host = mount(stateOf([row(), row({ thread: { id: '2', resolved: true }, verdict: kept('collapsed') })]))
    await click(host, '.handle')

    expect(host.querySelector('.rows')?.children).toHaveLength(1)
    expect(host.textContent).toContain('Reading 1 resolved thread from GitHub')
  })

  // The other half of that, and the rule B3 exists for: a thread the fetch
  // could not read is never one of the ones quietly left off the list.
  it('lists a thread the fetch could not read, badged and counted', async () => {
    const host = mount(
      stateOf([row({ thread: { id: '2', resolved: true, collapsed: true }, authors: null, finding: null, verdict: kept('fetch-failed') })]),
    )
    await click(host, '.handle')
    // Resolved, so it is under the Resolved tab, which is where a thread whose
    // comments could not be fetched still has to be findable.
    await click(host, '.tab.resolved')

    expect(host.querySelector('.rows')?.children).toHaveLength(1)
    expect([...host.querySelectorAll('.badge')].map((b) => b.textContent)).toContain('Unfetched')
    expect(host.textContent).toContain('Left in the timeline: resolved, and its comments could not be fetched')
    expect(host.textContent).toContain('1 thread could not be read')
    expect(host.textContent).not.toContain('Reading')
  })

  // Lazy on panel open, per [[Design decisions]]. The drawer is the only thing
  // that ever asks, so a reader who never opens it costs GitHub nothing.
  it('asks for the resolved threads only once the drawer is open', async () => {
    const readResolved = vi.fn()
    const host = mount(stateOf([row()], { readResolved }))

    expect(readResolved).not.toHaveBeenCalled()

    await click(host, '.handle')
    expect(readResolved).toHaveBeenCalled()
  })

  it('tells "no findings" and "nothing left to do" apart', async () => {
    const nothing = mount(stateOf([]))
    await click(nothing, '.handle')
    expect(nothing.querySelector('.empty-title')?.textContent).toBe('No CodeRabbit findings')

    const done = mount(stateOf([row({ thread: { resolved: true } })]))
    await click(done, '.handle')
    expect(done.querySelector('.empty-title')?.textContent).toBe('Nothing left to do')
  })

  // The rule for this step, and the shape B3 needs: a fetched thread will
  // arrive as HTML from the network and must still reach the screen as text.
  it('renders the page s text as text and never as markup', async () => {
    const host = mount(stateOf([row({ finding: { title: '<img src=x onerror=boom> and <b>bold</b>' } })]))
    await click(host, '.handle')

    expect(host.querySelector('.row-title')?.textContent).toBe('<img src=x onerror=boom> and <b>bold</b>')
    expect(host.querySelectorAll('img')).toHaveLength(0)
    expect(host.querySelectorAll('b')).toHaveLength(0)
  })
})

/**
 * The picker and the headings, which is B6 as the reader meets it. What each
 * axis orders by is `sort.test.ts`; this is only that the drawer offers all
 * five, both directions, and puts a heading over the three that group.
 */
describe('the sort picker', () => {
  /** Choose an axis the way a reader does, and let preact settle the render. */
  async function sortBy(host: HTMLElement, axis: string): Promise<void> {
    if (host.querySelector('.sort-menu') === null) await click(host, '.sort-button')

    const option = [...host.querySelectorAll<HTMLElement>('.sort-option')].find(
      (button) => button.querySelector('.sort-option-label')?.textContent === axis,
    )
    if (option === undefined) throw new Error(`The picker offers no ${axis} axis`)

    option.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const headings = (host: HTMLElement): string[] =>
    [...host.querySelectorAll('.group-label')].map((h) => h.textContent ?? '')

  const titles = (host: HTMLElement): string[] =>
    [...host.querySelectorAll('.row-title')].map((p) => p.textContent ?? '')

  /** Three open findings that differ on every axis the picker offers. */
  function everything(): TriageRow[] {
    return [
      row({
        thread: { id: '1', file: 'z.ts' },
        finding: { title: 'trivial', severity: 'trivial', category: 'Security & Privacy', effort: 'Heavy lift' },
      }),
      row({
        thread: { id: '2', file: 'a.ts' },
        finding: { title: 'major', severity: 'major', category: 'Functional Correctness', effort: 'Quick win' },
      }),
      row({
        thread: { id: '3', file: 'm.ts' },
        finding: { title: 'critical', severity: 'critical', category: 'Functional Correctness', effort: 'Low value' },
      }),
    ]
  }

  it('offers all four axes, severity first, each with its hint', async () => {
    const host = await open(mount(stateOf([row()])))
    await click(host, '.sort-button')

    expect(
      [...host.querySelectorAll('.sort-menu-body .sort-option-label')].map((o) => o.textContent),
    ).toEqual(['Severity', 'File', 'Category', 'Effort'])
    expect([...host.querySelectorAll('.sort-option-hint')].map((o) => o.textContent)).toEqual([
      'default',
      'a–z',
      'grouped',
      'quick wins',
    ])
  })

  it('names the axis in force on the button and ticks it in the menu', async () => {
    const host = await open(mount(stateOf([row()])))

    expect(host.querySelector('.sort-button')?.textContent).toContain('Sort: Severity')

    await click(host, '.sort-button')
    expect(host.querySelector('.sort-option.on .sort-option-label')?.textContent).toBe('Severity')
  })

  it('shuts the menu on a pick', async () => {
    const host = await open(mount(stateOf([row()])))
    await sortBy(host, 'File')

    expect(host.querySelector('.sort-menu')).toBeNull()
    expect(host.querySelector('.sort-button')?.textContent).toContain('Sort: File')
  })

  it('opens on severity, worst first, headed by CodeRabbit s own words', async () => {
    const host = await open(mount(stateOf(everything())))

    expect(titles(host)).toEqual(['critical', 'major', 'trivial'])
    expect(headings(host)).toEqual(['Critical', 'Major', 'Trivial'])
  })

  it('reorders when the reader picks another axis', async () => {
    const host = await open(mount(stateOf(everything())))
    await sortBy(host, 'Effort')

    expect(titles(host)).toEqual(['major', 'trivial', 'critical'])
    expect(headings(host)).toEqual([])
  })

  it('heads each category, because a flat list sorted by category reads as noise', async () => {
    const host = await open(mount(stateOf(everything())))
    await sortBy(host, 'Category')

    expect(headings(host)).toEqual(['Functional Correctness', 'Security & Privacy'])
    expect(titles(host)).toEqual(['critical', 'major', 'trivial'])
  })

  it('says so rather than leaving a heading blank when the category is missing', async () => {
    const host = await open(
      mount(stateOf([row({ finding: { category: null, severity: null, effort: null } })])),
    )
    await sortBy(host, 'Category')

    expect(headings(host)).toEqual(['No category stated'])
  })

  /**
   * The direction is spelled out per axis, because "descending" means nothing
   * on a worklist: the reader is choosing between quick wins and heavy lifts.
   */
  it('names the direction in the axis own words, and turns the list round', async () => {
    const host = await open(mount(stateOf(everything())))
    await click(host, '.sort-button')

    expect(host.querySelector('.sort-direction')?.textContent).toContain('Most important first')

    await click(host, '.sort-direction')
    expect(titles(host)).toEqual(['trivial', 'major', 'critical'])
    expect(headings(host)).toEqual(['Trivial', 'Major', 'Critical'])

    await sortBy(host, 'Effort')
    await click(host, '.sort-button')
    expect(host.querySelector('.sort-direction')?.textContent).toContain('Heavy lifts first')
  })

  /**
   * A folded group is a reader putting ten nitpicks out of the way to work the
   * three blockers, so the rows go and the heading and its count stay.
   */
  it('folds a group shut on its heading, and opens it again', async () => {
    const host = await open(mount(stateOf(everything())))

    expect(host.querySelectorAll('.row')).toHaveLength(3)
    expect(host.querySelector('.group-count')?.textContent).toBe('1')

    await click(host, '.group-toggle')
    expect(host.querySelectorAll('.row')).toHaveLength(2)
    expect(host.querySelector('.group-count')?.textContent).toBe('1')

    await click(host, '.group-toggle')
    expect(host.querySelectorAll('.row')).toHaveLength(3)
  })

  it('draws no picker over a page it could not read', async () => {
    const host = await open(mount(stateOf([], { kind: 'react' })))

    expect(host.querySelector('.sort-button')).toBeNull()
  })
})

/**
 * The two halves of the worklist. A resolved finding leaves the Open tab only
 * once GitHub says it is resolved, which is the same rule the strikethrough
 * follows: a click moves nothing.
 */
describe('the tabs', () => {
  const both = (): TriageRow[] => [
    row({ thread: { id: '1' } }),
    row({ thread: { id: '2', resolved: true } }),
    row({ thread: { id: '3', resolved: true } }),
  ]

  it('counts each half and opens on the work', async () => {
    const host = await open(mount(stateOf(both())))

    expect(host.querySelector('.tab.open')?.textContent).toBe('Open 1')
    expect(host.querySelector('.tab.resolved')?.textContent).toBe('Resolved 2')
    expect(host.querySelector('.tab.open')?.getAttribute('aria-selected')).toBe('true')
    expect(host.querySelectorAll('.row')).toHaveLength(1)
  })

  it('shows the finished ones, struck through, under the other tab', async () => {
    const host = await open(mount(stateOf(both())))
    await click(host, '.tab.resolved')

    expect(host.querySelectorAll('.row')).toHaveLength(2)
    expect([...host.querySelectorAll('.row')].every((r) => r.classList.contains('done'))).toBe(true)
  })

  it('says which half is empty rather than drawing nothing', async () => {
    const host = await open(mount(stateOf([row()])))
    await click(host, '.tab.resolved')

    expect(host.querySelector('.empty-note')?.textContent).toContain('Nothing resolved')
  })

  /**
   * Invariant 3 again: "nothing left to do" is a claim about the whole page, so
   * it never appears beside a Resolved tab that is listing the rows it is
   * talking about.
   */
  it('keeps the whole page claims on the Open tab', async () => {
    const host = await open(mount(stateOf([row({ thread: { resolved: true } })])))

    expect(host.querySelector('.empty-title')?.textContent).toBe('Nothing left to do')

    await click(host, '.tab.resolved')
    expect(host.querySelector('.empty-title')).toBeNull()
    expect(host.querySelectorAll('.row')).toHaveLength(1)
  })
})

/**
 * The footer, which is the only place the worklist says how far down it the
 * reader is. It counts both tabs, because progress is over the review and not
 * over whichever half is showing.
 */
describe('the progress footer', () => {
  it('counts the resolved against every listed finding', async () => {
    const host = await open(
      mount(
        stateOf([
          row({ thread: { id: '1' } }),
          row({ thread: { id: '2', resolved: true } }),
          row({ thread: { id: '3', resolved: true } }),
          row({ thread: { id: '4', resolved: true } }),
        ]),
      ),
    )

    expect(host.querySelector('.progress-label')?.textContent).toBe('3 of 4 resolved')
    expect(host.querySelector<HTMLElement>('.progress-bar')?.style.width).toBe('75%')
  })

  it('says nothing rather than "0 of 0" over a page with no findings', async () => {
    const host = await open(mount(stateOf([])))

    expect(host.querySelector('.progress-label')?.textContent).toBe('Nothing to work through')
  })

  it('draws no footer over a page it could not read', async () => {
    const host = await open(mount(stateOf([], { kind: 'react' })))

    expect(host.querySelector('.drawer-foot')).toBeNull()
  })
})

/**
 * The preferences as the reader meets them: the two controls on the settings
 * sheet, and the three choices that are remembered by being used. What is
 * stored, and what happens to a stored value this build does not know, is
 * `prefs.test.ts`.
 */
describe('the preferences', () => {
  /**
   * Both groups are radios on the same sheet, so each is asked for by its own
   * name. Two groups sharing one name would be one group, and picking a theme
   * would clear the hide mode.
   */
  const group = (host: HTMLElement, name: string): HTMLInputElement[] => [
    ...host.querySelectorAll<HTMLInputElement>(`.setting input[name="${name}"]`),
  ]

  const modes = (host: HTMLElement): HTMLInputElement[] => group(host, 'cr-hide-mode')
  const themes = (host: HTMLElement): HTMLInputElement[] => group(host, 'cr-theme')

  /** The mode now lives on a sheet over the worklist, behind the footer's gear. */
  async function settings(state: TriageState): Promise<HTMLElement> {
    const host = await open(mount(state))
    await click(host, '.gear')
    return host
  }

  /** Pick an option the way a reader does, and let preact settle the render. */
  async function choose(
    host: HTMLElement,
    radios: HTMLInputElement[],
    value: string,
  ): Promise<void> {
    const input = radios.find((radio) => radio.value === value)
    if (input === undefined) throw new Error(`The drawer offers no ${value} option`)

    input.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('offers both modes and marks the one in force', async () => {
    const host = await settings(stateOf([row()]))

    expect(modes(host).map((radio) => radio.value)).toEqual(['safe', 'aggressive'])
    expect(modes(host).map((radio) => radio.checked)).toEqual([true, false])
  })

  /**
   * Rendered whether or not it is showing, so it slides rather than appears,
   * and inert while it is off screen so nothing on it can be tabbed into from
   * the worklist behind.
   */
  it('keeps the sheet off screen and out of reach until the gear is pressed', async () => {
    const host = await open(mount(stateOf([row()])))

    expect(host.querySelector('.sheet')?.classList.contains('open')).toBe(false)
    expect(host.querySelector('.sheet')?.hasAttribute('inert')).toBe(true)

    await click(host, '.gear')
    expect(host.querySelector('.sheet')?.classList.contains('open')).toBe(true)
    expect(host.querySelector('.sheet')?.hasAttribute('inert')).toBe(false)

    await click(host, '.back')
    expect(host.querySelector('.sheet')?.classList.contains('open')).toBe(false)
  })

  it('marks aggressive when that is the mode the page was hidden in', async () => {
    const host = await settings(
      stateOf([row()], { prefs: { ...DEFAULT_PREFS, hideMode: 'aggressive' } }),
    )

    expect(modes(host).map((radio) => radio.checked)).toEqual([false, true])
  })

  /**
   * The measurement from [[Design decisions]], next to the toggle rather than
   * behind it. Aggressive mode hides threads a person has replied to, and the
   * reader deciding that is owed the number before the click.
   */
  it('says what aggressive mode costs, in the number that decided the default', async () => {
    const host = await settings(stateOf([row()]))

    const aggressive = host.querySelectorAll('.setting')[1]
    expect(aggressive.textContent).toContain('29 of 36')
  })

  it('asks the engine to switch, rather than deciding anything itself', async () => {
    const setPrefs = vi.fn()
    const host = await settings(stateOf([row()], { setPrefs }))
    await choose(host, modes(host), 'aggressive')

    expect(setPrefs).toHaveBeenCalledWith({ hideMode: 'aggressive' })
  })

  // Nothing was hidden in either mode on a build the extension could not read,
  // so a mode control there would be a claim about a page it did not touch.
  it('offers no mode control on a build that could not be read', async () => {
    const host = await open(mount(stateOf([], { kind: 'react' })))

    expect(host.querySelector('.settings')).toBeNull()
    expect(host.querySelector('.gear')).toBeNull()
  })

  it('offers the three themes and marks the system one until somebody picks', async () => {
    const host = await settings(stateOf([row()]))

    expect(themes(host).map((radio) => radio.value)).toEqual(['auto', 'light', 'dark'])
    expect(themes(host).map((radio) => radio.checked)).toEqual([true, false, false])
    expect(host.querySelector('.panel')?.classList.contains('theme-auto')).toBe(true)
  })

  /**
   * The palette belongs to the whole panel rather than to the drawer, so a
   * reader who never opens the drawer still gets the edge tab they chose.
   */
  it('paints the panel in the remembered theme, with the drawer shut', () => {
    const host = mount(stateOf([row()], { prefs: { ...DEFAULT_PREFS, theme: 'dark' } }))

    expect(host.querySelector('.panel')?.classList.contains('theme-dark')).toBe(true)
    expect(host.querySelector('.drawer')).toBeNull()
  })

  it('marks the remembered theme on the sheet', async () => {
    const host = await settings(stateOf([row()], { prefs: { ...DEFAULT_PREFS, theme: 'light' } }))

    expect(themes(host).map((radio) => radio.checked)).toEqual([false, true, false])
  })

  /**
   * A theme change runs no pass, so no new state is ever published for it. The
   * panel has to repaint on the click itself, which is why `App` holds the
   * theme rather than reading `state.prefs.theme` on each render.
   */
  it('repaints on the click and asks the engine to remember it', async () => {
    const setPrefs = vi.fn()
    const host = await settings(stateOf([row()], { setPrefs }))
    await choose(host, themes(host), 'dark')

    expect(setPrefs).toHaveBeenCalledWith({ theme: 'dark' })
    expect(host.querySelector('.panel')?.classList.contains('theme-dark')).toBe(true)
    expect(host.querySelector('.panel')?.classList.contains('theme-auto')).toBe(false)
  })

  // The sheet is gone on a build the extension could not read, along with every
  // other claim about the page, but the panel it draws is still the reader's.
  it('keeps the chosen theme on a build it could not read', async () => {
    const host = await open(
      mount(stateOf([], { kind: 'react', prefs: { ...DEFAULT_PREFS, theme: 'dark' } })),
    )

    expect(host.querySelector('.panel')?.classList.contains('theme-dark')).toBe(true)
    expect(host.querySelector('.gear')).toBeNull()
  })

  it('opens with the drawer already open when that is what was remembered', () => {
    const host = mount(stateOf([row()], { prefs: { ...DEFAULT_PREFS, drawerOpen: true } }))

    expect(host.querySelector('.drawer')).not.toBeNull()
  })

  it('remembers the drawer being opened, and being closed again', async () => {
    const setPrefs = vi.fn()
    const host = mount(stateOf([row()], { setPrefs }))

    await click(host, '.handle')
    expect(setPrefs).toHaveBeenLastCalledWith({ drawerOpen: true })

    await click(host, '.close')
    expect(setPrefs).toHaveBeenLastCalledWith({ drawerOpen: false })
  })

  /** Pick the second axis the way a reader does, through the popover. */
  async function pickFile(host: HTMLElement): Promise<void> {
    await click(host, '.sort-button')
    const option = host.querySelectorAll<HTMLElement>('.sort-option')[1]
    option.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('sorts by the remembered axis and direction when the drawer opens', async () => {
    const host = await open(
      mount(
        stateOf([row()], {
          prefs: { ...DEFAULT_PREFS, sortAxis: 'effort', sortLeading: false },
        }),
      ),
    )

    expect(host.querySelector('.sort-button')?.textContent).toContain('Sort: Effort')

    await click(host, '.sort-button')
    expect(host.querySelector('.sort-direction')?.textContent).toContain('Heavy lifts first')
  })

  it('remembers the axis the reader picks', async () => {
    const setPrefs = vi.fn()
    const host = await open(mount(stateOf([row()], { setPrefs })))
    await pickFile(host)

    expect(setPrefs).toHaveBeenCalledWith({ sortAxis: 'file' })
  })

  it('remembers the direction too, because the pair is one choice', async () => {
    const setPrefs = vi.fn()
    const host = await open(mount(stateOf([row()], { setPrefs })))
    await click(host, '.sort-button')
    await click(host, '.sort-direction')

    expect(setPrefs).toHaveBeenCalledWith({ sortLeading: false })
  })

  /**
   * The engine's copy of the prefs changes on every save, and a drawer that
   * read the axis on each render would jump back to the stored one the moment
   * another preference was written. The picked axis outranks the stored one for
   * as long as the drawer is open.
   */
  it('keeps the picked axis when a later pass publishes the stored one', async () => {
    const host = await open(mount(stateOf([row()])))
    await pickFile(host)

    render(<App state={stateOf([row()], { prefs: { ...DEFAULT_PREFS, drawerOpen: true } })} />, host)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(host.querySelector('.sort-button')?.textContent).toContain('Sort: File')
  })
})

describe('the title, which is the timeline toggle', () => {
  const HIDDEN = '.crt-hidden'

  const title = (host: HTMLElement) => host.querySelector<HTMLElement>('.row-title')
  const pressed = (host: HTMLElement) => title(host)?.getAttribute('aria-pressed') ?? null

  /**
   * The reader points at a row and asks to see it on the page, then puts it
   * back. Both halves are one press of the same words, which is why the title
   * is the control rather than a fifth icon nobody has room for.
   */
  it('shows the finding in the timeline and scrolls to it', async () => {
    const one = row()
    const host = await open(mount(stateOf([one])))
    const scroll = vi.spyOn(one.thread.el, 'scrollIntoView')

    expect(one.thread.el.closest(HIDDEN)).not.toBeNull()
    expect(pressed(host)).toBe('false')

    await click(host, '.row-title')

    expect(one.thread.el.closest(HIDDEN)).toBeNull()
    expect(scroll).toHaveBeenCalled()
    expect(pressed(host)).toBe('true')
  })

  it('takes it back out of the timeline on the second press', async () => {
    const one = row()
    const host = await open(mount(stateOf([one])))

    await click(host, '.row-title')
    await click(host, '.row-title')

    expect(one.thread.el.closest(HIDDEN)).not.toBeNull()
    expect(pressed(host)).toBe('false')
  })

  /**
   * Invariant 2 reaches the panel here. A thread kept in the timeline because a
   * human replied to it has only one state to be in, so the title is a scroll
   * and says nothing about being pressed: a switch that cannot flip should not
   * be drawn as one.
   */
  it('is a scroll and not a toggle on a finding the policy kept', async () => {
    const one = row({ verdict: kept('human-activity') })
    const host = await open(mount(stateOf([one])))
    const scroll = vi.spyOn(one.thread.el, 'scrollIntoView')

    expect(pressed(host)).toBeNull()

    await click(host, '.row-title')

    expect(one.thread.el.closest(HIDDEN)).toBeNull()
    expect(scroll).toHaveBeenCalled()
    expect(pressed(host)).toBeNull()
  })

  // The menu item and the title are one action, so the menu reports the state
  // the title is in rather than always offering to show.
  it('is the same action as the menu item, which follows it', async () => {
    const host = await open(mount(stateOf([row()])))

    await click(host, '.icon.more')
    expect(host.querySelector('.menu-item.reveal')?.textContent).toContain(
      'Show it in the timeline',
    )

    await click(host, '.menu-item.reveal')
    expect(pressed(host)).toBe('true')

    await click(host, '.icon.more')
    expect(host.querySelector('.menu-item.reveal')?.textContent).toContain(
      'Hide it from the timeline',
    )
  })

  // A pass owns the hidden set and runs on every mutation of the page, so the
  // one thing a reveal has to survive is the next state the panel is handed.
  it('keeps the finding on the page through the passes that follow', async () => {
    const one = row()
    const host = mount(stateOf([one]))
    await open(host)
    await click(host, '.row-title')

    render(<App state={stateOf([one], { prefs: { ...DEFAULT_PREFS, drawerOpen: true } })} />, host)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(one.thread.el.closest(HIDDEN)).toBeNull()
    expect(pressed(host)).toBe('true')
  })
})

describe('the actions on a row', () => {
  /** Open the drawer and hand back the one row in it. */
  async function drawer(state: TriageState): Promise<HTMLElement> {
    return open(mount(state))
  }

  /** The drawer opens on the work, so a resolved row needs the other tab. */
  async function resolvedTab(state: TriageState): Promise<HTMLElement> {
    const host = await drawer(state)
    await click(host, '.tab.resolved')
    return host
  }

  const status = (host: HTMLElement) => host.querySelector('.row-status')?.textContent ?? null

  const label = (host: HTMLElement, selector: string) =>
    host.querySelector(selector)?.getAttribute('aria-label') ?? null

  /** A menu item without the glyph in front of it. */
  const words = (item: Element): string =>
    [...item.childNodes]
      .filter((node) => !(node instanceof Element && node.classList.contains('menu-icon')))
      .map((node) => node.textContent ?? '')
      .join('')

  /**
   * The tick box and the ⧉ are on the row; everything else is behind the ⋯,
   * because a fourth and a fifth button do not fit across 404 pixels.
   */
  it('offers a tick box, a copy and the rest behind the menu', async () => {
    const host = await drawer(stateOf([row({ resolvable: true })]))

    expect(label(host, '.check')).toBe('Resolve this issue')
    expect(host.querySelector('.check')?.getAttribute('aria-checked')).toBe('false')
    expect(label(host, '.icon.copy')).toBe('Copy agent prompt')
    expect(status(host)).toBeNull()

    await click(host, '.icon.more')
    expect([...host.querySelectorAll('.menu-item')].map(words)).toEqual([
      'Show it in the timeline',
      'Copy agent prompt',
      'Resolve issue',
    ])
  })

  it('swaps resolve for reopen once GitHub calls the thread resolved', async () => {
    const host = await resolvedTab(
      stateOf([row({ thread: { resolved: true }, shape: 'unresolve' })]),
    )

    expect(host.querySelector('.action.resolve')).toBeNull()
    expect(label(host, '.action.unresolve')).toBe('Reopen this issue')
    expect(host.querySelector('.check')?.getAttribute('aria-checked')).toBe('true')
    expect(host.querySelector('.icon.copy')).not.toBeNull()
  })

  /**
   * The row's permalink is the only thing that can name a finding on the Files
   * changed tab, and a pending comment has none. A dead item would be worse
   * than no item.
   */
  it('offers Files changed only when the finding carries a permalink', async () => {
    const withLink = await drawer(stateOf([row({ finding: { permalink: '#discussion_r42' } })]))
    await click(withLink, '.icon.more')
    expect(withLink.querySelector('.menu-item.files')).not.toBeNull()

    const without = await drawer(stateOf([row()]))
    await click(without, '.icon.more')
    expect(without.querySelector('.menu-item.files')).toBeNull()
  })

  it('opens the finding on Files changed in a tab of its own', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    const host = await drawer(stateOf([row({ finding: { permalink: '#discussion_r42' } })]))

    await fromMenu(host, '.menu-item.files')

    expect(opened).toHaveBeenCalledWith(
      'https://github.com/owner/repo/pull/1/files#discussion_r42',
      '_blank',
      'noopener',
    )
  })

  it('shuts the menu on the item that was picked', async () => {
    const host = await drawer(stateOf([row()]))

    await click(host, '.icon.more')
    expect(host.querySelector('.menu')).not.toBeNull()

    await click(host, '.menu-item.reveal')
    expect(host.querySelector('.menu')).toBeNull()
  })

  /**
   * The mirror of the resolve rule, and the same refusal to claim anything: the
   * click is not a done state, so the row waits for a pass to read
   * `data-resolved="false"` off the page and stays struck through until it does.
   */
  it('waits for the engine after an unresolve rather than calling itself open', async () => {
    const host = await resolvedTab(
      stateOf([row({ thread: { resolved: true }, shape: 'unresolve' })]),
    )

    await click(host, '.action.unresolve')

    expect(status(host)).toContain('Unresolving')
    expect(host.querySelector<HTMLButtonElement>('.action.unresolve')?.disabled).toBe(true)
    expect(host.querySelector('.row')?.classList.contains('done')).toBe(true)
  })

  it('finishes when a pass reports the thread open again', async () => {
    const before = row({ thread: { resolved: true }, shape: 'unresolve' })
    const host = await resolvedTab(stateOf([before]))
    await click(host, '.action.unresolve')

    render(
      <App state={stateOf([{ ...before, thread: { ...before.thread, resolved: false } }])} />,
      host,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Open again, so it is back under the Open tab, which is where the reader
    // has just put it and where the work now is.
    expect(host.querySelector('.tab.open')?.textContent).toBe('Open 1')
    expect(host.querySelector('.row')).toBeNull()

    await click(host, '.tab.open')
    expect(status(host)).toBeNull()
    expect(host.querySelector('.row')?.classList.contains('done')).toBe(false)
    expect(host.querySelector('.action.resolve')).not.toBeNull()
  })

  /**
   * B4's verify-first answer, as the reader meets it. GitHub renders no
   * unresolve form on a collapsed thread, so the first press expands and the
   * row says which of the two steps it just took.
   */
  it('expands a collapsed thread first, and says that is what it did', async () => {
    const host = await resolvedTab(
      stateOf([row({ thread: { resolved: true, collapsed: true }, shape: 'collapsed' })]),
    )

    await click(host, '.action.unresolve')

    expect(status(host)).toContain('Press again')
    expect(host.querySelector<HTMLButtonElement>('.action.unresolve')?.disabled).toBe(false)
    expect(host.querySelector('.row')?.classList.contains('done')).toBe(true)
  })

  it('says so when GitHub rendered no unresolve button, and claims nothing', async () => {
    const host = await resolvedTab(stateOf([row({ thread: { resolved: true }, shape: 'none' })]))

    await click(host, '.action.unresolve')

    expect(status(host)).toContain('No unresolve button')
    expect(status(host)).toContain('needs write access')
    expect(host.querySelector('.row')?.classList.contains('done')).toBe(true)
  })

  it('offers the unresolve click again when nothing confirms it', async () => {
    vi.useFakeTimers()
    try {
      const host = mount(stateOf([row({ thread: { resolved: true }, shape: 'unresolve' })]))
      host.querySelector<HTMLElement>('.handle')?.click()
      await vi.advanceTimersByTimeAsync(0)
      host.querySelector<HTMLElement>('.tab.resolved')?.click()
      await vi.advanceTimersByTimeAsync(0)

      host.querySelector<HTMLElement>('.action.unresolve')?.click()
      await vi.advanceTimersByTimeAsync(0)
      expect(status(host)).toContain('Unresolving')

      await vi.advanceTimersByTimeAsync(5_000)

      expect(status(host)).toContain('did not confirm')
      expect(label(host, '.action.unresolve')).toBe('Reopen this issue again')
      expect(host.querySelector<HTMLButtonElement>('.action.unresolve')?.disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // GitHub renders the button for write access rather than for a session, so a
  // reader on a stranger's pull request meets this on every thread.
  it('says so when GitHub rendered no resolve button, and claims nothing', async () => {
    const host = await drawer(stateOf([row()]))

    await click(host, '.action.resolve')

    expect(status(host)).toContain('needs write access')
    expect(host.querySelector('.row')?.classList.contains('done')).toBe(false)
    expect(badges(row())).not.toContain('Resolved')
  })

  /**
   * The rule this step turns on: a click is not a done state. The row waits for
   * a pass to read `data-resolved` off the page, and until one does it says it
   * is waiting rather than striking the finding through.
   */
  it('waits for the engine rather than calling itself done', async () => {
    const state = stateOf([row({ resolvable: true })])
    const host = await drawer(state)

    await click(host, '.action.resolve')

    expect(status(host)).toContain('Resolving')
    expect(host.querySelector<HTMLButtonElement>('.action.resolve')?.disabled).toBe(true)
    expect(host.querySelector('.row')?.classList.contains('done')).toBe(false)
  })

  it('finishes when a pass reports the thread resolved', async () => {
    const before = row({ resolvable: true })
    const host = await drawer(stateOf([before]))
    await click(host, '.action.resolve')

    // What the next pass publishes: the same thread, read again off the page.
    render(
      <App state={stateOf([{ ...before, thread: { ...before.thread, resolved: true } }])} />,
      host,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Done, so it leaves the Open tab for the Resolved one. It moves on the
    // pass that read `data-resolved`, never on the click.
    expect(host.querySelector('.progress-label')?.textContent).toBe('1 of 1 resolved')

    await click(host, '.tab.resolved')
    expect(status(host)).toBeNull()
    expect(host.querySelector('.row')?.classList.contains('done')).toBe(true)
  })

  it('offers the click again when nothing confirms it, rather than lying', async () => {
    vi.useFakeTimers()
    try {
      const host = mount(stateOf([row({ resolvable: true })]))
      host.querySelector<HTMLElement>('.handle')?.click()
      await vi.advanceTimersByTimeAsync(0)

      host.querySelector<HTMLElement>('.action.resolve')?.click()
      await vi.advanceTimersByTimeAsync(0)
      expect(status(host)).toContain('Resolving')

      await vi.advanceTimersByTimeAsync(5_000)

      expect(status(host)).toContain('did not confirm')
      expect(label(host, '.action.resolve')).toBe('Resolve this issue again')
      expect(host.querySelector<HTMLButtonElement>('.action.resolve')?.disabled).toBe(false)
      expect(host.querySelector('.row')?.classList.contains('done')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('copies the agent prompt and says it did', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const host = await drawer(stateOf([row({ finding: { aiPrompt: 'guard the null case' } })]))

    await click(host, '.action.copy')

    expect(write).toHaveBeenCalledWith('guard the null case')
    expect(status(host)).toBe('Prompt copied.')
  })

  it('copies from the menu as well as from the icon', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const host = await drawer(stateOf([row({ finding: { aiPrompt: 'guard the null case' } })]))

    await fromMenu(host, '.menu-item.copy')

    expect(write).toHaveBeenCalledWith('guard the null case')
  })

  it('reports a comment with no prompt, and a clipboard that refused, differently', async () => {
    const noPrompt = await drawer(stateOf([row()]))
    await click(noPrompt, '.action.copy')
    expect(status(noPrompt)).toContain('no agent prompt')

    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('not allowed'))
    const refused = await drawer(stateOf([row({ finding: { aiPrompt: 'guard it' } })]))
    await click(refused, '.action.copy')
    expect(status(refused)).toContain('clipboard refused')
  })

  it('shows the finding on the page and reveals it if it was hidden', async () => {
    const listed = row({ resolvable: true })
    document.body.append(listed.thread.el)
    listed.thread.el.classList.add('crt-hidden')
    const scroll = vi.spyOn(listed.thread.el, 'scrollIntoView')

    const host = await drawer(stateOf([listed]))
    await fromMenu(host, '.menu-item.reveal')

    expect(listed.thread.el.classList.contains('crt-hidden')).toBe(false)
    expect(scroll).toHaveBeenCalled()
    listed.thread.el.remove()
  })
})

/**
 * Counted 20 August 2026, and they are the numbers a hand count of the drawer
 * has to match. `listed` is the rows drawn, `unread` the collapsed threads the
 * drawer only counts, and the two plus the human threads make up `total`.
 */
const EXPECTED: Record<string, { listed: number; open: number; unread: number }> = {
  'unresolved-and-resolved': { listed: 2, open: 2, unread: 10 },
  'human-replies': { listed: 27, open: 27, unread: 76 },
  'pending-in-batch': { listed: 8, open: 8, unread: 10 },
  'no-coderabbit': { listed: 0, open: 0, unread: 1 },
  resolvable: { listed: 9, open: 8, unread: 1 },
}

describe.each(Object.entries(EXPECTED))('the drawer on %s', (name, expected) => {
  let state: TriageState

  beforeAll(() => {
    const doc = loadFixture(name)
    let published: TriageState | undefined
    // The first pass runs synchronously inside `startEngine`, so this reads one
    // real state and then puts the fixture document back the way it was.
    const stop = startEngine(doc, (published_) => (published = published_))
    stop()
    state = published as TriageState
  })

  it('lists what the count says', () => {
    const listed = listedRows(state)

    expect(listed).toHaveLength(expected.listed)
    expect(listed.filter((r) => !r.thread.resolved)).toHaveLength(expected.open)
    expect(unreadCount(state)).toBe(expected.unread)
  })

  // The one that matters: hiding a finding and then not listing it is exactly
  // the failure this project exists to prevent.
  it('lists every thread it took off the page', () => {
    const listedIds = new Set(listedRows(state).map((r) => r.thread.id))

    for (const id of state.hidden) expect(listedIds.has(id), `hidden thread ${id}`).toBe(true)
  })

  it('draws one row per listed finding, across the two tabs', async () => {
    const host = mount(state)
    await click(host, '.handle')

    const open = host.querySelectorAll('.row').length
    await click(host, '.tab.resolved')
    const done = host.querySelectorAll('.row').length

    expect(open).toBe(expected.open)
    expect(open + done).toBe(expected.listed)
  })
})
