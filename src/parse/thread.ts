import type { ParsedThread } from '../types'

/**
 * Scans the classic timeline for review threads.
 *
 * Only expanded threads are candidates: a collapsed thread exposes no author
 * information, so attribution (invariant 2) is impossible without fetching.
 * Resolved threads arrive via their data-deferred-content-url in v0.2.
 */
export function scanThreads(_doc: Document): ParsedThread[] {
  // TODO(v0.1): walk `review-thread-collapsible` elements, attribute authors
  // via `a.author[href="/apps/coderabbitai"]`, parse the severity triple,
  // detect Outdated (.Label) and Pending in batch states.
  return []
}
