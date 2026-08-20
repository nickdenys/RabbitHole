import { describe, expect, it } from 'vitest'
import { scanNotes } from '../src/parse/notes'
import { loadFixture } from './support/fixture'

/**
 * Hand counted off the fixtures on 20 August 2026, by walking every
 * `.timeline-comment-group` outside a review thread and reading its author link
 * and its markers directly rather than through `scanNotes`.
 *
 * `standalone` is how many of those groups CodeRabbit wrote, so the gap between
 * it and `walkthrough + summaries` is the whole point of the step: 63 standalone
 * comments on `human-replies.html`, 8 of them notes, 55 chat replies that stay
 * in the timeline.
 *
 * **`walkthrough` is never more than one**, and `no-coderabbit.html` has none
 * of anything, which is the case that has to return an empty array rather than
 * throw.
 */
const COUNTS = {
  'unresolved-and-resolved': { standalone: 7, walkthrough: 1, counts: [9, 1, 1, 1] },
  'human-replies': { standalone: 63, walkthrough: 1, counts: [21, 26, 24, 9, 9, 10, 3] },
  'pending-in-batch': { standalone: 10, walkthrough: 1, counts: [6, 3, 4, 3, 1, 1] },
  'no-coderabbit': { standalone: 0, walkthrough: 0, counts: [] },
  'resolvable': { standalone: 6, walkthrough: 1, counts: [4, 6] },
} as const

const NAMES = Object.keys(COUNTS) as (keyof typeof COUNTS)[]

// Parsed once and shared, as in the other fixture tests: human-replies.html is
// 8.3 MB and re-parsing it per case exhausts the test worker. Nothing below
// mutates a fixture document; the hand built cases build their own.
const docs = Object.fromEntries(NAMES.map((name) => [name, loadFixture(name)])) as Record<
  keyof typeof COUNTS,
  Document
>
const scans = Object.fromEntries(NAMES.map((name) => [name, scanNotes(docs[name])])) as Record<
  keyof typeof COUNTS,
  ReturnType<typeof scanNotes>
>

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument()
  d.body.innerHTML = html
  return d
}

/** The shape every note in the fixtures has, reduced to what a test can assert. */
function note(body: string, author = '/apps/coderabbitai'): string {
  return `
    <div class="js-timeline-item">
      <div class="TimelineItem">
        <img class="avatar">
        <div class="timeline-comment-group">
          <a href="${author}" class="author">someone</a>
          <div class="comment-body">${body}</div>
        </div>
      </div>
    </div>
  `
}

const WALKTHROUGH_BODY = '<details><summary>📝 Walkthrough</summary><h2>Walkthrough</h2><p>It changes things.</p></details>'
const SUMMARY_BODY = '<p><strong>Actionable comments posted: 3</strong></p>'

describe('scanNotes, against the fixtures', () => {
  it.each(NAMES)('finds the walkthrough and every summary in %s', (name) => {
    const found = scans[name]
    const expected = COUNTS[name]

    expect(found.filter((n) => n.kind === 'walkthrough')).toHaveLength(expected.walkthrough)
    expect(found.filter((n) => n.kind === 'summary')).toHaveLength(expected.counts.length)
    expect(found).toHaveLength(expected.walkthrough + expected.counts.length)
  })

  it.each(NAMES)('parses actionableCount off every summary in %s', (name) => {
    const summaries = scans[name].filter((n) => n.kind === 'summary')

    expect(summaries.map((n) => n.actionableCount)).toEqual([...COUNTS[name].counts])
  })

  it.each(NAMES)('leaves the walkthrough without a count in %s', (name) => {
    const walkthroughs = scans[name].filter((n) => n.kind === 'walkthrough')

    // The walkthrough carries no `Actionable comments posted` line at all, so
    // null here is the page, not a parse failure.
    expect(walkthroughs.map((n) => n.actionableCount)).toEqual(Array(COUNTS[name].walkthrough).fill(null))
  })

  it('returns an empty array on a page with no CodeRabbit at all', () => {
    expect(scans['no-coderabbit']).toEqual([])
  })

  /**
   * The rule the step exists for. Every one of these comments is CodeRabbit's
   * and every one of them stays: authorship is not the test, the marker is.
   */
  it.each(NAMES)('leaves CodeRabbit chat replies alone in %s', (name) => {
    const replies = COUNTS[name].standalone - COUNTS[name].walkthrough - COUNTS[name].counts.length

    expect(standaloneCodeRabbitComments(docs[name])).toBe(COUNTS[name].standalone)
    expect(replies).toBeGreaterThanOrEqual(0)
    expect(scans[name]).toHaveLength(COUNTS[name].standalone - replies)
  })

  /**
   * The fact that decides what A7 may hide. A summary shares its
   * `.js-timeline-item` with the threads of the review it belongs to, up to 25
   * of them, so the timeline item is never the hide target for a note.
   */
  it.each(NAMES)('returns an element holding no review thread in %s', (name) => {
    for (const found of scans[name]) {
      expect(found.el.querySelectorAll('review-thread-collapsible')).toHaveLength(0)
      expect(found.el.querySelectorAll('.timeline-comment-group')).toHaveLength(1)
    }
  })

  it('reports timelineItem, and on a summary that item does hold the threads', () => {
    const summaries = scans['human-replies'].filter((n) => n.kind === 'summary')
    const withThreads = summaries.filter(
      (n) => (n.timelineItem?.querySelectorAll('review-thread-collapsible').length ?? 0) > 0,
    )

    expect(summaries.every((n) => n.timelineItem !== null)).toBe(true)
    expect(withThreads).toHaveLength(summaries.length)
  })

  it('never returns one note inside another', () => {
    for (const name of NAMES) {
      for (const a of scans[name]) {
        for (const b of scans[name]) {
          if (a !== b) expect(a.el.contains(b.el)).toBe(false)
        }
      }
    }
  })

  it('returns notes in document order', () => {
    const found = scans['human-replies']

    for (const [index, current] of found.slice(1).entries()) {
      const previous = found[index]
      // Node.DOCUMENT_POSITION_FOLLOWING, without depending on the constant.
      expect(previous.el.compareDocumentPosition(current.el) & 4).toBe(4)
    }
  })
})

