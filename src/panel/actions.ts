import { pullRequestKey } from '../detect'
import type { TriageRow } from '../engine'
import { isHidden, reveal, unreveal } from '../hide/apply'
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
 * What one press of the row's title did to the timeline.
 *
 *   'shown'     the thread was out of the timeline and is now in it, scrolled to
 *   'hidden'    the reader had shown it, and it has gone back where it was
 *   'scrolled'  nothing was hidden either way, so the page only moved
 */
export type TimelineToggle = 'shown' | 'hidden' | 'scrolled'

/**
 * Show this finding in the timeline, or put it back, and scroll to it whenever
 * it ends up on screen.
 *
 * Reveal and scroll are one action because either alone is useless: a hidden
 * thread scrolled to is still not there, and a visible thread not scrolled to
 * is somewhere in a page of 148 threads. The reveal outlives every later pass,
 * which is A7's rule.
 *
 * **The direction is read off the page, never off the verdict.** A hidden
 * thread can only be shown and a visible one can only be put back, and which of
 * the two this is is a question about the class on the element right now: the
 * verdict says what the policy wants, which is the opposite fact for exactly
 * the threads the reader has already revealed.
 *
 * A row the policy never hid reaches here too, and then both halves are no-ops
 * and the press is only a scroll. That is deliberate rather than tolerated: it
 * means the title is one gesture that means "show me this on the page", and the
 * panel can never hide a thread invariants 1 and 2 kept in the timeline.
 */
export function toggleInTimeline(row: TriageRow): TimelineToggle {
  const el = row.thread.el

  if (isHidden(el)) {
    reveal(el)
    el.scrollIntoView({ block: 'center' })
    return 'shown'
  }

  unreveal(el)
  if (isHidden(el)) return 'hidden'

  el.scrollIntoView({ block: 'center' })
  return 'scrolled'
}

/**
 * Whether this finding is in the timeline right now, which is what the title's
 * pressed state reports.
 *
 * Read on every render rather than remembered, because nothing tells the panel
 * when it changes: the engine's observer watches insertions and removals, so
 * taking a class off an element schedules no pass, and a remembered flag would
 * survive GitHub swapping the thread partial underneath it.
 */
export function showsInTimeline(row: TriageRow): boolean {
  return !isHidden(row.thread.el)
}

/**
 * The same finding on the Files changed tab, or null when there is no way to
 * name it.
 *
 * Two things have to be true, and neither is guaranteed. The permalink is read
 * off the root comment's timestamp link and a pending comment has none, because
 * an unsubmitted comment has no id to link to yet; and the URL has to be a pull
 * request's, which it is not while Turbo is between pages. Null means the menu
 * draws no item rather than a dead one.
 *
 * The fragment is pulled out rather than trusted whole. `readFinding` sees the
 * bare `#discussion_r<id>` in all five fixtures, but a resolved thread's
 * comments arrive from the deferred endpoint, where the same link could come
 * back absolute, and appending an absolute URL to a path would produce
 * something that resolves nowhere.
 */
export function filesChangedUrl(row: TriageRow, url: string = location.href): string | null {
  const permalink = row.finding?.permalink
  if (!permalink) return null

  const key = pullRequestKey(url)
  if (key === null) return null

  const fragment = permalink.startsWith('#') ? permalink : hashOf(permalink, url)
  return fragment === null ? null : `https://github.com/${key}/files${fragment}`
}

function hashOf(permalink: string, base: string): string | null {
  try {
    const hash = new URL(permalink, base).hash
    return hash === '' ? null : hash
  } catch {
    return null
  }
}

/**
 * Open this finding on the Files changed tab, in a tab of its own.
 *
 * A new tab rather than this one, because the drawer is a worklist and
 * navigating away from it is throwing away the reader's place. `noopener` for
 * the ordinary reason: the opened page has no business holding a reference back
 * to a page it was opened from.
 *
 * False means there was no URL to open, which the menu already knows and is
 * why it drew no item. It is still checked here rather than assumed, because
 * the row it was drawn from is replaced on every pass.
 */
export function openInFiles(row: TriageRow, url: string = location.href): boolean {
  const target = filesChangedUrl(row, url)
  if (target === null) return false

  window.open(target, '_blank', 'noopener')
  return true
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
