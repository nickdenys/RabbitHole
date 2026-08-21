import { beforeAll, describe, expect, it } from 'vitest'
import { countCheck, NO_CHECK } from '../src/count'
import { startEngine, type TriageRow, type TriageState } from '../src/engine'
import type { HideVerdict } from '../src/hide/policy'
import type { CodeRabbitNote } from '../src/parse/notes'
import type { Thread } from '../src/types'
import { loadFixture } from './support/fixture'

const PR_URL = 'https://github.com/owner/repo/pull/1'

beforeAll(() => {
  ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(PR_URL)
})

/** Only `actionableCount` is read, so the rest is the shape and not the point. */
function note(actionableCount: number | null): CodeRabbitNote {
  return {
    el: document.createElement('div'),
    timelineItem: null,
    kind: actionableCount === null ? 'walkthrough' : 'summary',
    actionableCount,
  }
}

/** Likewise: only the verdict is read. */
function row(verdict: HideVerdict = { hide: true }): TriageRow {
  return { thread: {} as Thread, finding: null, verdict }
}

const rows = (n: number, verdict?: HideVerdict): TriageRow[] => Array.from({ length: n }, () => row(verdict))
const human = rows(1, { hide: false, reason: 'not-coderabbit' })

describe('countCheck', () => {
  it('says nothing at all when no summary carries a number', () => {
    expect(countCheck([], rows(4))).toEqual({ claimed: null, found: 4, missing: 0 })
    expect(countCheck([note(null)], rows(4))).toMatchObject({ claimed: null, missing: 0 })
  })

  it('sums every summary on the page', () => {
    expect(countCheck([note(21), note(26), note(3)], rows(50)).claimed).toBe(50)
  })

  it('ignores the walkthrough, which carries no number', () => {
    expect(countCheck([note(null), note(4)], rows(4)).claimed).toBe(4)
  })

  it('warns when the page holds fewer threads than CodeRabbit says it posted', () => {
    expect(countCheck([note(27)], rows(3))).toEqual({ claimed: 27, found: 3, missing: 24 })
  })

  /**
   * The narrowing this module argues for. `human-replies.html` is 103 threads
   * against a claimed 102, so a two sided check fires on a page that is
   * completely rendered and correct.
   */
  it('stays quiet when the page holds more threads than the total', () => {
    expect(countCheck([note(102)], rows(103))).toMatchObject({ found: 103, missing: 0 })
  })

  it('counts a thread nobody has read yet, rather than calling it missing', () => {
    const collapsed = rows(9, { hide: false, reason: 'collapsed' })

    expect(countCheck([note(10)], [row(), ...collapsed]).missing).toBe(0)
  })

  it('does not count a thread proven to be somebody else s', () => {
    expect(countCheck([note(10)], [...rows(10), ...human]).found).toBe(10)
    expect(countCheck([note(10)], [...rows(9), ...human])).toMatchObject({ found: 9, missing: 1 })
  })

  it('never reports a negative shortfall', () => {
    expect(countCheck([note(0)], rows(6)).missing).toBe(0)
  })

  it('is quiet on an empty page', () => {
    expect(countCheck([], [])).toEqual(NO_CHECK)
  })
})

/**
 * **What the check says on every fixture, counted on 21 August 2026, and the
 * answer to [[Open questions|open question 1]].**
 *
 * All five captures were taken with the timeline fully expanded, and on all
 * five the check is silent. Three of the four pages carrying a CodeRabbit
 * review agree with it exactly, and the fourth has one thread more than the
 * total rather than one fewer. **The trigger the check was designed for, GitHub
 * dropping a rendered thread, did not fire once.** It is not proof that it
 * cannot; it is five pages of evidence that on a page GitHub has finished
 * rendering, CodeRabbit's number and the timeline agree.
 *
 * `threads` is every `review-thread-collapsible` in the page and `found` is the
 * subset not proven to be somebody else's, so the gap between them is the human
 * conversations: one each on two fixtures, two on `no-coderabbit.html`.
 *
 * The one over count is `human-replies.html`, 103 against 102. That is the case
 * `countCheck` refuses to warn about, and it is here to keep that refusal
 * honest: make the check two sided and this row fails.
 */
const EXPECTED: Record<string, { claimed: number | null; found: number; threads: number }> = {
  'unresolved-and-resolved': { claimed: 12, found: 12, threads: 13 },
  'human-replies': { claimed: 102, found: 103, threads: 103 },
  'pending-in-batch': { claimed: 18, found: 18, threads: 19 },
  'no-coderabbit': { claimed: null, found: 1, threads: 3 },
  resolvable: { claimed: 10, found: 10, threads: 10 },
}

/** One real pass over a fixture, with the page put back the way it was. */
function passOver(doc: Document): TriageState {
  let published: TriageState | undefined
  const stop = startEngine(doc, (state) => (published = state))
  stop()
  return published as TriageState
}

describe.each(Object.entries(EXPECTED))('the count check on %s', (name, expected) => {
  let state: TriageState

  beforeAll(() => {
    state = passOver(loadFixture(name))
  })

  it('reads CodeRabbit s own total off the page', () => {
    expect(state.check.claimed).toBe(expected.claimed)
    expect(state.check.found).toBe(expected.found)
    expect(state.threads).toHaveLength(expected.threads)
  })

  it('never fires on a fully rendered capture', () => {
    expect(state.check.missing).toBe(0)
  })
})

/**
 * The trigger the check actually has, reproduced.
 *
 * A12 found a 103 thread pull request opening with a handful of threads in the
 * page, because GitHub renders a long timeline in pieces and CodeRabbit's
 * summary is in the first one. No capture can hold that state, since capturing
 * is done from a page you have finished loading, so it is built by taking a
 * fixture apart: same document, same summaries, most of the threads gone.
 */
describe('the count check on a page GitHub has only half rendered', () => {
  it('names how many of CodeRabbit s findings are not there', () => {
    const doc = loadFixture('resolvable')
    for (const thread of [...doc.querySelectorAll('review-thread-collapsible')].slice(2)) thread.remove()

    expect(passOver(doc).check).toEqual({ claimed: 10, found: 2, missing: 8 })
  })

  it('fires even when every thread is gone, because the summaries are the first chunk', () => {
    const doc = loadFixture('resolvable')
    for (const thread of doc.querySelectorAll('review-thread-collapsible')) thread.remove()

    expect(passOver(doc).check).toEqual({ claimed: 10, found: 0, missing: 10 })
  })
})
