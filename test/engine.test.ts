import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startEngine, type TriageState } from '../src/engine'
import { DEFAULT_PREFS, type Prefs } from '../src/prefs'
import {
  forgetSessionFindings,
  resolveThread,
  sessionFinding,
  toggleInTimeline,
} from '../src/panel/actions'
import { fixtureNames, loadFixture, loadFragment } from './support/fixture'

const HIDDEN = '.rh-hidden'
const STYLE_ID = 'rabbithole-style'
const PANEL_HOST_ID = 'rabbithole-root'

const PR_URL = 'https://github.com/owner/repo/pull/1'
const OTHER_PR = 'https://github.com/owner/repo/pull/2'
const SAME_PR_FILES_TAB = 'https://github.com/owner/repo/pull/1/files'
const NOT_A_PR = 'https://github.com/owner/repo'

/**
 * A fixture is parsed by the test window, so the window's URL is the URL the
 * engine sees. Pointing it at a pull request is what makes a parsed capture
 * behave like the page it was captured from, and it is the only way to reach
 * the detector's URL rule without a second argument only tests would use.
 */
function setUrl(url: string): void {
  ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url)
}

beforeAll(() => setUrl(PR_URL))

/**
 * A pass runs on a debounce and the observer delivers on a timer of its own, so
 * every wait in this file is "advance past both". Real timers would make the
 * suite sleep; fake ones make the ordering explicit.
 */
beforeEach(() => vi.useFakeTimers())

/**
 * Every pass asks GitHub for the collapsed threads it can see, so a case that
 * is not about the deferred fetch would reach the network on its first pass.
 * The default is a request that never answers: the page reads as it did before
 * any fragment landed, and a case that wants answers stubs over this **before**
 * it starts an engine, because the first pass is where the asking happens.
 */
beforeEach(() => vi.stubGlobal('fetch', () => new Promise(() => {})))

const teardowns: Array<() => void> = []

afterEach(() => {
  // Reverse order, so a test that started two engines on one document takes
  // them down in the order they were layered.
  while (teardowns.length > 0) teardowns.pop()?.()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setUrl(PR_URL)

  // The teardown above already does this on the engine's own path. Repeating it
  // here means a case that never started an engine, or one whose reset is the
  // thing under test and therefore not to be trusted, still leaves the module
  // level cache empty for the next case.
  forgetSessionFindings()
})

/** Start an engine that is torn down after the test, collecting every state. */
function engineOn(doc: Document): TriageState[] {
  const states: TriageState[] = []
  teardowns.push(startEngine(doc, (state) => states.push(state)))
  return states
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(500)
}

function latest(states: TriageState[]): TriageState {
  return states[states.length - 1]
}

/** The class can be on the element or on the timeline item that swallowed it. */
function isHidden(el: Element): boolean {
  return el.closest(HIDDEN) !== null
}

/**
 * One review thread of CodeRabbit's, readable and hideable: a frame to take its
 * id from, one comment, and that comment's author link pointing at the account
 * path. Everything the policy needs and nothing it does not.
 *
 * `wrapper` is what the detector keys off. With `js-timeline-item` this is a
 * classic page; without it the same thread sits on a build the extension cannot
 * read, which is the pair invariant 3 is tested with.
 */
function threadMarkup(id: number, wrapper = 'js-timeline-item'): string {
  return `
    <div class="${wrapper}">
      <turbo-frame id="review-thread-or-comment-id-${id}">
        <review-thread-collapsible data-resolved="false">
          <div class="timeline-comment-group">
            <div class="review-comment">
              <a class="author" href="/apps/coderabbitai">coderabbitai</a>
              <div class="comment-body">Findings.</div>
            </div>
          </div>
        </review-thread-collapsible>
      </turbo-frame>
    </div>`
}

/**
 * The same thread with a person's reply under CodeRabbit's comment, which is
 * the one thread the two modes disagree about: safe mode leaves it in the
 * timeline, aggressive mode hides it and the reply with it.
 */
function threadWithReply(id: number): string {
  return threadMarkup(id).replace(
    '</div>\n          </div>',
    '</div>\n            <div class="review-comment">' +
      '<a class="author" href="/nickdenys">nickdenys</a>' +
      '<div class="comment-body">Fixed.</div></div>\n          </div>',
  )
}

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument()
  d.body.innerHTML = html
  return d
}

