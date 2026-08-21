import type { TriageRow } from '../engine'
import { reveal } from '../hide/apply'
import type { Finding } from '../types'

/**
 * GitHub's own resolve button, which is the only thing that ever resolves a
 * thread here.
 *
 * The form is never submitted. GitHub binds its own handler to
 * `js-resolvable-timeline-thread-form` and swaps the thread partial in place;
 * submitting the form around it would navigate the page and lose the panel.
 * Clicking the button GitHub rendered is the whole action.
 *
 * Confirmed 20 August 2026 in `resolvable.html`: 10 threads, 10 forms, one
 * button each, all reading `Resolve conversation`. **It is the only fixture
 * with the button at all**, because GitHub renders it for a reader who can
 * write to the repository rather than for anyone with a session. A missing
 * button is therefore an ordinary outcome and not a broken page, which is why
 * `resolveThread` returns false instead of throwing.
 */
const RESOLVE_BUTTON = 'form[action$="/resolve"] button'

/**
 * GitHub's own unresolve button, the exact mirror of the resolve one.
 *
 * **Verified 21 August 2026** on `nickdenys/optios-booking#1`, and captured in
 * `resolvable.html`: the form is
 * `form.js-resolvable-timeline-thread-form[data-turbo="false"]`, its action is
 * `/owner/repo/pull/1/threads/2596049536/unresolve`, and its one submit button
 * reads `Unresolve conversation`. Same form class, same handler, same reason
 * for clicking the button rather than submitting the form.
 *
 * **The suffix match is what keeps the two apart, and it is not an accident.**
 * `form[action$="/resolve"]` does not match an unresolve action, because the
 * last eight characters of `.../unresolve` are `nresolve` and not `/resolve`.
 * The leading slash is doing real work: `action$="resolve"` would match both
 * and `resolveThread` would silently unresolve threads. Asserted in the tests.
 */
const UNRESOLVE_BUTTON = 'form[action$="/unresolve"] button'

/**
 * GitHub's chevron, which expands a collapsed thread and fetches its comments.
 *
 * **The unresolve form does not exist while the thread is collapsed.** Verified
 * 21 August 2026 on a repository the reader can write to, which is the only
 * place the question can be asked: a resolved, collapsed thread carries no
 * `form` at all, not a disabled one and not a hidden one. Expanding it fetches
 * the partial, and the unresolve form arrives with it.
 *
 * So unresolve is a two step action on a collapsed thread, and `unresolveThread`
 * says which step it just took rather than pretending the first one was the
 * whole thing. The attribute is Catalyst's own binding, so clicking the button
 * runs GitHub's expand rather than anything of ours.
 */
const EXPAND_TOGGLE = 'button[data-action="click:review-thread-collapsible#toggle"]'

/**
 * The findings of threads resolved in this session, keyed by thread id.
 *
 * A resolved thread collapses and loses its comments, so the next pass reads it
 * as unreadable and the drawer would drop the row the reader just finished:
 * the checklist would count down by making its own progress disappear. This
 * holds the description parsed *before* the resolve so the row can stay on
 * screen, struck through, until the page is left.
 *
 * **It is a cache of a description, never a record of the done state.** Done is
 * GitHub's `data-resolved` and nothing else, read fresh off the page every
 * pass. B2's deferred fetch reads the real comments back and this becomes
 * redundant.
 *
 * In memory only, and per pull request rather than per session: the engine
 * clears it on arriving at a different one, and on leaving pull requests
 * altogether. Moving between the tabs of one pull request is not a navigation
 * and does not clear it, so a round trip through Files changed keeps the rows
 * the reader has already worked.
 */
const sessionFindings = new Map<string, Finding>()

/** What a resolved thread looked like before it collapsed, if it was resolved here. */
export function sessionFinding(id: string): Finding | undefined {
  return sessionFindings.get(id)
}

/**
 * Teardown, called by the engine when the page it was reading is gone, and the
 * reset a test needs between cases.
 */
export function forgetSessionFindings(): void {
  sessionFindings.clear()
}

