import { describe, expect, it } from 'vitest'
import type { TriageRow } from '../src/engine'
import { applyHiding, revealAll } from '../src/hide/apply'
import { hideVerdict, type HideMode } from '../src/hide/policy'
import { hasCodeRabbit } from '../src/panel/rows'
import { scanNotes } from '../src/parse/notes'
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
 * Invariant 4 is asserted at the bottom of this file rather than in this block,
 * because it is a claim about the whole page rather than about one thread.
 *
 * It never names a fixture, so every capture added later becomes an invariant
 * test for free, and a rule reordered in a way that breaks a mode fails here
 * even when the unit tests still agree with each other.
 *
 * From A7 it also checks the page after the hide engine has written to it,
 * which is where the invariants finally bite: a verdict nobody applies is
 * harmless, and the engine hides whole timeline items rather than the elements
 * it was handed, so "only hideable threads got a verdict" is no longer the same
 * claim as "only hideable threads left the page".
 */
const MODES: HideMode[] = ['safe', 'aggressive']

const NAMES = fixtureNames()

// Parsed once and shared, as in the other fixture tests: human-replies.html is
// 8.3 MB and re-parsing it per case exhausts the test worker. Nothing here
// mutates a document.
// The applied cases below mutate these documents and undo it in the same test:
// `revealAll` removes the class and the stylesheet, which is the whole of the
// engine's footprint, so a shared document survives it intact.
const docs = Object.fromEntries(NAMES.map((name) => [name, loadFixture(name)])) as Record<
  string,
  Document
>
const scans = Object.fromEntries(NAMES.map((name) => [name, scanThreads(docs[name])]))
const notes = Object.fromEntries(NAMES.map((name) => [name, scanNotes(docs[name])]))

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
  'resolvable': { safe: 9, aggressive: 9 },
  // Nothing is hidden on a page GitHub has barely rendered: its one thread is
  // collapsed, so no mode can attribute it and both leave it alone.
  'partial-timeline': { safe: 0, aggressive: 0 },
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

    /**
     * The one assertion that reads the page rather than the verdicts.
     *
     * The engine collapses a review into its `.js-timeline-item` whenever
     * everything inside is going, so what actually disappears is not always
     * what the policy named. This walks the other way: for every element left
     * carrying the class, every thread inside it has to have earned a `hide`
     * verdict, and every comment outside a thread has to be one of CodeRabbit's
     * two notes. A collapse that swallowed one extra thread fails here.
     */
    it('hides no thread and no comment that was not proven hideable', () => {
      const doc = docs[name]
      const verdicts = new Map(scans[name].map((thread) => [thread.el, hideVerdict(thread, mode)]))
      const hideable = scans[name].filter((thread) => verdicts.get(thread.el)?.hide)

      try {
        applyHiding(
          [...hideable.map((thread) => thread.el), ...notes[name].map((note) => note.el)],
          doc,
        )

        for (const el of doc.querySelectorAll('.rh-hidden')) {
          for (const thread of el.querySelectorAll('review-thread-collapsible')) {
            expect(verdicts.get(thread)?.hide, `thread in ${el.className}`).toBe(true)
          }

          for (const group of el.querySelectorAll('.timeline-comment-group')) {
            if (group.closest('review-thread-collapsible') !== null) continue

            expect(
              notes[name].some((note) => note.el.contains(group)),
              `standalone comment in ${el.className}`,
            ).toBe(true)
          }
        }
      } finally {
        revealAll(doc)
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

/**
 * **Invariant 4: the panel is only ever absent from a page it has not touched.**
 *
 * Stated the way it can fail rather than the way it is written: if the panel
 * has decided there is no CodeRabbit here, then nothing on this page was
 * hidden. The dangerous version of the feature is a handle that disappears from
 * a page whose findings the extension has already taken out of the timeline,
 * which is invariant 3's failure with the evidence removed as well.
 *
 * Composed from the scan the way every case above is, rather than run through
 * `startEngine`: the predicate reads two arrays, and the pass that would build
 * them is the most expensive thing in this suite on an 8.3 MB capture that five
 * files already parse. `finding` is null throughout because nothing here reads
 * it, and `hasCodeRabbit` does not.
 *
 * Both modes, because aggressive mode hides strictly more and is therefore the
 * mode in which an absent panel could hide the most.
 */
describe.each(MODES)('%s mode', (mode) => {
  describe.each(NAMES)('%s', (name) => {
    it('hides nothing on a page it says has no CodeRabbit on it', () => {
      const doc = docs[name]
      const rows: TriageRow[] = scans[name].map((thread) => ({
        thread,
        finding: null,
        verdict: hideVerdict(thread, mode),
      }))

      if (hasCodeRabbit({ notes: notes[name], rows })) return

      try {
        applyHiding(
          [
            ...rows.filter((row) => row.verdict.hide).map((row) => row.thread.el),
            ...notes[name].map((note) => note.el),
          ],
          doc,
        )

        expect(doc.querySelectorAll('.rh-hidden'), 'elements taken off the page').toHaveLength(0)
      } finally {
        revealAll(doc)
      }
    })
  })
})

// Without the second half this passes on every fixture by never firing, which
// is exactly the bug it would not catch.
it('has a fixture with no CodeRabbit on it, and four with', () => {
  const answers = NAMES.map((name) => {
    const rows: TriageRow[] = scans[name].map((thread) => ({
      thread,
      finding: null,
      verdict: hideVerdict(thread, 'safe'),
    }))

    return hasCodeRabbit({ notes: notes[name], rows })
  })

  expect(answers.filter((yes) => !yes)).toHaveLength(1)
  expect(answers.filter((yes) => yes)).toHaveLength(NAMES.length - 1)
})

it('hides something somewhere, so the invariants are not vacuous', () => {
  const hidden = NAMES.flatMap((name) => scans[name].filter((thread) => hideVerdict(thread, 'safe').hide))

  expect(hidden.length).toBe(35)
})
