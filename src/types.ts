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
  problems: ParseProblem[]
}