/**
 * Put a finding back on the page and scroll to it.
 *
 * Reveal and scroll are one action because either alone is useless: a hidden
 * thread scrolled to is still not there, and a visible thread not scrolled to
 * is somewhere in a page of 148 threads. The reveal is permanent for the life
 * of the page, which is A7's rule, so a later pass cannot take it away again.
 *
 * A row that was never hidden reaches here too, and the reveal is then a no-op
 * that leaves only the scroll. That is the point: one button that means "show
 * me this on the page", whatever the hide policy decided about it.
 */
export function revealThread(row: TriageRow): void {
  reveal(row.thread.el)
  row.thread.el.scrollIntoView({ block: 'center' })
}

/**
 * Copy CodeRabbit's agent prompt, and say whether it happened.
 *
 * Two ways to come back false, and the row does not distinguish them because
 * the reader cannot act on the difference: the comment carries no
 * `Prompt for AI Agents` block, or the clipboard refused. The clipboard refuses
 * on an unfocused document and outside a user gesture, both of which are real
 * on a page the reader is also clicking around in, so the failure is reported
 * rather than assumed away.
 *
 * The text is the one `readFinding` already parsed. Re-reading the DOM on click
 * would put a parser in the click path and could disagree with the row's own
 * title, which came from the same pass.
 */
export async function copyPrompt(row: TriageRow): Promise<boolean> {
  const prompt = row.finding?.aiPrompt
  if (!prompt) return false

  try {
    await navigator.clipboard.writeText(prompt)
    return true
  } catch {
    return false
  }
}

/**
 * Click GitHub's resolve button for this thread.
 *
 * True means the click was delivered, never that the thread is resolved. The
 * caller waits for a pass to read `data-resolved="true"` off the page, because
 * that attribute is the only done state this extension recognises and anything
 * optimistic here would be the panel telling the reader something it does not
 * know.
 *
 * False means GitHub rendered no button, which is what a reader without write
 * access sees on every thread.
 */
export function resolveThread(row: TriageRow): boolean {
  const button = row.thread.el.querySelector<HTMLElement>(RESOLVE_BUTTON)
  if (button === null) return false

  if (row.finding !== null) sessionFindings.set(row.thread.id, row.finding)

  button.click()
  return true
}

/**
 * What one press of Unresolve actually did.
 *
 *   'clicked'      GitHub's unresolve button was clicked; wait for a pass
 *   'expanding'    the thread was collapsed, so it was expanded instead and the
 *                  form is on its way; press again when it arrives
 *   'unavailable'  the thread is expanded and still has no button, which is
 *                  what a reader without write access sees
 */
export type UnresolveOutcome = 'clicked' | 'expanding' | 'unavailable'

/**
 * Click GitHub's unresolve button for this thread, expanding it first if that
 * is what it takes to have one.
 *
 * Same contract as `resolveThread`: 'clicked' means the click was delivered,
 * never that the thread is open again. `data-resolved` is the only done state,
 * read fresh off the page by the next pass.
 *
 * **The two step case is not hidden from the reader.** A collapsed thread has
 * no form to click, so the first press expands it and says so, and the second
 * one unresolves. Doing both behind one press would mean waiting on a network
 * fetch inside a click handler and guessing when it landed, and a guess that
 * came back wrong would look exactly like a button that does nothing.
 *
 * **The session cache is deliberately left alone.** It holds what a thread said
 * before it was resolved here, and dropping it on the click would be trusting
 * an unresolve that has not happened yet: if GitHub refused, the row would fall
 * back to unreadable and vanish from the list, which is the failure the cache
 * exists to prevent. Once the page says the thread is open again its comments
 * are back in the DOM, the pass parses a real finding, and `described` prefers
 * that over the cache anyway, so the stale entry does nothing until navigation
 * clears it.
 */
export function unresolveThread(row: TriageRow): UnresolveOutcome {
  const el = row.thread.el

  const button = el.querySelector<HTMLElement>(UNRESOLVE_BUTTON)
  if (button !== null) {
    button.click()
    return 'clicked'
  }

  const toggle = el.querySelector<HTMLElement>(EXPAND_TOGGLE)
  if (toggle !== null && toggle.getAttribute('aria-expanded') !== 'true') {
    toggle.click()
    return 'expanding'
  }

  return 'unavailable'
}
