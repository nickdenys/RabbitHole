import { describe, expect, it } from 'vitest'
import { categoryMark } from '../src/panel/category'
import { parseTriple } from '../src/parse/severity'
import { fixtureNames, loadFixture } from './support/fixture'

const CODERABBIT = '/apps/coderabbitai'

/** Every category word CodeRabbit actually wrote across the committed captures. */
function capturedCategories(): string[] {
  const seen = new Set<string>()

  for (const name of fixtureNames()) {
    for (const thread of loadFixture(name).querySelectorAll('review-thread-collapsible')) {
      if (thread.querySelector('a.author')?.getAttribute('href') !== CODERABBIT) continue

      const body = thread.querySelector('.review-comment .comment-body')
      const triple = body === null ? null : parseTriple(body)
      if (triple !== null) seen.add(triple.category)
    }
  }

  return [...seen].sort()
}

describe('categoryMark', () => {
  it('shortens the category to the clause before the ampersand', () => {
    expect(categoryMark('Maintainability & Code Quality')).toEqual({
      key: 'maintainability',
      label: 'Maintainability',
    })
    expect(categoryMark('Security & Privacy')).toEqual({ key: 'security', label: 'Security' })
    expect(categoryMark('Stability & Availability')).toEqual({ key: 'stability', label: 'Stability' })
    expect(categoryMark('Performance & Scalability')).toEqual({
      key: 'performance',
      label: 'Performance',
    })
    expect(categoryMark('Data Integrity & Integration')).toEqual({
      key: 'data-integrity',
      label: 'Data Integrity',
    })
  })

  /**
   * The one category with no ampersand in it, which is why the six are a table
   * and not a rule: a rule would have printed `Functional Correctness` in full
   * beside five one word neighbours.
   */
  it('shortens the one category that has no ampersand', () => {
    expect(categoryMark('Functional Correctness')).toEqual({
      key: 'correctness',
      label: 'Correctness',
    })
  })

  /**
   * CodeRabbit's older first field, which two fixture comments still carry. It
   * is a kind of comment rather than a category, so it keeps its own words, and
   * it takes correctness's hue because it makes correctness's claim.
   */
  it("gives the older Potential issue label correctness's hue", () => {
    expect(categoryMark('Potential issue')).toEqual({
      key: 'correctness',
      label: 'Potential issue',
    })
  })

  /**
   * The same bargain `sort.ts` makes with an unrecognised effort word. Seven
   * measured words are not a closed vocabulary, and the cost of meeting an
   * eighth is a grey dot rather than a row that says nothing.
   */
  it('keeps an unmapped category whole, with no hue', () => {
    expect(categoryMark('Refactor suggestion')).toEqual({
      key: null,
      label: 'Refactor suggestion',
    })
    expect(categoryMark('')).toEqual({ key: null, label: '' })
  })

  it('matches whatever case and padding the comment arrives in', () => {
    expect(categoryMark('  SECURITY & privacy ')).toEqual({ key: 'security', label: 'Security' })
  })
})

describe('categoryMark, against the captures', () => {
  /**
   * The five the fixtures hold on 21 August 2026: `Maintainability & Code
   * Quality`, `Functional Correctness`, `Potential issue`, `Security & Privacy`
   * and `Stability & Availability`. This fails the day a capture brings a
   * sixth, which is the point: a new category should be a decision about its
   * hue rather than a grey dot nobody noticed.
   */
  it('has a hue and a short word for every category CodeRabbit has written here', () => {
    const captured = capturedCategories()

    expect(captured.length).toBeGreaterThan(0)
    expect(captured.filter((category) => categoryMark(category).key === null)).toEqual([])
  })

  it('never shortens a category to nothing', () => {
    for (const category of capturedCategories()) {
      expect(categoryMark(category).label).not.toBe('')
    }
  })
})
