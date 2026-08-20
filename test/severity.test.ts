import { describe, expect, it } from 'vitest'
import { parseTriple } from '../src/parse/severity'
import { loadFixture } from './support/fixture'

const CODERABBIT = '/apps/coderabbitai'

const docs = {
  unresolvedAndResolved: loadFixture('unresolved-and-resolved'),
  humanReplies: loadFixture('human-replies'),
  noCodeRabbit: loadFixture('no-coderabbit'),
}

/** The body of every thread's root comment, which is where the triple lives. */
function rootBodies(doc: Document): Element[] {
  return [...doc.querySelectorAll('review-thread-collapsible')]
    .map((thread) => thread.querySelector('.review-comment .comment-body'))
    .filter((body) => body !== null)
}

function rootAuthor(thread: Element): string | null {
  return thread.querySelector('a.author')?.getAttribute('href') ?? null
}

/** Every comment body sitting inside a thread CodeRabbit opened. */
function codeRabbitBodies(doc: Document): Element[] {
  return [...doc.querySelectorAll('review-thread-collapsible')]
    .filter((thread) => rootAuthor(thread) === CODERABBIT)
    .flatMap((thread) => [...thread.querySelectorAll('.comment-body')])
}

describe('parseTriple, against real CodeRabbit markup', () => {
  it('parses the triple off a real comment', () => {
    const [first] = codeRabbitBodies(docs.unresolvedAndResolved)

    expect(parseTriple(first)).toEqual({
      category: 'Functional Correctness',
      severity: 'major',
      effort: 'Quick win',
    })
  })

  it('ignores the em elements after the third', () => {
    // The real comment above carries a fourth em, "Source: Path instructions".
    // Reading by position is what keeps it out.
    const [first] = codeRabbitBodies(docs.unresolvedAndResolved)

    expect(first.querySelectorAll('em').length).toBeGreaterThan(3)
    expect(parseTriple(first)?.effort).toBe('Quick win')
  })

  it('parses Trivial, which is a real severity and used to fail the whole triple', () => {
    // 8 of the 47 CodeRabbit root comments across the fixtures state it, 7 of
    // which parse (the eighth states no effort, see below) and 6 of those are
    // here. Before 20 August 2026 every one of them lost its category and its
    // effort along with the severity.
    const trivial = codeRabbitBodies(docs.humanReplies)
      .map(parseTriple)
      .filter((triple) => triple?.severity === 'trivial')

    expect(trivial.length).toBe(6)
    expect(trivial[0]?.category).not.toBe('')
    expect(trivial[0]?.effort).not.toBe('')
  })

  it('still refuses a two part triple, where the third em is the Sources footer', () => {
    // `human-replies.html` carries the contrast in two near identical comments,
    // both "Remove the redundant Returns section from this private helper":
    //
    //   📐 Maintainability & Code Quality | 🔵 Trivial | ⚡ Quick win   parses
    //   📐 Maintainability & Code Quality | 🔵 Trivial                 refused
    //
    // The second states no effort, so its third em is the "Sources:" footer.
    // That em carries no emoji, which is what the shape check catches. Reading
    // it as an effort would put "Sources: Path instructions, Learnings" in the
    // panel's effort column, and this is the one no-triple CodeRabbit root left
    // in the fixtures. See DOM reference.
    const pair = rootBodies(docs.humanReplies)
      .filter((body) => (body.textContent ?? '').includes('Remove the redundant Returns section'))
    expect(pair).toHaveLength(2)

    const twoPart = pair.filter((body) => body.querySelectorAll('em')[2]?.textContent?.startsWith('Sources:'))
    expect(twoPart).toHaveLength(1)

    expect(parseTriple(twoPart[0])).toBeNull()
    expect(parseTriple(pair.find((body) => body !== twoPart[0])!)).toEqual({
      category: 'Maintainability & Code Quality',
      severity: 'trivial',
      effort: 'Quick win',
    })
  })

  it('returns null on a real human comment', () => {
    const human = [...docs.noCodeRabbit.querySelectorAll('review-thread-collapsible .comment-body')]

    expect(human.length).toBeGreaterThan(0)
    expect(human.map(parseTriple)).toEqual(human.map(() => null))
  })

  it('never throws on any CodeRabbit comment in the fixtures', () => {
    // Breadth rather than depth: a body CodeRabbit wrote without a triple is a
    // gap the panel badges, not a crash, and there are plenty of them.
    const bodies = [
      ...codeRabbitBodies(docs.unresolvedAndResolved),
      ...codeRabbitBodies(docs.humanReplies),
    ]
    expect(bodies.length).toBeGreaterThan(10)

    const parsed = bodies.map((body) => parseTriple(body))
    expect(parsed.some((triple) => triple !== null)).toBe(true)
    for (const triple of parsed) {
      if (triple === null) continue
      expect(triple.severity).toMatch(/^(critical|major|minor|trivial)$/)
      expect(triple.category).not.toBe('')
      expect(triple.effort).not.toBe('')
    }
  })
})

describe('parseTriple, the shapes it must refuse', () => {
  // Hand built on purpose: no real comment has three ems of prose, which is
  // exactly why the emoji requirement needs its own test.
  function commentBody(html: string): Element {
    const el = document.createElement('div')
    el.className = 'comment-body'
    el.innerHTML = html
    return el
  }

  it('returns null with fewer than three em elements', () => {
    expect(parseTriple(commentBody('<p><em>🟠 Major</em></p>'))).toBeNull()
  })

  it('returns null when the severity word is unrecognized', () => {
    const body = commentBody('<p><em>🧹 Style</em> | <em>🌀 Cosmic</em> | <em>⚡ Quick win</em></p>')
    expect(parseTriple(body)).toBeNull()
  })

  it('does not match severity words in prose, unlike a body-wide text search', () => {
    const body = commentBody('<p>This is a <em>major</em> refactor of the <em>critical</em> path, <em>minor</em> nit.</p>')
    expect(parseTriple(body)).toBeNull()
  })
})