describe('scanNotes, on markup built by hand', () => {
  it('reads the walkthrough from the heading when there is no summary element', () => {
    // `human-replies.html` renders it this way: expanded, so the <details> and
    // its <summary> are not there at all.
    const found = scanNotes(doc(note('<h2>Walkthrough</h2><p>It changes things.</p>')))

    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe('walkthrough')
  })

  it('reads the walkthrough from the summary element', () => {
    const found = scanNotes(doc(note(WALKTHROUGH_BODY)))

    expect(found.map((n) => n.kind)).toEqual(['walkthrough'])
  })

  it('ignores a reply that only mentions the walkthrough in prose', () => {
    const prose = '<p>The Walkthrough above covers this. Walkthrough sections are generated per PR.</p>'

    expect(scanNotes(doc(note(prose)))).toEqual([])
  })

  it('ignores a note posted by anyone but CodeRabbit', () => {
    expect(scanNotes(doc(note(WALKTHROUGH_BODY, '/coderabbitai')))).toEqual([])
    expect(scanNotes(doc(note(SUMMARY_BODY, '/nickdenys')))).toEqual([])
  })

  it('ignores a comment carrying two author links', () => {
    const html = note(WALKTHROUGH_BODY).replace(
      '<div class="comment-body">',
      '<a href="/apps/coderabbitai" class="author">also</a><div class="comment-body">',
    )

    expect(scanNotes(doc(html))).toEqual([])
  })

  /**
   * The trap `resolvable.html` carries twice: on a repository you can write to,
   * GitHub ships the comment's raw markdown in an edit form, so the line is in
   * the page a second time as text nobody rendered.
   */
  it('does not read the count out of an edit form textarea', () => {
    const raw = '<p>Nothing to see.</p><textarea>**Actionable comments posted: 4**</textarea>'

    expect(scanNotes(doc(note(raw)))).toEqual([])
  })

  it('counts a summary with a two digit total', () => {
    const found = scanNotes(doc(note('<p><strong>Actionable comments posted: 26</strong></p>')))

    expect(found[0]).toMatchObject({ kind: 'summary', actionableCount: 26 })
  })

  it('calls a comment carrying both markers a walkthrough, and still counts it', () => {
    const found = scanNotes(doc(note(`${WALKTHROUGH_BODY}${SUMMARY_BODY}`)))

    expect(found[0]).toMatchObject({ kind: 'walkthrough', actionableCount: 3 })
  })

  it('ignores a marker that is not inside a comment body', () => {
    const html = note('<p>Nothing to see.</p>').replace(
      '<div class="comment-body">',
      '<h2>Walkthrough</h2><div class="comment-body">',
    )

    expect(scanNotes(doc(html))).toEqual([])
  })

  it('skips a comment inside a review thread', () => {
    const html = `<review-thread-collapsible>${note(SUMMARY_BODY)}</review-thread-collapsible>`

    expect(scanNotes(doc(html))).toEqual([])
  })

  it('falls back to the comment group when there is no TimelineItem row', () => {
    const html = note(SUMMARY_BODY).replace('<div class="TimelineItem">', '<div>')
    const found = scanNotes(doc(html))

    expect(found).toHaveLength(1)
    expect(found[0].el.matches('.timeline-comment-group')).toBe(true)
    expect(found[0].timelineItem?.matches('.js-timeline-item')).toBe(true)
  })

  it('returns an empty array on an empty document', () => {
    expect(scanNotes(doc(''))).toEqual([])
  })
})

/** Counted without going through `scanNotes`, so the expectations stay independent. */
function standaloneCodeRabbitComments(document: Document): number {
  return [...document.querySelectorAll('.timeline-comment-group')].filter((group) => {
    if (group.closest('review-thread-collapsible') !== null) return false

    const links = group.querySelectorAll('a.author')
    return links.length === 1 && links[0].getAttribute('href') === '/apps/coderabbitai'
  }).length
}
