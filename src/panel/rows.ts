import type { TriageRow, TriageState } from '../engine'
import { sessionFinding } from './actions'

/**
 * Whether the extension can point at anything on this page that is CodeRabbit's.
 *
 * **Invariant 4: the panel is only ever absent from a page it has not touched.**
 * A pull request CodeRabbit never reviewed gets no handle at all, which is what
 * a reader means by the extension being quiet where it has nothing to say. That
 * is only honest while the absence cannot hide a finding, and this predicate is
 * what makes it so: every route to a `hide: true` verdict proves the root
 * comment is CodeRabbit's, and every note hidden is a note found here, so a
 * page with no evidence is a page with an untouched timeline.
 *
 * **Positive evidence, never the absence of a thread.** The naive test, "no
 * CodeRabbit rows", flickers: GitHub collapses every resolved thread whoever
 * wrote it, so a resolved human thread is unattributable until the deferred
 * fetch answers for it. `no-coderabbit.html` is exactly that page, three
 * threads of which one is collapsed, and an absence test would draw the handle,
 * wait for the fetch and then take it away again. Asking for proof instead
 * makes the panel monotonic within a page: it can appear when CodeRabbit posts
 * a review while you are reading, and it never vanishes underneath you.
 *
 * So `collapsed` is not evidence, because nobody has read that thread yet, and
 * `not-coderabbit` is evidence of the opposite. Everything else is proof: a
 * note carries CodeRabbit's own account link, and the four remaining kept
 * reasons are all reached past the `rootIsCodeRabbit` test or are a thread the
 * extension could not read, which is the case invariant 3 exists for and which
 * must keep its warning.
 *
 * Readability is not asked about here, and the caller must ask first. An
 * unreadable build publishes no notes and no rows, so this would answer false
 * for the one page whose whole point is to say it could not be read. See
 * `mount.tsx`.
 *
 * Takes the two fields it reads rather than the whole state, so the invariant
 * suite can compose one out of a scan the way it composes its verdicts, without
 * standing up an engine to ask a question about two arrays.
 */
export function hasCodeRabbit(state: Pick<TriageState, 'notes' | 'rows'>): boolean {
  if (state.notes.length > 0) return true

  return state.rows.some((row) => isEvidence(row))
}

function isEvidence(row: TriageRow): boolean {
  if (row.verdict.hide) return true
  return row.verdict.reason !== 'not-coderabbit' && row.verdict.reason !== 'collapsed'
}

/**
 * What the drawer shows instead of a list, and why. Invariant 3 as a user sees
 * it: "nothing to do" and "this page could not be read" must never look alike.
 *
 *   'unsupported'  the detector does not know this build, so nothing was hidden
 *   'no-findings'  CodeRabbit reviewed this pull request and posted no finding
 *   'all-done'     there are findings and none of them is still open
 *
 * 'no-findings' narrowed when invariant 4 arrived. It used to cover a page with
 * no CodeRabbit thread on it at all, which is now a page with no panel: the
 * drawer cannot be opened there, so the only way to reach this state is a
 * review that posted its walkthrough and its summary and listed nothing under
 * them. See `hasCodeRabbit`.
 */
export type EmptyState = 'unsupported' | 'incomplete' | 'no-findings' | 'all-done'

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
 *   **`collapsed`** is a resolved thread whose comments GitHub did not render
 *   and the deferred fetch has not answered for yet, so there is nothing to say
 *   about it beyond its file: no author, no title, no severity. The drawer says
 *   how many it is not showing rather than listing 97 rows that all read
 *   "unreadable", and each one leaves this count as its fragment arrives. A
 *   fetch that failed is not this: it is listed, badged and counted as
 *   unreadable, because a thread nobody could read is exactly what this
 *   extension must never omit.
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
 * Threads that exist, are resolved, and have not been read back yet. Counted so
 * the drawer can admit to them; see `listedRows`.
 */
export function unreadCount(state: TriageState): number {
  return state.rows.filter(isUnread).length
}

/**
 * Collapsed, unfetched, and with nothing held about it from earlier in the
 * session. The one predicate behind both the list and the count, so a thread
 * can never be both drawn and reported as one the drawer is not showing.
 *
 * It is a transient state rather than a permanent one: the fetch starts with
 * the page, every answer moves the row into the list, and a thread the fetch
 * could not read gets 'fetch-failed' and is listed as unreadable rather than
 * staying in this count. So the number counts requests in flight, which is what
 * the drawer's notice says about it. Since the asking moved off the drawer, a
 * reader who opens it a moment after the page settles usually sees no notice at
 * all, because there is nothing left in flight to report.
 */
function isUnread(row: TriageRow): boolean {
  if (row.verdict.hide || row.verdict.reason !== 'collapsed') return false
  return sessionFinding(row.thread.id) === undefined
}

/**
 * Null when there is a list to draw, and null as well when the count check is
 * warning.
 *
 * The last two states are claims about completeness. "No CodeRabbit findings"
 * says the page was read in full, and "nothing left to do" says every finding
 * on it is closed, and the check firing is CodeRabbit's own total saying neither
 * is true. Drawing one of them under the warning would put the reassuring
 * sentence and the correction in the same drawer, which is invariant 3's
 * failure in miniature: the reader believes the larger text.
 *
 * The warning notice says what is wrong and how many are missing, so nothing is
 * lost by staying quiet here. `unsupported` still wins, because a build that
 * could not be read has no counts to compare in the first place.
 *
 * **`incomplete` sits above both completeness claims for the same reason the
 * warning does, and it is the case a number cannot catch.** Found 31 August
 * 2026 on [leynos/cuprum#234](https://github.com/leynos/cuprum/pull/234), a
 * pull request with roughly 102 findings, where the drawer said CodeRabbit had
 * posted nothing. GitHub renders a long timeline in chunks; on that page the
 * walkthrough is in the first chunk, which is what mounts the panel, and every
 * `Actionable comments posted: N` is in the collapsed middle along with the
 * threads. So `claimed` is null, `countCheck` stays quiet by design because it
 * has nothing to compare against, and the fall-through was the most reassuring
 * sentence in the panel on the emptiest possible reading of the page.
 *
 * `check.more` is the fact that fixes it: GitHub's own "Load more" is still in
 * the page, so there is timeline this extension has not seen, and a completeness
 * claim over an admittedly partial page is not one it may make. It is asked
 * before the two claims and never before the warning, which is the more specific
 * statement whenever both are true.
 *
 * The 28 August reasoning behind `countCheck` assumed the summary was always in
 * the first chunk. That held for every fixture, because all five were captured
 * with the timeline expanded by hand. It is not true of a long pull request as a
 * reader actually meets it. See the 31 August [[Decision log]] entry.
 */
export function emptyState(state: TriageState, listed: TriageRow[]): EmptyState | null {
  if (state.kind !== 'classic') return 'unsupported'
  if (state.check.missing > 0) return null

  const claimsCompleteness = listed.length === 0 || listed.every((row) => row.thread.resolved)
  if (claimsCompleteness && state.check.more) return 'incomplete'

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
  if (!row.verdict.hide && row.verdict.reason === 'fetch-failed') found.push('Unfetched')

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
      return 'Left in the timeline: resolved, and its comments are still being read'
    case 'fetch-failed':
      return 'Left in the timeline: resolved, and its comments could not be fetched'
    case 'not-coderabbit':
      return 'Left in the timeline: not a CodeRabbit thread'
  }
}
