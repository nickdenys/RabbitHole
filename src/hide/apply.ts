/**
 * The only module in the extension that writes to GitHub's DOM.
 *
 * Everything else reads the page and decides. This applies those decisions, and
 * it is deliberately the smallest surface that can: one class, one stylesheet,
 * and a set of elements that should be carrying the class right now.
 *
 * **Declarative rather than incremental.** `applyHiding` owns the whole hidden
 * set: it adds the class to everything in its argument and removes it from
 * anything else still carrying it. That is what makes it idempotent under a
 * MutationObserver that fires on our own class changes, and it is also how a
 * mode toggle and a reveal take effect without a separate undo path.
 *
 * Nothing here decides *whether* something may be hidden. That is
 * `hide/policy.ts` for threads and `parse/notes.ts` for the two notes, and both
 * invariants are already settled by the time an element reaches this file.
 */

/** Removing this class is the whole of reversal, so nothing of GitHub's is destroyed. */
const HIDDEN_CLASS = 'crt-hidden'

const STYLE_ID = 'coderabbit-triage-style'

const STYLE_TEXT = `.${HIDDEN_CLASS} { display: none !important }`

const TIMELINE_ITEM = '.js-timeline-item'
const THREAD = 'review-thread-collapsible'
const COMMENT_GROUP = '.timeline-comment-group'

/**
 * GitHub's own "there is more" control, both shapes: the whole timeline's
 * `timeline_more_items` and one review's `more_threads`. Present only when
 * GitHub has threads it has not rendered yet, see `DOM reference.md`.
 *
 * Exported so `src/loadmore.ts` clicks exactly what this file refuses to
 * collapse: the two must never drift out of step with each other.
 */
export const MORE_CONTROL = '.ajax-pagination-form'

/**
 * Elements the reader asked to see again, which no later pass may hide.
 *
 * A `WeakSet` because the entries are page elements: Turbo replaces the
 * timeline wholesale on navigation, and reveals are supposed to last until it
 * does. Nothing iterates this, so weakness costs nothing.
 */
let revealed = new WeakSet<Element>()

/**
 * The last set applied, kept so `reveal` can re-derive the hidden set
 * synchronously instead of waiting for the next observer pass to notice.
 *
 * Without it, revealing one thread out of a hidden timeline item would leave
 * its siblings visible for however long the debounce lasts. Overwritten by
 * every pass and dropped by `revealAll`, so it never holds more than one page.
 */
let lastTargets: Element[] = []
let lastDoc: Document | null = null

/**
 * Hide exactly these elements, and nothing else.
 *
 * `targets` is the mixed list the engine builds: thread elements whose verdict
 * was `hide: true`, and the `.TimelineItem` rows of CodeRabbit's walkthrough
 * and summaries. Anything previously hidden and not named here is revealed, so
 * calling this with a shorter list is how safe mode is restored after
 * aggressive mode, and calling it twice with the same list is a no-op.
 */
export function applyHiding(targets: Element[], doc: Document): void {
  ensureStylesheet(doc)

  lastTargets = [...new Set(targets)]
  lastDoc = doc

  const desired = hideSet(lastTargets.filter((el) => !revealed.has(el)))

  for (const el of doc.querySelectorAll(`.${HIDDEN_CLASS}`)) {
    if (!desired.has(el)) el.classList.remove(HIDDEN_CLASS)
  }

  for (const el of desired) el.classList.add(HIDDEN_CLASS)
}

/**
 * Put one thread or note back on the page, and keep it there.
 *
 * The element the drawer names is not necessarily the element carrying the
 * class: a thread whose whole timeline item was hidden is not hidden itself. So
 * the class comes off the element and off its ancestors, and then the rest of
 * the page is re-derived, which re-hides the revealed thread's siblings
 * individually rather than leaving them exposed.
 *
 * **No pass may take this back, but the reader may.** A reveal outlives every
 * later `applyHiding`, which is what stops a churning page from swallowing a
 * thread the reader asked to see; `unreveal` is the reader saying they are done
 * with it. The two together are what the drawer's title toggles, and the
 * asymmetry is deliberate: the extension never re-hides on its own.
 */
export function reveal(el: Element): void {
  revealed.add(el)

  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    node.classList.remove(HIDDEN_CLASS)
  }

  if (lastDoc !== null) applyHiding(lastTargets, lastDoc)
}

/**
 * Undo one `reveal`, so the page decides about this element again.
 *
 * Not "hide this": it drops the reader's override and re-derives, so an element
 * the last pass never wanted hidden stays exactly where it is. That is what
 * makes the drawer's toggle safe to offer on every row, including the ones the
 * policy deliberately left in the timeline (invariants 1 and 2): pressing it
 * there can only ever scroll.
 *
 * The class is not removed here, only re-derived, because the element may sit
 * inside a timeline item that has to collapse back into one hidden element now
 * that this thread is no longer the exception keeping it open.
 */
