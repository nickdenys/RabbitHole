import { MORE_CONTROL } from './hide/apply'

/**
 * The submit button that actually asks GitHub for more, as opposed to the
 * other submit button in the same form that only states the count.
 *
 * Both are `type="submit"` inside `form.ajax-pagination-form`, so either would
 * post it, but only this one carries `data-disable-with`, which is GitHub's own
 * signal that a request is in flight: the button's text and its `disabled`
 * attribute flip the moment it is clicked, and back once the response lands
 * (or the form is gone, having been replaced by what it fetched). Checking it
 * is what keeps a slow request from being clicked twice.
 */
const MORE_BUTTON = '[data-disable-with]'

/**
 * Whether GitHub is still holding anything back, in either shape of the
 * control.
 *
 * The count check reads this, so that a shortfall the reader can do nothing
 * about is not reported as one they can: with no control in the page there is
 * no button to click, and telling them to click one sends them looking for
 * something that is not there. Observed 25 August 2026 on a pull request whose
 * three reviews claimed 26 findings and posted 25, with no form anywhere.
 */
export function hasLoadMore(doc: Document): boolean {
  return doc.querySelector(MORE_CONTROL) !== null
}

/**
 * Click every "Load more" GitHub has rendered, so the reader never has to.
 *
 * Not a fetch of our own: GitHub's own handler is bound to this button and
 * swaps the fetched threads into the page itself, the same way it would for a
 * click. That is what keeps this consistent with [[Design decisions|B1's rule
 * against injecting fetched markup]] without writing a second network path
 * for the same content the deferred-thread fetch already gets right.
 *
 * Idempotent by construction rather than by bookkeeping here: a button already
 * disabled mid-request is skipped, and a form GitHub has already replaced no
 * longer matches the selector at all. Called from a pass already debounced by
 * the engine, so a burst of these across one page coalesces the same way a
 * burst of thread insertions does.
 *
 * Returns how many were clicked, purely so a caller can tell "did anything
 * happen" without re-querying the page itself.
 */
export function clickLoadMore(doc: Document): number {
  let clicked = 0

  for (const form of doc.querySelectorAll(MORE_CONTROL)) {
    const button = form.querySelector<HTMLButtonElement>(MORE_BUTTON)
    if (button === null || button.disabled) continue

    button.click()
    clicked++
  }

  return clicked
}