/**
 * The page the behavioural tests below run against: three CodeRabbit threads,
 * all hideable, and nothing else.
 *
 * Hand built rather than a fixture on purpose. Those tests are about the loop,
 * not about GitHub's markup, and a fixture parsed once per test is how this
 * file first ran the worker out of memory. Realism is the block above's job.
 */
const PAGE = threadMarkup(1) + threadMarkup(2) + threadMarkup(3)

/**
 * Counts as of 20 August 2026. The `hidden` column is the same set the
 * invariants pin in safe mode, reached the other way round: through the engine
 * rather than through the policy, so a composition that drops a verdict on the
 * floor fails here even though every unit still agrees with itself.
 *
 * `unparsed` is zero everywhere on purpose, and that is a claim about the
 * panel: every unreadable thread in the fixtures is unreadable because it is
 * collapsed, which the reader is told about separately and B2 fixes. A number
 * here would be a thread nobody can explain.
 */
const COUNTS = {
  'unresolved-and-resolved': { total: 13, unresolved: 3, hidden: 2, unparsed: 0, notes: 5 },
  'human-replies': { total: 103, unresolved: 27, hidden: 17, unparsed: 0, notes: 8 },
  'pending-in-batch': { total: 19, unresolved: 9, hidden: 7, unparsed: 0, notes: 7 },
  'no-coderabbit': { total: 3, unresolved: 2, hidden: 0, unparsed: 0, notes: 0 },
  'resolvable': { total: 10, unresolved: 8, hidden: 9, unparsed: 0, notes: 3 },
} as const

const NAMES = fixtureNames()

// Parsed once and shared, as in the other fixture tests: human-replies.html is
// 8.7 MB and re-parsing it per case exhausts the test worker. These cases do
// mutate their document, and the teardown after each one puts it back: the
// class and the stylesheet are the engine's whole footprint.
const docs = Object.fromEntries(NAMES.map((name) => [name, loadFixture(name)])) as Record<
  string,
  Document
>

describe.each(NAMES)('%s', (name) => {
  const expected = COUNTS[name as keyof typeof COUNTS]

  // One pass per fixture, shared by the three assertions and undone after
  // them. Three passes over the 8.7 MB capture is a quarter of the suite's
  // whole runtime, and nothing below writes to the document.
  let state: TriageState
  let stop: () => void

  beforeAll(() => {
    // A suite's `beforeAll` runs before the file's `beforeEach`, so the default
    // stub is not in place yet and this pass would ask github.com for the
    // fixture's collapsed threads for real.
    vi.stubGlobal('fetch', () => new Promise(() => {}))

    stop = startEngine(docs[name], (published) => {
      state = published
    })
  })

  afterAll(() => stop())

  it('publishes the counts', () => {
    expect(state.kind).toBe('classic')
    expect(state.counts).toEqual({
      total: expected.total,
      unresolved: expected.unresolved,
      hidden: expected.hidden,
      unparsed: expected.unparsed,
    })
    expect(state.notes.length).toBe(expected.notes)
  })

  it('takes every hidden thread off the page and leaves the rest on it', () => {
    for (const thread of state.threads) {
      expect(isHidden(thread.el), `${name} thread ${thread.id}`).toBe(state.hidden.has(thread.id))
    }
  })

  it('reports every hidden thread by id', () => {
    expect(state.hidden.size).toBe(expected.hidden)
    expect(state.hidden.has('')).toBe(false)
  })
})

