import type { TriageRow } from './engine'
import { hasLoadMore } from './loadmore'
import type { CodeRabbitNote } from './parse/notes'

/**
 * CodeRabbit's own total, against the threads that are actually in the page.
 *
 * `claimed` is null when no summary carries a number, which is not the same as
 * zero: a pull request CodeRabbit never reviewed makes no claim, and a check
 * with nothing to compare against must stay quiet rather than warn that every
 * human thread is unaccounted for. `no-coderabbit.html` is that case, one
 * collapsed thread and no summaries.
 *
 * `missing` is the whole output. It is deliberately one sided, see `countCheck`.
 * `more` is not part of the arithmetic at all: it is what the panel needs to
 * tell a reader who can fix the gap from one who cannot.
 */
export interface CountCheck {
  /** Sum of every `Actionable comments posted: N` on the page. */
  claimed: number | null
  /** Threads found that are not provably somebody else's. */
  found: number
  /** How many of `claimed` are not in the page. Zero whenever nothing is wrong. */
  missing: number
  /**
   * Whether GitHub still has a "Load more" control in the page.
   *
   * Read only for the wording of the warning, never for `missing`: a shortfall
   * is a shortfall whether or not anything can be done about it.
   */
  more: boolean
}

export const NO_CHECK: CountCheck = { claimed: null, found: 0, missing: 0, more: false }

/**
 * Whether the page holds every finding CodeRabbit says it posted.
 *
 * **It warns only when the page holds fewer, never when it holds more**, which
 * is a narrowing of the build plan's "when they disagree" and the only reading
 * that produces a warning worth having.
 *
 * More threads than the total is the ordinary state of a busy pull request:
 * human threads count towards `found` because a collapsed one cannot be
 * attributed to anybody, and CodeRabbit posts comments outside its actionable
 * total. `human-replies.html` is 103 threads against a claimed 102, so a
 * two sided check would fire on a fully rendered page and teach the reader that
 * the warning means nothing. Fewer threads than the total is the failure this
 * extension exists to prevent: a small, reassuring number that is not the truth.
 *
 * **The trigger it was designed for and the trigger it actually has are not the
 * same.** [[Open questions|Question 1]] asked about GitHub dropping a thread,
 * which may never be observable here. GitHub renders a long timeline in chunks,
 * CodeRabbit's summary is in the first chunk and the threads it counts are not,
 * so a 103 thread pull request opens claiming 102 and holding 13. That fires on
 * every long pull request, and it is a true statement about the page.
 *
 * Pure, and it reads the verdicts rather than the threads: 'not-coderabbit' is
 * the policy's word for a thread proven to be someone else's, and re-deriving
 * it here would be a second opinion that could disagree with the drawer's.
 */
export function countCheck(
  notes: readonly CodeRabbitNote[],
  rows: readonly TriageRow[],
  doc: Document,
): CountCheck {
  const counted = notes.filter((note) => note.actionableCount !== null)
  const claimed = counted.length === 0 ? null : counted.reduce((sum, note) => sum + (note.actionableCount ?? 0), 0)
  const found = rows.filter(isCodeRabbitsOrUnknown).length

  return {
    claimed,
    found,
    missing: claimed === null ? 0 : Math.max(0, claimed - found),
    more: hasLoadMore(doc),
  }
}

/**
 * Everything except a thread positively proven to be someone else's, which is
 * exactly the population the drawer lists and counts as unread.
 *
 * A collapsed thread is included although nobody has read it. It is a thread
 * CodeRabbit may well have posted, and leaving it out would count it as missing
 * while it is sitting in the timeline.
 */
function isCodeRabbitsOrUnknown(row: TriageRow): boolean {
  return row.verdict.hide || row.verdict.reason !== 'not-coderabbit'
}
