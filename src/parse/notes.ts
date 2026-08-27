import { CODERABBIT_HREF } from './authors'

/**
 * One of CodeRabbit's two standalone comments: the walkthrough it posts once
 * per pull request, and the `Actionable comments posted: N` body it puts on
 * every review it submits.
 *
 * Neither is a review thread, so neither goes through the hide policy. They are
 * hidden on positive proof of the marker alone, which is why this module exists
 * separately from `thread.ts`.
 */
export interface CodeRabbitNote {
  /**
   * The element to hide: the note's `.TimelineItem` row, avatar included.
   *
   * **Never the timeline item**, which for a summary also holds the review's
   * threads (up to 25 of them). Verified 20 August 2026 across the fixtures:
   * all 23 notes sit in a `.TimelineItem` holding exactly one comment, one
   * avatar and zero `review-thread-collapsible`, so this is the largest element
   * that is the note and nothing else.
   */
  el: Element
  /**
   * Nearest `.js-timeline-item`, for context only. Hiding it would take a
   * summary's threads with it. See the note on `el`.
   */
  timelineItem: Element | null
  kind: 'walkthrough' | 'summary'
  /**
   * The N in `Actionable comments posted: N`, and null on a walkthrough, which
   * does not carry the line.
   *
   * Parsed here although nothing reads it until B5's count check, because this
   * module is already holding the element the number is in. See Decision log.
   */
  actionableCount: number | null
}

/**
 * A comment in the timeline, whichever kind. Verified 20 August 2026 across the
 * five fixtures: the class is on all three shapes GitHub renders, and each one
 * holds exactly one author link and one comment body.
 *
 *   `discussion_r<id>`        a comment inside a review thread
 *   `issuecomment-<id>`       a standalone comment, which the walkthrough is
 *   `pullrequestreview-<id>`  a submitted review's body, which the summary is
 *
 * The id is on the group but is not read: GitHub puts the same
 * `pullrequestreview-<id>` on the group *and* on an outer wrapper that also
 * contains the review's threads, so the id is not unique within the page.
 */
const COMMENT_GROUP = '.timeline-comment-group'

/** The row holding one comment and its avatar. Never holds a thread. */
const COMMENT_ROW = '.TimelineItem'

const THREAD = 'review-thread-collapsible'
const TIMELINE_ITEM = '.js-timeline-item'
const COMMENT_BODY = '.comment-body'
const AUTHOR_LINK = 'a.author'

/**
 * The walkthrough marker, matched as the whole text of a heading or a
 * `<summary>` rather than as prose anywhere in the body.
 *
 * **Two shapes, and both are real.** Three of the four fixtures carrying a
 * walkthrough render it collapsed, as `<summary>📝 Walkthrough</summary>` over
 * an `<h2>Walkthrough</h2>`. `human-replies.html` renders it expanded, with the
 * `<h2>` and no `<summary>` at all. Matching the summary alone, which is what
 * the build plan expected to find, would miss that one.
 *
 * Structural either way: an element whose entire text is the word is a marker,
 * a sentence mentioning walkthroughs is not. That is the distinction
 * [[Prior art|Houdini's bug]] failed to make.
 */
const WALKTHROUGH_MARKER = 'summary, h1, h2, h3'
const WALKTHROUGH_TEXT = /^(?:📝\s*)?Walkthrough$/

/**
 * The summary marker, read off the rendered `<strong>` rather than the body
 * text.
 *
 * **The element matters.** `resolvable.html` carries the line twice more than
 * it has summaries, in two `<textarea>` elements: GitHub ships the comment's
 * raw markdown in an edit form for anyone who can edit it, `**Actionable
 * comments posted: 4**` included. A text search over the body finds those. The
 * `<strong>` only exists where the markdown was rendered.
 */
const ACTIONABLE_LINE = /^Actionable comments posted:\s*(\d+)$/

/**
 * CodeRabbit's walkthrough and review summaries, in document order.
 *
 * **Positive proof twice over: the author, and then the marker.** Every
 * standalone comment CodeRabbit posts is authored the same way, so authorship
 * alone would take its chat replies with it, and those are conversation the
 * reader asked for. `human-replies.html` is the case: 56 standalone comments
 * from CodeRabbit, 8 of them notes, the other 48 replies that stay.
 *
 * A note is never a thread and never passes through `hideVerdict`. The
 * invariants it answers to are the same ones, reached differently: nothing is
 * returned that was not read, and nothing is returned that was not proven to be
 * CodeRabbit's.
 */
export function scanNotes(doc: Document): CodeRabbitNote[] {
  const notes: CodeRabbitNote[] = []

  for (const group of doc.querySelectorAll(COMMENT_GROUP)) {
    // A comment inside a review thread is the thread's business. No thread
    // comment in any fixture carries either marker, so this excludes nothing
    // that would have matched; it keeps the two scanners from ever claiming the
    // same element.
    if (group.closest(THREAD) !== null) continue
    if (!isCodeRabbits(group)) continue

    // Read once and handed to both markers. Each of them used to ask the
    // group for its bodies itself, which is a subtree query per note per pass
    // for an answer that cannot have changed in between: the two calls run
    // back to back on the same element.
    const bodies = commentBodies(group)

    const actionableCount = readActionableCount(bodies)
    const kind = readKind(bodies, actionableCount)
    if (kind === null) continue

    notes.push({
      // Falls back to the group itself rather than skipping the note: a row
      // that cannot be found is a shell left on screen, not a lost finding.
      el: group.closest(COMMENT_ROW) ?? group,
      timelineItem: group.closest(TIMELINE_ITEM),
      kind,
      actionableCount,
    })
  }

  return notes
}

/**
 * The walkthrough wins when a comment somehow carries both markers, which no
 * fixture does. It is the more specific claim, and `actionableCount` is
 * reported either way, so nothing is lost by the choice.
 */
function readKind(bodies: Element[], actionableCount: number | null): CodeRabbitNote['kind'] | null {
  if (hasWalkthroughMarker(bodies)) return 'walkthrough'
  return actionableCount === null ? null : 'summary'
}

/**
 * Exactly one author link, and its href exactly CodeRabbit's account path.
 *
 * The same test `readAuthors` applies to a thread comment, for the same reason:
 * a display name is not proof, `/coderabbitai` is an account anyone can
 * register, and two author links is as unattributable as none.
 */
function isCodeRabbits(group: Element): boolean {
  const links = group.querySelectorAll(AUTHOR_LINK)
  if (links.length !== 1) return false

  return links[0].getAttribute('href')?.trim() === CODERABBIT_HREF
}

function hasWalkthroughMarker(bodies: Element[]): boolean {
  return bodies.some((body) =>
    [...body.querySelectorAll(WALKTHROUGH_MARKER)].some((el) =>
      WALKTHROUGH_TEXT.test(el.textContent?.trim() ?? ''),
    ),
  )
}

function readActionableCount(bodies: Element[]): number | null {
  for (const body of bodies) {
    for (const el of body.querySelectorAll('strong')) {
      const digits = el.textContent?.trim().match(ACTIONABLE_LINE)?.[1]
      if (digits !== undefined) return Number(digits)
    }
  }

  return null
}

/**
 * Both markers are read out of the rendered comment body, never off the group
 * as a whole, so nothing in GitHub's own chrome around the comment can match.
 *
 * Plural because a comment can hold more than one: on a repository you can
 * write to, GitHub renders an 18 character `.comment-body` template for the
 * suggested changes control alongside the real one.
 */
function commentBodies(group: Element): Element[] {
  return [...group.querySelectorAll(COMMENT_BODY)]
}
