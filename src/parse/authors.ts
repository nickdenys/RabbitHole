import type { ThreadAuthors } from '../types'

/**
 * One comment inside a thread. Verified 20 August 2026 across the five
 * fixtures: present 1 to 4 times in every expanded thread and 0 times in every
 * collapsed one, which is the fact `readAuthors` rests on.
 *
 * The selector matches outside threads too. `human-replies.html` has 74 of
 * them, 27 of which sit in minimized review bodies with no thread around them,
 * so every read here is scoped to a thread element rather than to the document.
 */
export const REVIEW_COMMENT = '.review-comment'

/**
 * The author of a comment. Exactly one per comment in all 76 comments inside
 * threads across the fixtures, and its href is the account path.
 */
const AUTHOR_LINK = 'a.author'

/**
 * An unsubmitted comment of your own, part of a review you have not posted.
 * The class is on the comment element itself.
 *
 * Never look for the words `Pending in batch`: `resolvable.html` carries four
 * labels reading exactly that, all `d-none`, on a PR with nothing pending. They
 * are the hidden template for GitHub's batched suggestion control and are
 * rendered for any reader who can review. See [[DOM reference]].
 */
const PENDING_COMMENT = '.js-pending-review-comment'

/**
 * CodeRabbit's account path, matched exactly.
 *
 * Not a name match and not a substring, because invariant 2 says a thread is
 * hidden only when it is positively proven to be CodeRabbit's, and a display
 * name is neither positive nor proof. `/coderabbitai` is a different account
 * that anyone can register, and Houdini's bug was matching prose.
 */
export const CODERABBIT_HREF = '/apps/coderabbitai'

/**
 * Who wrote every comment in a thread, or null when that cannot be answered.
 *
 * Null is the whole point of this function. It is the input to invariant 2: a
 * thread with no attribution is never hidden, in either mode. It happens for
 * two reasons, and the caller tells them apart by looking at `collapsed`:
 *
 *   - The thread is collapsed, so its comments are not in the page at all.
 *     97 of the 148 threads in the fixtures. Reading them is the v0.2 deferred
 *     fetch, and until then the honest answer is that nobody knows.
 *   - The thread is expanded and one of its comments cannot be attributed.
 *     Not observed in any fixture, and the guard stays anyway.
 *
 * One unreadable comment poisons the whole thread rather than being skipped,
 * because "every comment is CodeRabbit's" is not a claim you can make about a
 * thread holding a comment you could not read.
 */
export function readAuthors(threadEl: Element): ThreadAuthors | null {
  const comments = [...threadEl.querySelectorAll(REVIEW_COMMENT)]
  if (comments.length === 0) return null

  let fromCodeRabbit = 0
  let pending = 0
  let rootIsCodeRabbit = false

  for (const [index, comment] of comments.entries()) {
    const author = readAuthorHref(comment)
    if (author === null) return null

    const isPending = comment.matches(PENDING_COMMENT)
    if (isPending) pending++

    // A pending comment is human by construction: only the reader can have an
    // unsubmitted comment, and CodeRabbit posts through the API. Treating the
    // state as decisive means a thread you are still drafting on stays visible
    // even if the author link ever stops being readable.
    const isCodeRabbit = author === CODERABBIT_HREF && !isPending

    if (isCodeRabbit) fromCodeRabbit++
    if (index === 0) rootIsCodeRabbit = isCodeRabbit
  }

  return {
    comments: comments.length,
    fromCodeRabbit,
    fromHumans: comments.length - fromCodeRabbit,
    pending,
    allFromCodeRabbit: fromCodeRabbit === comments.length,
    rootIsCodeRabbit,
  }
}

/**
 * Whether this one comment is CodeRabbit's, by the rule `readAuthors` applies
 * inside a thread: exactly one readable author link, matching the account path
 * exactly.
 *
 * Exists for the one read that becomes an action rather than a label. The
 * agent prompt is copied to be pasted into a coding agent, and `readFinding`
 * offers it only off a comment this answers true for: anyone on a pull request
 * can write a details block whose summary reads `Prompt for AI Agents`, and a
 * copy button that trusted the summary would hand their instructions to the
 * reader's agent dressed as CodeRabbit's. See `readAiPrompt`.
 *
 * No pending check, unlike the flag inside `readAuthors`: a pending comment is
 * the reader's own and carries the reader's author link, so it already answers
 * false here.
 */
export function isCodeRabbitComment(comment: Element): boolean {
  return readAuthorHref(comment) === CODERABBIT_HREF
}

/**
 * The account path of the comment's author, or null when there is not exactly
 * one readable answer.
 *
 * Two links is as unattributable as none. Every one of the 76 comments in the
 * fixtures has exactly one, so a second is markup nobody has seen, and guessing
 * which of them wrote the comment is the guess invariant 2 exists to forbid.
 */
function readAuthorHref(comment: Element): string | null {
  const links = comment.querySelectorAll(AUTHOR_LINK)
  if (links.length !== 1) return null

  const href = links[0].getAttribute('href')?.trim()
  return href ? href : null
}
