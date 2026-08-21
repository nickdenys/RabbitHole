import type { ParseProblem, Thread } from '../types'

export type HideMode = 'safe' | 'aggressive'

/** Why a thread stayed visible. Only ever set on a `hide: false` verdict. */
export type HideReason =
  | 'not-coderabbit'
  | 'human-activity'
  | 'pending'
  | 'unparsed'
  | 'collapsed'
  | 'fetch-failed'

export type HideVerdict = { hide: true } | { hide: false; reason: HideReason }

/**
 * The problems that veto hiding, as opposed to the ones that only leave a badge
 * on the row. The line is identity and authorship, per the note on
 * `ParseProblem`: 'no-file' and 'no-triple' describe a thread you understand and
 * cannot fully label, which is not a reason to keep it on screen.
 *
 * Written out rather than derived, so adding a `ParseProblem` is a decision
 * about whether it blocks rather than a silent default either way.
 */
const BLOCKING: readonly ParseProblem[] = ['no-id', 'unknown-author', 'no-body', 'fetch-failed']

/**
 * Whether a thread may be hidden, and when it may not, why.
 *
 * Pure: it reads the `Thread` record and touches no DOM, so every case below is
 * testable without a page. The two invariants this module exists to uphold:
 *
 *  1. Never hide a thread that could not be parsed.
 *  2. Never hide a thread you cannot positively attribute to CodeRabbit.
 *
 * Safe mode (default): hide only threads where every comment is CodeRabbit's.
 * A human reply, or a pending comment of your own, keeps the thread visible.
 * Aggressive mode (opt-in toggle): hide all CodeRabbit-rooted threads.
 *
 * The two modes differ by exactly one rule, the `human-activity` one. Neither
 * mode can skip the unparsed, collapsed or not-coderabbit rules, which is what
 * makes both invariants hold in both modes rather than in one of them.
 */
export function hideVerdict(thread: Thread, mode: HideMode): HideVerdict {
  // Both ahead of the blocking-problem check, which is a deliberate departure
  // from the build plan's order. A2 gives every collapsed thread the blocking
  // 'unknown-author' problem, because its comments are genuinely not in the
  // page, so testing problems first would answer 'unparsed' for all 97
  // collapsed threads in the fixtures and leave both of these unreachable. All
  // three orders keep the thread visible; this one tells the panel which of the
  // three things is actually wrong, and they have different fixes.
  //
  // 'fetch-failed' first, because it is only ever set on a collapsed thread and
  // is the more specific answer: the fetch that would have fixed 'collapsed'
  // has already run and did not.
  if (thread.problems.includes('fetch-failed')) return { hide: false, reason: 'fetch-failed' }

  // `authors === null` is what makes this a statement about the fetch rather
  // than about the page. A thread B3 has read is still collapsed, its comments
  // are still not in the timeline, and there is nothing left to wait for, so it
  // goes on to the ordinary rules and can be hidden like any other.
  if (thread.collapsed && thread.authors === null) return { hide: false, reason: 'collapsed' }

  const authors = thread.authors

  // `authors === null` always arrives with 'unknown-author', so the second half
  // of this test is what the type system needs rather than a second rule.
  if (authors === null || thread.problems.some(isBlocking)) return { hide: false, reason: 'unparsed' }

  // Invariant 2, and the one rule aggressive mode also cannot skip: the root
  // comment has to be provably CodeRabbit's.
  if (!authors.rootIsCodeRabbit) return { hide: false, reason: 'not-coderabbit' }

  // Ahead of the mode split on purpose. An unsubmitted comment of your own is
  // work in progress, and hiding the thread you are drafting on would lose it
  // in either mode.
  if (authors.pending > 0) return { hide: false, reason: 'pending' }

  if (mode === 'safe' && !authors.allFromCodeRabbit) return { hide: false, reason: 'human-activity' }

  return { hide: true }
}

function isBlocking(problem: ParseProblem): boolean {
  return BLOCKING.includes(problem)
}