describe('startEngine', () => {
  it('publishes a first state synchronously, before anything can change', () => {
    const states = engineOn(doc(PAGE))

    expect(states.length).toBe(1)
    expect(latest(states).counts).toEqual({ total: 3, unresolved: 3, hidden: 3, unparsed: 0 })
  })

  it('picks up a thread that arrives after the first pass', async () => {
    const d = doc(PAGE)
    const states = engineOn(d)

    d.body.insertAdjacentHTML('beforeend', threadMarkup(9001))
    await settle()

    const state = latest(states)
    expect(states.length).toBe(2)
    expect(state.counts.total).toBe(4)
    expect(state.hidden.has('9001')).toBe(true)
    expect(isHidden(d.querySelector('#review-thread-or-comment-id-9001')!)).toBe(true)
  })

  it('coalesces a burst of changes into one pass', async () => {
    const d = doc(PAGE)
    const states = engineOn(d)

    for (let i = 0; i < 5; i++) d.body.insertAdjacentHTML('beforeend', threadMarkup(9100 + i))
    await settle()

    expect(states.length).toBe(2)
    expect(latest(states).counts.hidden).toBe(8)
  })

  it('hides nothing on a build it cannot read, however hideable the thread', () => {
    const unreadable = doc(
      `<react-app app-name="pull-requests">${threadMarkup(1, 'wrapper')}</react-app>`,
    )
    const state = latest(engineOn(unreadable))

    expect(state.kind).toBe('react')
    expect(state.threads).toEqual([])
    expect(state.counts).toEqual({ total: 0, unresolved: 0, hidden: 0, unparsed: 0 })
    expect(unreadable.querySelectorAll(HIDDEN).length).toBe(0)
    expect(unreadable.getElementById(STYLE_ID)).toBeNull()
  })

  it('hides that same thread once the page is one it can read', () => {
    // Without this the assertion above passes on markup nothing would ever
    // hide, which is the one way it could be vacuous.
    const state = latest(engineOn(doc(threadMarkup(1))))

    expect(state.kind).toBe('classic')
    expect(state.counts.hidden).toBe(1)
  })

  it('hides nothing on a document with no timeline at all', () => {
    const state = latest(engineOn(doc('<div>Some other GitHub page</div>')))

    expect(state.kind).toBe('unknown')
    expect(state.counts.total).toBe(0)
  })

  it('publishes an empty state away from a pull request', () => {
    setUrl(NOT_A_PR)
    const d = doc(PAGE)
    const state = latest(engineOn(d))

    expect(state.kind).toBe('not-pr')
    expect(state.threads).toEqual([])
    expect(d.querySelectorAll(HIDDEN).length).toBe(0)
  })

  it('runs a pass immediately on turbo:load, without waiting for the debounce', () => {
    const d = doc(PAGE)
    const states = engineOn(d)

    d.dispatchEvent(new Event('turbo:load'))

    expect(states.length).toBe(2)
  })

  it('reveals a page it had hidden when Turbo navigates to one it cannot read', () => {
    const d = doc(PAGE)
    const states = engineOn(d)
    expect(d.querySelectorAll(HIDDEN).length).toBeGreaterThan(0)

    for (const item of d.querySelectorAll('.js-timeline-item')) {
      item.classList.remove('js-timeline-item')
    }
    d.dispatchEvent(new Event('turbo:load'))

    // Immediately, without advancing a timer: a soft navigation is a new page
    // and does not wait for the debounce.
    expect(states.length).toBe(2)
    expect(latest(states).kind).toBe('unknown')
    expect(d.querySelectorAll(HIDDEN).length).toBe(0)
  })
})

describe('its own mutations', () => {
  it('does not feed itself: a pass provokes no further pass', async () => {
    const states = engineOn(doc(PAGE))

    await settle()

    expect(states.length).toBe(1)
  })

  it('does not schedule a pass for the panel host', async () => {
    const d = doc(PAGE)
    const states = engineOn(d)

    const host = d.createElement('div')
    host.id = PANEL_HOST_ID
    d.body.append(host)
    await settle()

    expect(states.length).toBe(1)
  })

  it('does schedule a pass for anything else appended alongside it', async () => {
    const d = doc(PAGE)
    const states = engineOn(d)

    d.body.append(d.createElement('div'))
    await settle()

    expect(states.length).toBe(2)
  })

  it('schedules a pass when GitHub takes the stylesheet away, and puts it back', async () => {
    const d = doc(PAGE)
    const states = engineOn(d)

    d.getElementById(STYLE_ID)?.remove()
    await settle()

    expect(states.length).toBe(2)
    expect(d.getElementById(STYLE_ID)).not.toBeNull()
    expect(d.querySelectorAll(HIDDEN).length).toBe(3)
  })
})

describe('teardown', () => {
  it('restores the document and stops observing', async () => {
    const d = doc(PAGE)
    const states = engineOn(d)
    expect(d.querySelectorAll(HIDDEN).length).toBeGreaterThan(0)

    teardowns.pop()?.()

    expect(d.querySelectorAll(HIDDEN).length).toBe(0)
    expect(d.getElementById(STYLE_ID)).toBeNull()

    d.body.insertAdjacentHTML('beforeend', threadMarkup(9200))
    d.dispatchEvent(new Event('turbo:load'))
    await settle()

    expect(states.length).toBe(1)
  })

  it('forgets the session findings', () => {
    const d = doc(resolvableMarkup(1))
    const states = engineOn(d)
    const row = latest(states).rows[0]

    expect(resolveThread(row)).toBe(true)
    teardowns.pop()?.()

    expect(sessionFinding(row.thread.id)).toBeUndefined()
  })

  it('cancels a pass that was already scheduled', async () => {
    const d = doc(PAGE)
    const states = engineOn(d)

    d.body.insertAdjacentHTML('beforeend', threadMarkup(9300))
    teardowns.pop()?.()
    await settle()

    expect(states.length).toBe(1)
    expect(d.querySelectorAll(HIDDEN).length).toBe(0)
  })
})

