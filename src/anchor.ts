import { isHidden, reveal } from './hide/apply'

/**
 * The reader arrived on a link to one comment, so that comment has to be on the
 * screen.
 *
 * A permalink like `.../pull/590#discussion_r3587410203` is how a CodeRabbit
 * finding gets sent to somebody, and it is the one case where the extension's
 * whole purpose works against the reader: the browser scrolls to the fragment,
 * the first pass hides the thread it names, and the link lands on a page with
 * no visible target. **The link has to work exactly as it would without the
 * extension installed**, which means the thread stays in the timeline and the
 * page scrolls to it.
 *
 * That is deliberately the reader's own reveal rather than a new kind of
 * exception in the hide policy. Following a link is the same gesture as
 * pressing a row's title: it says "show me this one", it survives every later
 * pass ([[hide/apply]]'s rule), and it is reversible from the panel like any
 * other revealed row. The policy keeps deciding about every other thread, and
 * invariants 1 and 2 are untouched, because nothing here hides anything.
 */

/**
 * A comment id inside GitHub's `#discussion_r<id>` fragment.
 *
 * Used only for the second lookup below. Every other fragment shape GitHub
 * links to (`#issuecomment-…`, `#pullrequestreview-…`) is found by id in the
 * page or not at all, so nothing here needs to know their vocabulary.
 */
const DISCUSSION_ID = /^discussion_r(\d+)$/

/**
 * A collapsed thread, which is the only kind that carries the ids of comments
 * GitHub has not rendered. See `threadHolding`.
 */
const COLLAPSED_THREAD = 'review-thread-collapsible[data-hidden-comment-ids]'

/**
 * How that attribute separates its ids: commas, per [[DOM reference]], counted
 * 28 August 2026 over the five committed fixtures. 99 threads carry it, 23 of
 * them hold more than one comment, and every one of those 23 is comma separated
 * with no space. Whitespace is accepted as well because the split costs nothing
 * and the whole point of this lookup is that the thread's comments are not in
 * the page to check against.
 */
const ID_SEPARATOR = /[\s,]+/

/**
 * The fragment already anchored, so the page is scrolled once per link rather
 * than on every pass.
 *
 * Module level for the same reason the reveal set is: it belongs to the page,
 * it has to outlive a pass, and the engine clears it on the way to a different
 * one. See `forgetAnchor`.
 */
let anchored: string | null = null

/**
 * Where the page was left by our own scroll, or null once it is no longer ours
 * to move.
 *
 * The scroll cannot be a single shot. GitHub renders long conversations in
 * pieces and the panel clicks "Load more" for the reader, so content keeps
 * arriving *above* the anchored comment and pushes it off the screen seconds
 * after the link appeared to work. So the anchor is held: while the offset is
 * still the one we left, a later pass scrolls again, which is a no-op unless
 * something moved.
 *
 * **The reader always wins.** An offset that is not ours is the reader having
 * scrolled, and from that moment the page is theirs and nothing here touches it
 * again. Note that a browser doing its own scroll anchoring, to keep the
 * content stable as the timeline grows, also reads as "not ours" here, which is
 * the right answer for the wrong reason: it has already done this job.
 */
let restingAt: number | null = null

/**
 * Put the fragment's comment back on the screen, and keep it there while the
 * page settles.
 *
 * `targets` is the same list `applyHiding` was just given, so this asks the one
 * question that matters without repeating any of the policy: which element that
 * is about to be hidden holds the comment the reader asked for. Handing it in
 * rather than re-deriving it also means a target this module has never heard
 * of, a note as much as a thread, is revealed on the same rule.
 *
 * Called at the end of every pass, and does nothing at all in the common case:
 * no fragment, or one already anchored and already at rest.
 */
export function followAnchor(doc: Document, url: string, targets: readonly Element[]): void {
  const id = fragmentOf(url)

  // A URL with no fragment is not "the same page without the scroll": it is a
  // reader who navigated away from the link, and coming back to it has to
  // anchor again.
  if (id === null) {
    forgetAnchor()
    return
  }

  if (id === anchored) {
    hold(doc, id)
    return
  }

  const el = anchorElement(doc, id)

  // Nothing by that name in the page yet, which is ordinary rather than wrong:
  // GitHub renders the timeline in pieces, so the thread being linked to can
  // still be behind a "Load more". Left unanchored, so the pass that finally
  // renders it is the pass that scrolls to it.
  if (el === null) return

  const target = targets.find((candidate) => candidate === el || candidate.contains(el))
  if (target !== undefined) reveal(target)

  anchored = id
  restingAt = scrollTo(doc, el)
}

