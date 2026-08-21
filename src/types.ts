/**
 * CodeRabbit's severity words, worst first, which is also the sort order the
 * panel reads them in.
 *
 * Three of the four are counted facts: across the five fixtures the middle
 * `em` reads `🟡 Minor` 29 times, `🟠 Major` 10 times and `🔵 Trivial` 8 times.
 * **`critical` has never appeared in any capture.** It stays because dropping a
 * word only turns a real finding into an unparsed one, which is the failure
 * `trivial` was: unknown severity fails the whole triple, taking the category
 * and the effort with it.
 */
export type Severity = 'critical' | 'major' | 'minor' | 'trivial'

export type PageKind = 'not-pr' | 'classic' | 'react' | 'unknown'

/**
 * What a scan could not read off a thread.
 *
 * Blocking problems and gaps are different things, and the line falls at
 * identity and authorship. If you cannot say which thread this is, or who wrote
 * every comment in it, you do not understand the thread and it is never hidden
 * (invariants 1 and 2). A missing file path or a missing severity triple is a
 * thread you understand and cannot fully describe, which is a badge in the
 * panel, not a veto on hiding.
 *
 *   'no-id'           blocking
 *   'no-file'         gap
 *   'unknown-author'  blocking, produced from A3
 *   'no-body'         blocking, produced from A3
 *   'no-triple'       gap, produced from A4
 *   'fetch-failed'    blocking, produced from B3
 *
 * 'fetch-failed' is the one that is not about markup. A collapsed thread whose
 * deferred fragment did not come back, or came back unreadable, is a thread the
 * extension asked about and cannot describe, which is different from one it has
 * not asked about yet. Both keep the thread visible; only this one is worth
 * warning the reader about, because the other is a request still in flight.
 */
export type ParseProblem =
  | 'no-id'
  | 'no-file'
  | 'unknown-author'
  | 'no-body'
  | 'no-triple'
  | 'fetch-failed'

/**
 * Who wrote a thread, counted rather than summarised, so the panel can badge
 * what it found and the hide policy can make its own decision from the numbers.
 *
 * `fromCodeRabbit` counts only comments positively proven to be CodeRabbit's,
 * so `fromCodeRabbit + fromHumans === comments` always holds and anything not
 * proven lands on the human side. A pending comment is counted as human.
 */
export interface ThreadAuthors {
  comments: number
  /** Comments whose author link is exactly CodeRabbit's account path. */
  fromCodeRabbit: number
  /** Everything else, pending comments included. */
  fromHumans: number
  /** Unsubmitted comments of your own. Always part of `fromHumans`. */
  pending: number
  /** Safe mode hides a thread only when this is true. */
  allFromCodeRabbit: boolean
  /** Aggressive mode hides a thread when this is true. */
  rootIsCodeRabbit: boolean
}

export interface Thread {
  /** The `review-thread-collapsible` element itself. */
  el: Element
  /** Nearest `.js-timeline-item` ancestor. One item holds up to 25 threads. */
  timelineItem: Element | null
  /**
   * Identity within the page, not necessarily GitHub's thread id: the
   * `turbo-frame` this is read from is named `review-thread-or-comment-id-N`
   * and N is sometimes a comment id. Unique per thread, safe as a key, never
   * safe to build a URL out of. Use `deferredUrl` or the resolve form action
   * for that. Empty string only when `problems` carries 'no-id'.
   */
  id: string
  file: string | null
  resolved: boolean
  outdated: boolean
  /**
   * Body absent from the page and only fetchable, which is the deferred fetch.
   *
   * A fact about the page, never about what the extension knows: it stays true
   * after B3 has read the thread over the network, and `authors` is what says
   * whether that read happened.
   */
  collapsed: boolean
  deferredUrl: string | null
  /**
   * Null whenever attribution failed, which includes every collapsed thread the
   * deferred fetch has not answered for. Null always comes with a blocking
   * problem, 'unknown-author' or 'fetch-failed', and a thread carrying it is
   * never hidden (invariant 2).
   */
  authors: ThreadAuthors | null
  problems: ParseProblem[]
}

/**
 * Everything the drawer shows about a thread, read off its root comment.
 *
 * Only `title` is guaranteed: a row with no label is useless and there is
 * always body text, so the title falls back rather than failing. Every other
 * field is null when the page does not carry it, and null here is a gap in the
 * description, never a reason to hide or to skip a thread.
 */
export interface Finding {
  /** Never empty. The line after the severity triple, or the body text, capped. */
  title: string
  /** The three triple fields move together: all three, or all three null. */
  category: string | null
  severity: Severity | null
  effort: string | null
  /** The text inside CodeRabbit's `Prompt for AI Agents` block, newlines kept. */
  aiPrompt: string | null
  /** The root comment's `#discussion_r<id>` fragment. In page, not a full URL. */
  permalink: string | null
}