/**
 * The same thread, plus the resolve form GitHub renders for a reader who can
 * write to the repository. `type="button"` because the form is real markup in a
 * real document here and a submit would try to navigate the test window; the
 * action under test is the click reaching `resolveThread`, not what GitHub's
 * own handler would do with it.
 */
function resolvableMarkup(id: number): string {
  return threadMarkup(id).replace(
    '<div class="review-comment">',
    '<form action="/owner/repo/pull/1/threads/1/resolve" method="post">' +
      '<button type="button">Resolve conversation</button></form>' +
      '<div class="review-comment">',
  )
}

/**
 * Turbo, which is how GitHub moves and therefore the only navigation the
 * extension ever sees: the content script is never reinjected, so the engine
 * has to notice on its own that the page changed under it.
 */
function navigateTo(url: string, doc: Document): void {
  setUrl(url)
  doc.dispatchEvent(new Event('turbo:load'))
}

describe('navigation', () => {
  /**
   * Resolve one thread through the engine's own row, which is the only way the
   * session cache is ever filled. Returns the id it was filed under.
   */
  function resolveFirst(states: TriageState[]): string {
    const row = latest(states).rows[0]

    expect(resolveThread(row)).toBe(true)
    expect(sessionFinding(row.thread.id)).toBeDefined()

    return row.thread.id
  }

  it('keeps the session findings when only the tab changes', () => {
    const d = doc(resolvableMarkup(1))
    const id = resolveFirst(engineOn(d))

    navigateTo(SAME_PR_FILES_TAB, d)
    navigateTo(PR_URL, d)

    // The Files tab is unreadable and the round trip publishes two states that
    // list nothing, but it is the same pull request throughout. Clearing here
    // would drop the row the reader had just worked, for the price of clicking
    // a tab.
    expect(sessionFinding(id)).toBeDefined()
  })

  it('forgets the session findings on arriving at a different pull request', () => {
    const d = doc(resolvableMarkup(1))
    const id = resolveFirst(engineOn(d))

    navigateTo(OTHER_PR, d)

    expect(sessionFinding(id)).toBeUndefined()
  })

  it('forgets them on leaving pull requests altogether', () => {
    const d = doc(resolvableMarkup(1))
    const id = resolveFirst(engineOn(d))

    navigateTo(NOT_A_PR, d)

    expect(sessionFinding(id)).toBeUndefined()
  })

  it('re-hides a thread revealed on the pull request it left', () => {
    const d = doc(PAGE)
    const states = engineOn(d)
    const row = latest(states).rows[0]

    toggleInTimeline(row)
    expect(isHidden(row.thread.el)).toBe(false)

    // The document is deliberately not swapped, which is the harder case: a
    // reveal held by element identity would survive here and only a real reset
    // takes it away.
    navigateTo(OTHER_PR, d)

    expect(isHidden(row.thread.el)).toBe(true)
  })

  it('lists the new pull request and nothing of the last one', () => {
    const d = doc(PAGE)
    const states = engineOn(d)
    expect(latest(states).counts.total).toBe(3)

    d.body.innerHTML = threadMarkup(4001)
    navigateTo(OTHER_PR, d)

    const state = latest(states)
    expect(state.counts.total).toBe(1)
    expect(state.threads.map((thread) => thread.id)).toEqual(['4001'])
    expect(state.hidden).toEqual(new Set(['4001']))
  })

  it('publishes exactly one state per navigation, without waiting for a pass', () => {
    const d = doc(PAGE)
    const states = engineOn(d)

    navigateTo(OTHER_PR, d)

    expect(states.length).toBe(2)
    expect(latest(states).kind).toBe('classic')
  })

  it('does not reset when nothing about the page changed', () => {
    // A turbo:load on the page it is already on is a rerender, not a
    // navigation, and a reset there would silently drop the session cache on
    // whatever GitHub happened to redraw.
    const d = doc(resolvableMarkup(1))
    const id = resolveFirst(engineOn(d))

    navigateTo(PR_URL, d)

    expect(sessionFinding(id)).toBeDefined()
  })

  it('does not reset on the first pass', () => {
    // Starting on a page is not arriving at one. Nothing of ours exists yet, so
    // there is nothing to forget, and a reset here would only be a reveal of a
    // page nobody has hidden.
    const d = doc(PAGE)
    const states = engineOn(d)

    expect(latest(states).counts.hidden).toBe(3)
    expect(d.querySelectorAll(HIDDEN).length).toBeGreaterThan(0)
  })
})

