import type { ParseProblem, Thread } from '../types'

const THREAD = 'review-thread-collapsible'
const TIMELINE_ITEM = '.js-timeline-item'
const THREAD_FRAME = 'turbo-frame[id^="review-thread-or-comment-id-"]'
const RESOLVE_FORM = 'form[action$="/resolve"]'
const COMMENT_BODY = '.comment-body'

/**
 * The file path sits in the thread's header row, as the only link carrying
 * these three Primer classes. Verified 20 August 2026: exactly one match in
 * every one of the 148 threads across the five fixtures, collapsed and expanded
 * alike, and its text is the path every time.
 *
 * The path is read from the link text rather than its href, because the href is
 * a diff anchor (`/pull/2/files#diff-<hash>`, or `/files/<sha>#diff-<hash>` on
 * an outdated thread) and carries no path at all.
 */
const FILE_LINK = 'a.text-mono.text-small.Link--primary'

const THREAD_ID_IN_URL = /\/threads\/(\d+)/
const FRAME_ID = /^review-thread-or-comment-id-(\d+)$/

/**
 * Every review thread in the page, in document order, with what can be read off
 * it without fetching anything: which thread it is, which file, what state.
 *
 * Authors, bodies and the severity triple are not read here. Nothing is hidden
 * off this alone, because attribution (invariant 2) is a separate pass.
 *
 * Collapsed threads are included. They carry an id, a file and their state, and
 * excluding them would make the panel silently under-report the review.
 */
export function scanThreads(doc: Document): Thread[] {
  return [...doc.querySelectorAll(THREAD)].map(readThread)
}

function readThread(el: Element): Thread {
  const problems: ParseProblem[] = []

  const id = readId(el)
  if (id === null) problems.push('no-id')

  const file = readFile(el)
  if (file === null) problems.push('no-file')

  const deferredUrl = el.getAttribute('data-deferred-content-url')

  return {
    el,
    timelineItem: el.closest(TIMELINE_ITEM),
    id: id ?? '',
    file,
    // Exactly "true" and nothing else, so an unfamiliar vocabulary fails
    // towards showing the thread rather than hiding it.
    resolved: el.getAttribute('data-resolved') === 'true',
    outdated: isOutdated(el),
    // Derived from what is present, not from `resolved`: they are two separate
    // facts, and GitHub can render an expanded thread that is also resolved.
    collapsed: deferredUrl !== null && el.querySelector(COMMENT_BODY) === null,
    deferredUrl,
    problems,
  }
}

/**
 * Three sources, most reliably present first.
 *
 * Measured 20 August 2026 across the five fixtures: the enclosing `turbo-frame`
 * exists for all 148 threads, a `data-deferred-content-url` for the 97 that are
 * resolved, and a resolve form for the 10 whose reader had permission to use
 * it. So the frame is the only one that always answers, and the form action,
 * despite being the source the design started from, is the rare one.
 *
 * The frame id is an identity, not a thread id: on 3 of the 103 threads in
 * `human-replies.html` it is the thread's first comment id instead, matching
 * `data-hidden-comment-ids` rather than the deferred URL. It stays first
 * because a key that is always there beats a key that appears when a thread
 * changes state, and `deferredUrl` is on the row for anything that needs the
 * real thread id.
 */
function readId(el: Element): string | null {
  const frame = el.closest(THREAD_FRAME)?.id.match(FRAME_ID)?.[1]
  if (frame) return frame

  const deferred = el.getAttribute('data-deferred-content-url')?.match(THREAD_ID_IN_URL)?.[1]
  if (deferred) return deferred

  const action = el.querySelector(RESOLVE_FORM)?.getAttribute('action')?.match(THREAD_ID_IN_URL)?.[1]
  return action ?? null
}

function readFile(el: Element): string | null {
  const path = el.querySelector(FILE_LINK)?.textContent?.trim()
  return path ? path : null
}

/**
 * `Outdated` is a real `.Label` in the header row rather than loose text.
 * Verified 20 August 2026: 73 of them across the fixtures, every one in the
 * header, none inside a comment body, and matching the exact trimmed string
 * finds precisely the same set as a substring search.
 */
function isOutdated(el: Element): boolean {
  return [...el.querySelectorAll('.Label')].some((label) => label.textContent?.trim() === 'Outdated')
}
