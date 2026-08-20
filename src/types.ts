export type Severity = 'critical' | 'major' | 'minor'

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
 */
export type ParseProblem = 'no-id' | 'no-file' | 'unknown-author' | 'no-body' | 'no-triple'

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
  /** Body absent and only fetchable, which is the v0.2 deferred fetch. */
  collapsed: boolean
  deferredUrl: string | null
  /**
   * Null whenever attribution failed, which includes every collapsed thread.
   * Null always comes with the blocking 'unknown-author' problem, and a thread
   * carrying it is never hidden (invariant 2).
   */
  authors: ThreadAuthors | null
  problems: ParseProblem[]
}