/**
 * A resolved thread as GitHub renders one: an id, a file, a deferred URL, and
 * no comments at all. Everything the fetch needs and nothing the parsers can
 * read without it.
 */
function collapsedMarkup(id: number): string {
  return `
    <div class="js-timeline-item">
      <turbo-frame id="review-thread-or-comment-id-${id}">
        <review-thread-collapsible
          data-resolved="true"
          data-deferred-content-url="${deferredUrl(id)}"
        >
          <a class="text-mono text-small Link--primary" href="/owner/repo/pull/1/files#diff-x">src/app.ts</a>
        </review-thread-collapsible>
      </turbo-frame>
    </div>`
}

function deferredUrl(id: number): string {
  return `/owner/repo/pull/1/threads/${id}?rendering_on_files_tab=false`
}

/** A real response body, saved off GitHub's own endpoint. See test/fixtures/README.md. */
const FRAGMENT = loadFragment('deferred-thread')
const FRAGMENT_TITLE = 'Make these tests independent and deterministic.'

/**
 * Stand in for the network, and record what was asked for.
 *
 * A body of `null` is a request that fails, which is the case the worklist has
 * to survive: `fetchThreadHtml` flattens it and the engine has to say so on the
 * row rather than dropping it.
 */
function stubFetch(bodies: Record<string, string | null>): string[] {
  const asked: string[] = []

  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url)

    const body = bodies[url]
    if (body === undefined || body === null) return { ok: false, status: 404, text: async () => 'Not Found' }

    return { ok: true, status: 200, text: async () => body }
  })

  return asked
}

/**
 * Stand in for the network with an answer that waits to be released, which is
 * how a case gets a look at a row between the ask and the answer now that the
 * ask happens on the first pass rather than on a click.
 */
function heldFetch(body: string): () => void {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })

  vi.stubGlobal('fetch', async () => {
    await held
    return { ok: true, status: 200, text: async () => body }
  })

  return () => release()
}

