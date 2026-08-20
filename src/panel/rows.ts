import type { TriageRow, TriageState } from '../engine'
import { sessionFinding } from './actions'

/**
 * What the drawer shows instead of a list, and why. Invariant 3 as a user sees
 * it: "nothing to do" and "this page could not be read" must never look alike.
 *
 *   'unsupported'  the detector does not know this build, so nothing was hidden
 *   'no-findings'  the page was read and holds no CodeRabbit thread at all
 *   'all-done'     there are findings and none of them is still open
 */
export type EmptyState = 'unsupported' | 'no-findings' | 'all-done'

/**
 * The rows the drawer lists, which is not every thread on the page.
 *
 * Two kinds are left out, and both are left out because listing them would be a
 * claim the extension cannot make:
 *
 *   **`not-coderabbit`** is a thread whose root comment is provably someone
 *   else's. It is a human conversation on the pull request, still in the
 *   timeline where it belongs, and it is not part of a CodeRabbit worklist.
 *
 *   **`collapsed`** is a resolved thread whose comments GitHub did not render,
 *   so there is nothing to say about it beyond its file: no author, no title,
 *   no severity. v0.1 is the unresolved worklist and B3 fetches these. Until
 *   then the drawer says how many it is not showing rather than listing 97
 *   rows that all read "unreadable".
 *
 * **A thread resolved in this session is the exception to the second one.** It
 * collapses the moment GitHub accepts the click, and dropping it would make the
 * checklist erase the line the reader just finished. Its description is still
 * held from before the resolve, so the row is listed and drawn from that; see
 * `sessionFinding`.
 *
 * Everything else is listed, hidden or not, which is the point: a row is the
 * only place a hidden finding still exists.
 */
export function listedRows(state: TriageState): TriageRow[] {
  return state.rows.filter(isListed).map(described)
}

function isListed(row: TriageRow): boolean {
  if (row.verdict.hide) return true
  return row.verdict.reason !== 'not-coderabbit' && !isUnread(row)
}

/**
 * The row as the drawer should draw it, which for a thread resolved in this
 * session is the description parsed before it collapsed.
 *
 * The thread itself is always the fresh one, so `resolved`, `outdated` and the
 * file stay whatever the page says now. Only the finding, which the page no
 * longer carries at all, comes out of the cache.
 */
function described(row: TriageRow): TriageRow {
  if (row.finding !== null) return row

  const remembered = sessionFinding(row.thread.id)
  return remembered === undefined ? row : { ...row, finding: remembered }
}

/**
 * Threads that exist, are resolved, and cannot be read until the v0.2 fetch.
 * Counted so the drawer can admit to them; see `listedRows`.
 */
export function unreadCount(state: TriageState): number {
  return state.rows.filter(isUnread).length
}

/**
 * Collapsed, and with nothing held about it from earlier in the session. The
 * one predicate behind both the list and the count, so a thread can never be
 * both drawn and reported as one the drawer is not showing.
 */
function isUnread(row: TriageRow): boolean {
  if (row.verdict.hide || row.verdict.reason !== 'collapsed') return false
  return sessionFinding(row.thread.id) === undefined
}

/** Null when there is a list to draw. */
export function emptyState(state: TriageState, listed: TriageRow[]): EmptyState | null {
  if (state.kind !== 'classic') return 'unsupported'
  if (listed.length === 0 && unreadCount(state) === 0) return 'no-findings'
  if (listed.every((row) => row.thread.resolved)) return 'all-done'
  return null
}

/**
 * The states worth putting on a row, in a fixed order so a scan down the list
 * lines up. All facts, never a judgement: `Unparsed` is the policy's word, the
 * rest are read off the thread.
 */
export function badges(row: TriageRow): string[] {
  const { thread } = row
  const found: string[] = []

  if (thread.resolved) found.push('Resolved')
  if (thread.outdated) found.push('Outdated')
  if (thread.authors && thread.authors.pending > 0) found.push('Pending')
  if (hasHumanReply(row)) found.push('Human reply')
  if (!row.verdict.hide && row.verdict.reason === 'unparsed') found.push('Unparsed')

  return found
}

/**
 * A reply from a person, which is not the same as "has a human comment": a
 * pending comment of your own is counted as human by `readAuthors` and already
 * has its own badge, so subtracting it keeps the two from firing together on
 * one unsubmitted draft.
 */
function hasHumanReply(row: TriageRow): boolean {
  const authors = row.thread.authors
  return authors !== null && authors.fromHumans - authors.pending > 0
}

/**
 * Why this finding is still in the timeline, or null if it was hidden.
 *
 * Without this a reader who sees a CodeRabbit comment the extension left on the
 * page has no way to tell a deliberate exception from a broken extension, and
 * the safe policy makes exceptions constantly.
 */
export function keptReason(row: TriageRow): string | null {
  if (row.verdict.hide) return null

  switch (row.verdict.reason) {
    case 'human-activity':
      return 'Left in the timeline: someone replied to it'
    case 'pending':
      return 'Left in the timeline: you have an unsubmitted comment on it'
    case 'unparsed':
      return 'Left in the timeline: this thread could not be read'
    case 'collapsed':
      return 'Left in the timeline: resolved, and its comments are not on the page'
    case 'not-coderabbit':
      return 'Left in the timeline: not a CodeRabbit thread'
  }
}
