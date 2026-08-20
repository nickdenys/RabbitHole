import { describe, expect, it } from 'vitest'
import { hideVerdict, type HideMode } from '../src/hide/policy'
import { scanThreads } from '../src/parse/thread'
import { fixtureNames, loadFixture } from './support/fixture'

/**
 * The safety net, kept apart from `hide-policy.test.ts` on purpose.
 *
 * That file tests the rules as written. This one ignores the rules and asserts
 * the two invariants over **every thread in every fixture, in both modes**:
 *
 *  1. Never hide a thread that could not be parsed.
 *  2. Never hide a thread you cannot positively attribute to CodeRabbit.
 *
 * It never names a fixture, so every capture added later becomes an invariant
 * test for free, and a rule reordered in a way that breaks a mode fails here
 * even when the unit tests still agree with each other.
 */
const MODES: HideMode[] = ['safe', 'aggressive']

const NAMES = fixtureNames()

// Parsed once and shared, as in the other fixture tests: human-replies.html is
// 8.3 MB and re-parsing it per case exhausts the test worker. Nothing here
// mutates a document.
const scans = Object.fromEntries(NAMES.map((name) => [name, scanThreads(loadFixture(name))]))

/**
 * Hide counts as of 20 August 2026, derived from the counts already pinned in
 * finding.test.ts: safe mode hides every readable CodeRabbit-rooted thread with
 * no human reply and nothing pending.
 *
 * The two modes agree on three of the five fixtures, which is the point of the
 * table. Aggressive only pulls ahead where humans replied, and `human-replies`
 * is the only capture where that happens: its 10 replied-to threads are the
 * whole difference between the two columns.
 */
const HIDES = {
  'unresolved-and-resolved': { safe: 2, aggressive: 2 },
  'human-replies': { safe: 17, aggressive: 27 },
  'pending-in-batch': { safe: 7, aggressive: 7 },
  'no-coderabbit': { safe: 0, aggressive: 0 },
  'resolvable': { safe: 10, aggressive: 10 },
} as const

const BLOCKING = ['no-id', 'unknown-author', 'no-body']

describe.each(NAMES)('%s', (name) => {
  describe.each(MODES)('%s mode', (mode) => {
    it('hides nothing it could not parse', () => {
      for (const thread of scans[name]) {
        if (!hideVerdict(thread, mode).hide) continue

        expect(thread.problems.filter((p) => BLOCKING.includes(p))).toEqual([])
        expect(thread.id).not.toBe('')
      }
    })

    it('hides nothing it could not attribute to CodeRabbit', () => {
      for (const thread of scans[name]) {
        if (!hideVerdict(thread, mode).hide) continue

        expect(thread.authors).not.toBeNull()
        expect(thread.authors?.rootIsCodeRabbit).toBe(true)
      }
    })

    it('hides no collapsed thread, whose comments are not in the page at all', () => {
      for (const thread of scans[name]) {
        if (!hideVerdict(thread, mode).hide) continue

        expect(thread.collapsed).toBe(false)
      }
    })

    it('hides nothing with a pending comment of your own', () => {
      for (const thread of scans[name]) {
        if (!hideVerdict(thread, mode).hide) continue

        expect(thread.authors?.pending).toBe(0)
      }
    })

    // Without this the four assertions above pass on a policy that hides
    // nothing, which is exactly the bug they would not catch.
    it('hides the expected number of threads', () => {
      const hidden = scans[name].filter((thread) => hideVerdict(thread, mode).hide)

      expect(hidden.length).toBe(HIDES[name as keyof typeof HIDES][mode])
    })
  })
})

it('hides nothing at all on a PR CodeRabbit never touched', () => {
  // The step's own done-when condition, and the strongest single case: not one
  // of the three threads is CodeRabbit's, so even aggressive mode must leave
  // the whole page alone.
  for (const mode of MODES) {
    expect(scans['no-coderabbit'].filter((thread) => hideVerdict(thread, mode).hide)).toEqual([])
  }
})

it('hides something somewhere, so the invariants are not vacuous', () => {
  const hidden = NAMES.flatMap((name) => scans[name].filter((thread) => hideVerdict(thread, 'safe').hide))

  expect(hidden.length).toBe(36)
})
