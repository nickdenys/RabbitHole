import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startEngine, type TriageState } from '../src/engine'
import { fixtureNames, loadFixture } from './support/fixture'

const HIDDEN = '.crt-hidden'
const STYLE_ID = 'coderabbit-triage-style'
const PANEL_HOST_ID = 'coderabbit-triage-root'

const PR_URL = 'https://github.com/owner/repo/pull/1'
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

const teardowns: Array<() => void> = []

afterEach(() => {
  // Reverse order, so a test that started two engines on one document takes
  // them down in the order they were layered.
  while (teardowns.length > 0) teardowns.pop()?.()
  vi.useRealTimers()
  setUrl(PR_URL)
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
  'resolvable': { total: 10, unresolved: 10, hidden: 10, unparsed: 0, notes: 3 },
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
