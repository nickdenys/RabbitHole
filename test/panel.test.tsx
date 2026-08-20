import { render } from 'preact'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startEngine, type TriageRow, type TriageState } from '../src/engine'
import type { HideVerdict } from '../src/hide/policy'
import { App } from '../src/panel/App'
import { badges, emptyState, keptReason, listedRows, unreadCount } from '../src/panel/rows'
import type { Finding, Thread, ThreadAuthors } from '../src/types'
import { loadFixture } from './support/fixture'

const PR_URL = 'https://github.com/owner/repo/pull/1'

beforeAll(() => {
  ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(PR_URL)
})

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
      el: null as unknown as Element,
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

function stateOf(rows: TriageRow[], over: Partial<TriageState> = {}): TriageState {
  const threads = rows.map((r) => r.thread)
  const hidden = rows.filter((r) => r.verdict.hide)

  return {
    kind: 'classic',
    threads,
    rows,
    notes: [],
    hidden: new Set(hidden.map((r) => r.thread.id)),
    counts: {
      total: threads.length,
      unresolved: threads.filter((t) => !t.resolved).length,
      hidden: hidden.length,
      unparsed: rows.filter((r) => !r.verdict.hide && r.verdict.reason === 'unparsed').length,
    },
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

    expect(host.querySelector('.handle')?.textContent).toContain('CR 2')
    expect(host.querySelector('.drawer')).toBeNull()
  })

  it('counts the worklist rather than every unresolved thread on the page', () => {
    const host = mount(stateOf([row(), row({ thread: { id: '2' }, verdict: kept('not-coderabbit') })]))

    expect(host.querySelector('.handle')?.textContent).toContain('CR 1')
  })

  it('opens on the handle and closes again on either control', async () => {
    const host = mount(stateOf([row()]))

    await click(host, '.handle')
    expect(host.querySelector('.drawer')).not.toBeNull()
    expect(host.querySelector('.drawer-title')?.textContent).toBe('1 finding to go')

    await click(host, '.close')
    expect(host.querySelector('.drawer')).toBeNull()

    await click(host, '.handle')
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

  it('draws a row per finding, with its severity, title, file and badges', async () => {
    const host = mount(stateOf([row({ thread: { outdated: true } })]))
    await click(host, '.handle')

    const listed = host.querySelector('.row')
    expect(listed?.querySelector('.dot')?.classList.contains('major')).toBe(true)
    expect(listed?.querySelector('.row-title')?.textContent).toBe('Guard against a null user')
    expect(listed?.querySelector('.row-file')?.textContent).toBe('src/app.ts')
    expect(listed?.querySelector('.row-triple')?.textContent).toBe('Potential issue · ~10 minutes')
    expect([...listed!.querySelectorAll('.badge')].map((b) => b.textContent)).toEqual(['Outdated'])
  })

  it('marks a finding with no severity rather than leaving it blank', async () => {
    const host = mount(stateOf([row({ finding: { severity: null, category: null, effort: null } })]))
    await click(host, '.handle')

    expect(host.querySelector('.dot')?.classList.contains('none')).toBe(true)
    expect(host.querySelector('.dot')?.getAttribute('aria-label')).toBe('Severity: not stated')
    expect(host.querySelector('.row-triple')).toBeNull()
  })

  // Without this a reader who sees a CodeRabbit comment still in the timeline
  // cannot tell a deliberate exception from a broken extension.
  it('says why a finding is still in the timeline, and says nothing when it was hidden', async () => {
    const host = mount(stateOf([row({ verdict: kept('human-activity') }), row({ thread: { id: '2' } })]))
    await click(host, '.handle')

    const reasons = [...host.querySelectorAll('.row-reason')].map((p) => p.textContent)
    expect(reasons).toEqual(['Left in the timeline: someone replied to it'])
  })

  it('admits to the resolved threads it cannot read yet', async () => {
    const host = mount(stateOf([row(), row({ thread: { id: '2', resolved: true }, verdict: kept('collapsed') })]))
    await click(host, '.handle')

    expect(host.querySelector('.rows')?.children).toHaveLength(1)
    expect(host.textContent).toContain('1 resolved thread not listed')
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
 * Counted 20 August 2026, and they are the numbers a hand count of the drawer
 * has to match. `listed` is the rows drawn, `unread` the collapsed threads the
 * drawer only counts, and the two plus the human threads make up `total`.
 */
const EXPECTED: Record<string, { listed: number; open: number; unread: number }> = {
  'unresolved-and-resolved': { listed: 2, open: 2, unread: 10 },
  'human-replies': { listed: 27, open: 27, unread: 76 },
  'pending-in-batch': { listed: 8, open: 8, unread: 10 },
  'no-coderabbit': { listed: 0, open: 0, unread: 1 },
  resolvable: { listed: 10, open: 10, unread: 0 },
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

  it('draws one row per listed finding', async () => {
    const host = mount(state)
    await click(host, '.handle')

    expect(host.querySelectorAll('.row')).toHaveLength(expected.listed)
  })
})
