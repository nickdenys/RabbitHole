import type { Finding, ParseProblem } from '../types'
import { REVIEW_COMMENT } from './authors'
import { parseTriple } from './severity'

const COMMENT_BODY = '.comment-body'

/**
 * The comment's timestamp link, which is also its permalink.
 *
 * Verified 20 August 2026 across the five fixtures: exactly one per comment in
 * 74 of the 76 comments inside threads, never two, and its href is always the
 * bare fragment `#discussion_r<id>` rather than a full URL. The two without one
 * are the pending comments in `pending-in-batch.html`, which is right: an
 * unsubmitted comment has no id to link to yet.
 *
 * Read as a fragment and stored as one. Resolving it into an absolute URL would
 * mean pasting the page's own path in front of it, which is the panel's job on
 * the day it needs a shareable link, not the parser's.
 */
const PERMALINK = 'a.js-timestamp[href*="#discussion_r"]'

/**
 * CodeRabbit's copyable agent instructions. Matched on the summary text rather
 * than on an emoji or a class, because the emoji is decoration and there is no
 * class to match. Substring, not equality: the summary reads
 * `🤖 Prompt for AI Agents` and the emoji is part of the text node.
 */
const AI_PROMPT_SUMMARY = 'Prompt for AI Agents'

/** Longer than a drawer row can show, and every real title measured is shorter. */
const TITLE_MAX = 120

/**
 * What the drawer says about a thread, or null when the page does not carry it.
 *
 * Null means the thread has no comment body in the page at all, which is every
 * collapsed thread (97 of the 148 in the fixtures). It is the same absence
 * `readAuthors` reports, so a null finding always arrives on a thread that is
 * already unhidable, and the panel shows the row with nothing but its file.
 *
 * Everything is read off the **root comment**, the first `.review-comment` in
 * the thread. That is where CodeRabbit puts the triple and the agent prompt,
 * and where the thread's subject is stated. Replies below it are conversation,
 * not description.
 */
export function readFinding(threadEl: Element): Finding | null {
  const root = threadEl.querySelector(REVIEW_COMMENT)
  const body = root?.querySelector(COMMENT_BODY)
  if (!root || !body) return null

  // Unchanged, on purpose. The triple is parsed in exactly one place and this
  // step wraps that place rather than reaching around it.
  const triple = parseTriple(body)

  return {
    title: readTitle(body, triple !== null),
    category: triple?.category ?? null,
    severity: triple?.severity ?? null,
    effort: triple?.effort ?? null,
    aiPrompt: readAiPrompt(body),
    permalink: root.querySelector(PERMALINK)?.getAttribute('href') ?? null,
  }
}

/**
 * The gap a finding leaves behind, for the caller that keeps a thread's
 * problems list.
 *
 * `no-triple` is a gap and never blocking: CodeRabbit does not put a triple on
 * everything, and 27 of the 47 root comments in the fixtures have none. A
 * thread you can read and cannot fully describe is a badge in the panel, not a
 * veto on hiding.
 *
 * A null finding reports nothing, because a thread whose body is not in the
 * page has not been read at all. Its 'unknown-author' already says so.
 */
export function findingProblems(finding: Finding | null): ParseProblem[] {
  if (finding === null) return []
  return finding.severity === null ? ['no-triple'] : []
}

/**
 * A label for the row, which must never come back empty.
 *
 * With a triple, CodeRabbit's next paragraph is the one-sentence headline and
 * is what a human reads first, so it is preferred. **The next paragraph, not
 * the next element:** on 3 of the 47 root comments in the fixtures the triple
 * is followed by an `🧩 Analysis chain` <details> whose text runs to 6,000
 * characters. Taking the next element blindly would put a shell script in the
 * title.
 *
 * Without a triple the body text is all there is, so it is taken and capped.
 * That covers human threads too, where the first sentence is the whole point.
 */
function readTitle(body: Element, hasTriple: boolean): string {
  const headline = hasTriple ? readHeadline(body) : null
  return headline ?? collapse(body.textContent ?? '').slice(0, TITLE_MAX)
}

/**
 * The first non-empty paragraph after the line holding the triple.
 *
 * The triple's line is found from the first `em` rather than assumed to be the
 * first child, so an unfamiliar preamble above it cannot silently shift the
 * title by one. Measured 20 August 2026: all 47 triples sit in the body's first
 * child, and all 47 are followed by a paragraph.
 */
function readHeadline(body: Element): string | null {
  const firstEm = body.querySelector('em')
  const line = firstEm && [...body.children].find((child) => child.contains(firstEm))

  for (let el = line?.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.tagName !== 'P') continue
    const text = collapse(readLead(el))
    if (text) return text.slice(0, TITLE_MAX)
  }

  return null
}

/**
 * The paragraph's bold opening, which is the finding's own one-line title.
 *
 * CodeRabbit writes the headline as `**Title**` and then continues in the same
 * paragraph, separated only by a `<br>`, so the whole paragraph's text reads as
 * the title running straight into the explanation: *"Lock the batch rows before
 * validating transitions The initial reject() runs on stale…"*. Taking the
 * leading `<strong>` alone stops at the sentence the author meant as the title.
 *
 * Leading, not anywhere: a `<strong>` further in is emphasis inside the prose,
 * and a paragraph that does not open bold has no title to separate, so all of
 * it is taken as before. That is the case for every human written thread.
 */
function readLead(p: Element): string {
  const opening = [...p.childNodes].find((node) => (node.textContent ?? '').trim() !== '')
  const tag = opening?.nodeType === Node.ELEMENT_NODE ? (opening as Element).tagName : null

  return ((tag === 'STRONG' || tag === 'B' ? opening?.textContent : p.textContent) ?? '')
}

/**
 * The agent prompt, read as the text of the code block inside its <details>.
 *
 * Newlines are kept, because the prompt is a multi-line instruction and pasting
 * it collapsed changes what it says. Only the outer whitespace goes.
 *
 * Never read from `clipboard-copy[value]`. Those are the per code block copy
 * buttons: on PR 590 a single comment carried four of them holding bash
 * scripts, and picking one would hand the reader a script instead of a prompt.
 */
function readAiPrompt(body: Element): string | null {
  for (const details of body.querySelectorAll('details')) {
    const summary = details.querySelector(':scope > summary')?.textContent ?? ''
    if (!summary.includes(AI_PROMPT_SUMMARY)) continue

    const text = details.querySelector('pre')?.textContent?.trim()
    return text ? text : null
  }

  return null
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