export function unreveal(el: Element): void {
  revealed.delete(el)

  if (lastDoc !== null) applyHiding(lastTargets, lastDoc)
}

/**
 * Whether this element is out of the timeline right now, which is not the same
 * as whether the policy wants it out.
 *
 * Read off the page rather than off the last verdict, because the two disagree
 * exactly when the reader has revealed something, and `closest` because the
 * class may be on an ancestor: a review whose threads all went is hidden as one
 * `.js-timeline-item` and its threads carry nothing themselves.
 */
export function isHidden(el: Element): boolean {
  return el.closest(`.${HIDDEN_CLASS}`) !== null
}

/**
 * Teardown: every element visible again, the stylesheet gone, the reveal set
 * forgotten.
 *
 * Removing the style element as well as the classes is what makes this a real
 * restore rather than a cleared flag. `applyHiding` puts it back on the next
 * pass, which is also what happens when GitHub replaces the head.
 */
export function revealAll(doc: Document): void {
  for (const el of doc.querySelectorAll(`.${HIDDEN_CLASS}`)) el.classList.remove(HIDDEN_CLASS)

  doc.getElementById(STYLE_ID)?.remove()

  revealed = new WeakSet<Element>()
  lastTargets = []
  lastDoc = null
}

/**
 * Which elements actually carry the class, given what may be hidden.
 *
 * **Hide the whole `.js-timeline-item` when everything inside it is going, and
 * the individual targets otherwise.** An item emptied by hiding its contents
 * one at a time leaves an avatar and a rule on screen, which reads as a
 * rendering bug.
 *
 * The build plan's rule for this was "hide the item when it contains exactly
 * one thread". That is a narrower version of the same idea and it is wrong in
 * both directions on the fixtures:
 *
 *  * **Too eager.** Four single-thread items across `pending-in-batch.html` and
 *    `unresolved-and-resolved.html` also hold the review's summary comment, so
 *    hiding the item takes a comment the caller never named.
 *  * **Too shy.** A review posting 4, 6 or 25 threads is one item, and hiding
 *    all of them plus the summary is exactly the case that empties an item.
 *    Under the plan's rule that item is never hidden.
 *
 * So the test is coverage, not counting: every thread in the item, and every
 * comment group outside those threads, has to be a target or sit inside one.
 * A collapsed thread contributes no comment group and is never a target, so an
 * item holding one can never reach the item branch, which is the invariant
 * about unattributable threads holding here too.
 *
 * **An item carrying GitHub's own "N hidden conversations" control is never
 * covered, whatever the targets say.** That control is the reader's only way
 * to load threads GitHub has not rendered at all, so folding it into a hidden
 * item takes away the one button that would tell them the page is incomplete.
 * The threads GitHub did render still hide individually, same as any item a
 * pending comment keeps open.
 */
function hideSet(targets: Element[]): Set<Element> {
  const byItem = new Map<Element, Element[]>()
  const hidden = new Set<Element>()

  for (const el of targets) {
    const item = el.closest(TIMELINE_ITEM)

    // No item ancestor means nothing to collapse into, so the element stands
    // on its own. Hand built markup in the tests does this; real pages do not.
    if (item === null) {
      hidden.add(el)
      continue
    }

    byItem.set(item, [...(byItem.get(item) ?? []), el])
  }

  for (const [item, members] of byItem) {
    if (coversEverything(item, targets)) hidden.add(item)
    else for (const el of members) hidden.add(el)
  }

  return hidden
}

function coversEverything(item: Element, targets: Element[]): boolean {
  if (item.querySelector(MORE_CONTROL) !== null) return false

  const threads = [...item.querySelectorAll(THREAD)]

  // Only the groups outside a thread: a thread's own comments go with the
  // thread, and asking about them separately would fail on a thread element
  // that is itself the target.
  const groups = [...item.querySelectorAll(COMMENT_GROUP)].filter(
    (group) => group.closest(THREAD) === null,
  )

  return [...threads, ...groups].every((el) => targets.some((t) => t === el || t.contains(el)))
}

/**
 * The one stylesheet, recreated whenever it is missing.
 *
 * A class plus a stylesheet rather than inline styles, so reversal cannot lose
 * a style GitHub set itself. GitHub replaces the head on some navigations and
 * the check is one id lookup per pass, so it is done every time rather than
 * remembered.
 */
function ensureStylesheet(doc: Document): void {
  if (doc.getElementById(STYLE_ID) !== null) return

  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE_TEXT

  // `head` is null only on a document built without one, which the extension
  // never meets and a test can construct.
  ;(doc.head ?? doc.documentElement).append(style)
}