describe('reading the resolved threads', () => {
  it('asks with the page, not with the drawer', async () => {
    const asked = stubFetch({ [deferredUrl(1)]: FRAGMENT })
    const states = engineOn(doc(collapsedMarkup(1)))

    await settle()

    // Nothing here opened a drawer, and the thread is described anyway. The
    // panel has no way to ask any more, so this is the only thing that could
    // have: a reader who opens the drawer finds the answers already in it.
    expect(asked).toEqual([deferredUrl(1)])
    expect(latest(states).rows[0].finding?.title).toBe(FRAGMENT_TITLE)
  })

  it('publishes the worklist before it touches the network', async () => {
    const states: TriageState[] = []
    let askedAfter = -1

    vi.stubGlobal('fetch', async () => {
      askedAfter = states.length
      return { ok: true, status: 200, text: async () => FRAGMENT }
    })

    teardowns.push(startEngine(doc(collapsedMarkup(1)), (state) => states.push(state)))
    await settle()

    // The first pass is never behind a request. The count and the meter are on
    // screen from the state published before the first fetch was started, and
    // the fragment only ever adds to a drawer that was already drawable.
    expect(askedAfter).toBe(1)
    expect(states[0].counts.total).toBe(1)
    expect(states[0].rows[0].verdict).toEqual({ hide: false, reason: 'collapsed' })
  })

  it('reads a collapsed thread back and describes it like any other', async () => {
    const asked = stubFetch({ [deferredUrl(1)]: FRAGMENT })
    const states = engineOn(doc(collapsedMarkup(1)))

    await settle()

    expect(asked).toEqual([deferredUrl(1)])

    const row = latest(states).rows[0]
    expect(row.thread.authors?.allFromCodeRabbit).toBe(true)
    expect(row.thread.problems).toEqual([])
    expect(row.finding?.title).toBe(FRAGMENT_TITLE)
    expect(row.finding?.severity).toBe('minor')

    // Attributed at last, so the policy can act on it: a resolved CodeRabbit
    // thread with nobody else in it comes off the timeline like any other.
    expect(row.verdict).toEqual({ hide: true })
    expect(isHidden(row.thread.el)).toBe(true)
  })

  it('leaves identity and state with the page', async () => {
    stubFetch({ [deferredUrl(1)]: FRAGMENT })
    const states = engineOn(doc(collapsedMarkup(1)))

    await settle()

    // None of these is in the fragment, and none of them moves. The stub in the
    // page is the only place they exist. See [[DOM reference]].
    const { thread } = latest(states).rows[0]
    expect(thread.id).toBe('1')
    expect(thread.file).toBe('src/app.ts')
    expect(thread.resolved).toBe(true)
    expect(thread.collapsed).toBe(true)
  })

  it.each([
    ['a request that failed', null],
    ['a body with no comment in it', '<div class="js-inline-comments-container"></div>'],
  ])('lists a thread it could not read: %s', async (_name, body) => {
    stubFetch({ [deferredUrl(1)]: body })
    const states = engineOn(doc(collapsedMarkup(1)))

    await settle()

    // Visible, on the page and in the panel, and counted in the warning. The
    // one thing it must never be is quietly absent.
    const row = latest(states).rows[0]
    expect(row.verdict).toEqual({ hide: false, reason: 'fetch-failed' })
    expect(row.thread.problems).toContain('fetch-failed')
    expect(isHidden(row.thread.el)).toBe(false)
    expect(latest(states).counts.unparsed).toBe(1)
  })

  it('asks once per thread, however many passes run', async () => {
    const asked = stubFetch({ [deferredUrl(1)]: FRAGMENT, [deferredUrl(2)]: null })
    const d = doc(collapsedMarkup(1) + collapsedMarkup(2))
    engineOn(d)

    // Several asks already: the first pass makes one, and every fragment that
    // lands schedules a pass that makes another while the rest are still in
    // flight. Those have to skip requests in flight, not only answered ones.
    await settle()

    // One more pass, over threads that are all answered for by now, including
    // the one that failed: a dead thread is asked about once per page.
    d.body.appendChild(d.createElement('div'))
    await settle()

    expect(asked).toEqual([deferredUrl(1), deferredUrl(2)])
  })

  it('prefers the page to the fragment when GitHub renders the thread after all', async () => {
    stubFetch({ [deferredUrl(1)]: FRAGMENT })
    const d = doc(collapsedMarkup(1))
    const states = engineOn(d)

    await settle()
    expect(latest(states).rows[0].finding?.title).toBe(FRAGMENT_TITLE)

    // GitHub expands the thread, which is what an unresolve does. What is on
    // the screen now wins over what the network said earlier.
    d.body.innerHTML = threadMarkup(1)
    await settle()

    expect(latest(states).rows[0].finding?.title).toBe('Findings.')
  })

  it('replaces the session finding of a thread resolved here', async () => {
    const release = heldFetch(FRAGMENT)
    const d = doc(resolvableMarkup(1))
    const states = engineOn(d)

    expect(resolveThread(latest(states).rows[0])).toBe(true)
    expect(sessionFinding('1')?.title).toBe('Findings.')

    // GitHub accepts the resolve and swaps in the collapsed partial, which is
    // the moment A11's cache became the only description of this thread. The
    // fetch for it is in flight and held, so this is the row as it reads in
    // between: null, because the engine never falls back to the cache.
    d.body.innerHTML = collapsedMarkup(1)
    await settle()
    expect(latest(states).rows[0].finding).toBeNull()

    release()
    await settle()

    // And the moment it stopped being: the row now draws from what GitHub
    // actually holds, and the cache is no longer consulted for it.
    expect(latest(states).rows[0].finding?.title).toBe(FRAGMENT_TITLE)
  })

  it('drops a fetch that was still in flight when the page changed', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    // Only the first request answers. The pull request being arrived at has the
    // same collapsed thread in it, so the pass after the navigation asks for it
    // again on a fresh controller: leave that one hanging and the row can only
    // be described by the answer that arrived too late, which is the thing
    // under test.
    const signals: (AbortSignal | undefined)[] = []
    vi.stubGlobal('fetch', async (_url: string, init: { signal?: AbortSignal }) => {
      signals.push(init.signal)
      if (signals.length > 1) return new Promise(() => {})

      await held
      return { ok: true, status: 200, text: async () => FRAGMENT }
    })

    const d = doc(collapsedMarkup(1))
    const states = engineOn(d)
    await vi.advanceTimersByTimeAsync(0)

    // The same document, deliberately: a reset that only worked because Turbo
    // swapped the body would pass here without aborting anything.
    navigateTo(OTHER_PR, d)
    release?.()
    await settle()

    expect(signals[0]?.aborted).toBe(true)

    // Answered after the navigation and therefore never merged. A fragment from
    // the pull request being left, keyed by an id that exists on the one being
    // arrived at, is another review's finding on this review's row.
    expect(latest(states).rows[0].finding).toBeNull()
    expect(latest(states).rows[0].verdict).toEqual({ hide: false, reason: 'collapsed' })
  })
})