/**
 * Forget the link, so the next one anchors from scratch.
 *
 * Called by the engine wherever the page it was reading is gone: a different
 * pull request, a build it cannot read, and its own teardown. Without it, a
 * round trip through Files changed would come back to the same fragment,
 * find it already anchored, and leave the thread hidden, because the reveal
 * that was holding it in the timeline was dropped along the way.
 */
export function forgetAnchor(): void {
  anchored = null
  restingAt = null
}

/**
 * Keep the anchored comment where we put it, until the reader takes over.
 *
 * Every exit that clears `restingAt` is permanent for this fragment, and they
 * are all the same statement: the page is no longer ours to move. A comment
 * that is momentarily absent is not one of them, because GitHub swaps a
 * thread's partial in place on resolve, and the element comes back.
 */
function hold(doc: Document, id: string): void {
  if (restingAt === null) return

  const view = doc.defaultView
  if (view === null || view.scrollY !== restingAt) {
    restingAt = null
    return
  }

  const el = anchorElement(doc, id)
  if (el === null) return

  // The reader pressed the row's title and put this thread back out of the
  // timeline. Scrolling to something they just dismissed would be the panel
  // arguing with them.
  if (isHidden(el)) {
    restingAt = null
    return
  }

  restingAt = scrollTo(doc, el)
}

/**
 * `block: 'center'` rather than the browser's own top alignment, because
 * GitHub's header is sticky and would cover a comment placed at the very top.
 * The same choice, for the same reason, as the panel's own row title.
 *
 * The returned offset is what `hold` compares against. A document with no
 * window can be scrolled but not measured, so it is anchored once and then left
 * alone, which is the honest answer rather than a guess.
 */
function scrollTo(doc: Document, el: Element): number | null {
  el.scrollIntoView({ block: 'center' })
  return doc.defaultView?.scrollY ?? null
}

/**
 * What the fragment names, by either of the two routes GitHub leaves open.
 *
 * The comment's own element is the answer whenever GitHub rendered it. It is
 * absent for exactly one case, and it is a common one: a **resolved** thread is
 * collapsed, and its comments are genuinely not in the page, which is the same
 * fact the deferred fetch exists for. Such a thread carries the ids it is
 * holding in `data-hidden-comment-ids`, so a link to a finding somebody has
 * since resolved still finds the stub that stands for it. Scrolling to that
 * stub is what a reader without the extension sees too.
 */
function anchorElement(doc: Document, id: string): Element | null {
  const el = doc.getElementById(id)
  if (el !== null) return el

  const comment = DISCUSSION_ID.exec(id)?.[1]
  if (comment === undefined) return null

  return threadHolding(doc, comment)
}

/**
 * The collapsed thread holding this comment id, by reading the list rather than
 * by matching inside it.
 *
 * A substring selector would answer the wrong thread: comment ids share long
 * prefixes, so `*=` on one id matches a sibling id that merely starts with it.
 * The attribute is a list of exact values, and this compares exact values,
 * which is also why nothing of the reader's URL is ever put in a selector.
 *
 * A walk rather than a query, and it costs nothing worth avoiding: it runs only
 * for a fragment that named no element in the page, so at most once per link
 * followed, over the 76 such threads the largest fixture holds.
 */
function threadHolding(doc: Document, comment: string): Element | null {
  for (const thread of doc.querySelectorAll(COLLAPSED_THREAD)) {
    const ids = thread.getAttribute('data-hidden-comment-ids') ?? ''
    if (ids.split(ID_SEPARATOR).includes(comment)) return thread
  }

  return null
}

/**
 * The fragment, decoded, or null when there is not one.
 *
 * Parsed rather than taken off `location.hash` so the engine keeps its single
 * input: the URL it already read for detection is the URL this reads too, and
 * they can never disagree about which page is being described.
 */
function fragmentOf(url: string): string | null {
  let hash: string

  try {
    hash = new URL(url).hash
  } catch {
    return null
  }

  if (hash.length < 2) return null

  const raw = hash.slice(1)

  // GitHub's own ids are ASCII, so this only ever matters for a hand written
  // link. A fragment that will not decode is used as it stands, because a
  // malformed escape is not a reason to ignore the reader.
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