/**
 * The hide mode, which is the one preference the engine acts on. Whether it
 * survives a browser restart is `prefs.test.ts`; this is that the pass reads it,
 * that changing it redecides the page at once, and that the other two
 * preferences never touch the timeline.
 */
describe('the hide mode', () => {
  /** Two threads CodeRabbit started, one of which a person has replied to. */
  const MIXED = threadMarkup(1) + threadWithReply(2)

  function engineWith(d: Document, prefs: Partial<Prefs>): TriageState[] {
    const states: TriageState[] = []
    teardowns.push(startEngine(d, (state) => states.push(state), { ...DEFAULT_PREFS, ...prefs }))
    return states
  }

  it('is safe when the caller passes no preferences at all', () => {
    const states = engineOn(doc(MIXED))

    expect(latest(states).prefs).toEqual(DEFAULT_PREFS)
    expect(latest(states).counts.hidden).toBe(1)
  })

  // The rule B7 exists for: the first pass hides in the reader's own mode.
  // Starting in safe mode and correcting afterwards is the same set of comments
  // disappearing twice, on every page.
  it('hides in the given mode on the very first pass', () => {
    const states = engineWith(doc(MIXED), { hideMode: 'aggressive' })

    expect(states.length).toBe(1)
    expect(latest(states).counts.hidden).toBe(2)
  })

  it('publishes the preferences it was started with', () => {
    const prefs: Prefs = {
      hideMode: 'aggressive',
      sortAxis: 'file',
      sortLeading: false,
      drawerOpen: true,
      theme: 'dark',
      autoLoadMore: false,
    }
    const states = engineWith(doc(MIXED), prefs)

    expect(latest(states).prefs).toEqual(prefs)
  })

  it('redecides the page on the click rather than on the next mutation', () => {
    const d = doc(MIXED)
    const states = engineOn(d)
    const replied = d.querySelectorAll('review-thread-collapsible')[1]

    expect(isHidden(replied)).toBe(false)

    latest(states).setPrefs({ hideMode: 'aggressive' })

    // No timer advanced: a debounced pass would leave the thread on screen
    // until something else changed the page.
    expect(isHidden(replied)).toBe(true)
    expect(latest(states).counts.hidden).toBe(2)
    expect(latest(states).prefs.hideMode).toBe('aggressive')
  })

  /**
   * Switching back needs no undo path, per A7: a pass owns the whole hidden set,
   * so the next one simply names fewer elements and the rest come back.
   */
  it('brings the thread back when the reader switches back', () => {
    const d = doc(MIXED)
    const states = engineWith(d, { hideMode: 'aggressive' })
    const replied = d.querySelectorAll('review-thread-collapsible')[1]

    latest(states).setPrefs({ hideMode: 'safe' })

    expect(isHidden(replied)).toBe(false)
    expect(latest(states).counts.hidden).toBe(1)
  })

  it('runs no pass for a preference that decides nothing about the page', () => {
    const states = engineOn(doc(MIXED))

    latest(states).setPrefs({ sortAxis: 'file', drawerOpen: true })

    expect(states.length).toBe(1)
  })

  it('carries a preference that decided nothing into the next pass anyway', async () => {
    const d = doc(MIXED)
    const states = engineOn(d)

    latest(states).setPrefs({ sortAxis: 'file' })
    d.body.insertAdjacentHTML('beforeend', threadMarkup(9001))
    await settle()

    expect(latest(states).prefs.sortAxis).toBe('file')
  })

  it('keeps the mode across a navigation to another pull request', async () => {
    const d = doc(MIXED)
    const states = engineWith(d, { hideMode: 'aggressive' })

    navigateTo(OTHER_PR, d)
    await settle()

    expect(latest(states).prefs.hideMode).toBe('aggressive')
    expect(latest(states).counts.hidden).toBe(2)
  })

  // The record it writes is `prefs.test.ts`'s subject. This is only that a
  // choice made in the panel reaches storage at all, rather than living in one
  // tab until it is closed.
  it('writes every change to chrome.storage.local', () => {
    const set = vi.fn(async () => {})
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => ({})), set } } })

    const states = engineOn(doc(MIXED))
    latest(states).setPrefs({ hideMode: 'aggressive' })

    expect(set).toHaveBeenCalledWith({ prefs: expect.objectContaining({ hideMode: 'aggressive' }) })
  })

  // Aggressive mode is a wider net, never a different one. The three rules that
  // hold both invariants up are the policy's, and this is the composition
  // saying the engine did not route around them.
  it('still never hides a thread it could not attribute', () => {
    const unreadable = threadMarkup(3).replace('<a class="author" href="/apps/coderabbitai">coderabbitai</a>', '')
    const d = doc(MIXED + unreadable)
    const states = engineWith(d, { hideMode: 'aggressive' })

    expect(latest(states).counts.hidden).toBe(2)
    expect(isHidden(d.querySelectorAll('review-thread-collapsible')[2])).toBe(false)
  })
})

/** CodeRabbit's summary, claiming `count` findings. */
function noteMarkup(count: number): string {
  return `
    <div class="js-timeline-item">
      <div class="TimelineItem">
        <img class="avatar">
        <div class="timeline-comment-group">
          <a href="/apps/coderabbitai" class="author">coderabbitai</a>
          <div class="comment-body"><p><strong>Actionable comments posted: ${count}</strong></p></div>
        </div>
      </div>
    </div>`
}

/**
 * GitHub's own "Load more" control, standing for the thread(s) it has not
 * rendered yet. Clicking its button is wired, in these tests, to do what
 * GitHub's own handler does on a real page: insert `reveals` and remove the
 * form, so the engine's next pass sees a page with one fewer thing missing.
 */
function paginationControl(doc: Document, reveals: string): void {
  doc.body.insertAdjacentHTML(
    'beforeend',
    `<form class="ajax-pagination-form js-ajax-pagination">
      <button type="submit">1 hidden conversation</button>
      <button type="submit" data-disable-with="Loading…">Load more…</button>
    </form>`,
  )

  const form = doc.body.lastElementChild!
  form.querySelector('[data-disable-with]')!.addEventListener('click', () => {
    form.insertAdjacentHTML('beforebegin', reveals)
    form.remove()
  })
}

describe('auto-loading "Load more"', () => {
  it('clicks it on its own until nothing is missing, then stops', async () => {
    const d = doc(threadMarkup(1) + noteMarkup(2))
    paginationControl(d, threadMarkup(2))

    const states = engineOn(d)
    expect(latest(states).check.missing).toBe(1)

    await settle()

    expect(latest(states).check.missing).toBe(0)
    expect(latest(states).counts.total).toBe(2)
    expect(d.querySelector('.ajax-pagination-form')).toBeNull()

    // Nothing left to click, so a further settle publishes no further state.
    const before = states.length
    await settle()
    expect(states.length).toBe(before)
  })

  it('clicks every control still on the page in one pass, not one at a time', async () => {
    const d = doc(threadMarkup(1) + noteMarkup(3))
    paginationControl(d, threadMarkup(2))
    paginationControl(d, threadMarkup(3))

    const states = engineOn(d)
    await settle()

    expect(latest(states).check.missing).toBe(0)
    expect(latest(states).counts.total).toBe(3)
  })

  it('never clicks it when the preference is off', async () => {
    const d = doc(threadMarkup(1) + noteMarkup(2))
    paginationControl(d, threadMarkup(2))

    const states: TriageState[] = []
    teardowns.push(
      startEngine(d, (state) => states.push(state), { ...DEFAULT_PREFS, autoLoadMore: false }),
    )
    await settle()

    expect(latest(states).check.missing).toBe(1)
    expect(latest(states).counts.total).toBe(1)
    expect(d.querySelector('.ajax-pagination-form')).not.toBeNull()
  })

  it('does nothing on a page where nothing is missing', async () => {
    const d = doc(threadMarkup(1) + noteMarkup(1))
    paginationControl(d, '')

    const states = engineOn(d)
    await settle()

    // The control was never clicked, because there was never a gap to close.
    expect(d.querySelector('.ajax-pagination-form')).not.toBeNull()
    expect(latest(states).check.missing).toBe(0)
  })
})
