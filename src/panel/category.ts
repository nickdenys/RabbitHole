/**
 * How a finding's category is drawn on the row: a hue for its dot, and a
 * shorter word than CodeRabbit's own.
 *
 * `key` is the class the dot takes its colour from, and null is a category the
 * panel has no hue for. Null is a gap in this table rather than a fact about
 * the finding, so it draws in `--muted` and keeps its words: an unmapped
 * category still reads, it just stops being a colour.
 *
 * `label` is what the pill prints. It is never a truncation of the category:
 * the mapped ones drop a whole clause, and an unmapped one is printed entire.
 * The row hands the full words to the tooltip whenever the two differ, which is
 * the same bargain the file name makes on the line above.
 */
export interface CategoryMark {
  key: string | null
  label: string
}

/**
 * CodeRabbit's categories, lowercased for matching, with the class its dot
 * takes and the shorter word the pill prints.
 *
 * Five of the seven are counted. Across the five fixtures on 21 August 2026 the
 * root comment of a CodeRabbit thread states `Maintainability & Code Quality`
 * 29 times, `Functional Correctness` 12, `Potential issue` twice, and
 * `Security & Privacy` and `Stability & Availability` once each.
 * `Performance & Scalability` comes from the design's own sample and
 * `Data Integrity & Integration` from the real comment quoted in
 * `parse/severity.ts`, so all seven are words CodeRabbit has written; none of
 * them is invented here.
 *
 * The short forms drop the clause after the ampersand, which is the design's
 * rule and holds for five of the seven. `Functional Correctness` has no
 * ampersand and is shortened to its noun anyway, which is why this is a table
 * and not a function: a rule that covered five and lied about the sixth would
 * be worse than saying all seven out loud.
 *
 * `Potential issue` is the odd one and keeps its full length, because it is not
 * from the same vocabulary as the other six. It is CodeRabbit's older first
 * field, a kind of comment rather than a category, and it arrives wrapped in a
 * `g-emoji` tag rather than as a literal emoji. It shares correctness's blue
 * because it makes correctness's claim: this code is likely wrong. Its own
 * siblings in that older set are not here, because none of them is in a
 * capture, and a hue guessed for a word nobody has seen is worth less than the
 * grey below.
 *
 * An eighth word is not an error. It falls to `null` and prints in full, in the
 * same spirit `sort.ts` sorts an unrecognised effort rather than dropping it.
 */
const KNOWN: Record<string, CategoryMark> = {
  'functional correctness': { key: 'correctness', label: 'Correctness' },
  'maintainability & code quality': { key: 'maintainability', label: 'Maintainability' },
  'performance & scalability': { key: 'performance', label: 'Performance' },
  'security & privacy': { key: 'security', label: 'Security' },
  'stability & availability': { key: 'stability', label: 'Stability' },
  'data integrity & integration': { key: 'data-integrity', label: 'Data Integrity' },
  'potential issue': { key: 'correctness', label: 'Potential issue' },
}

/**
 * The dot and the word for one category, which is always something: a category
 * this panel has never seen is still a category the reader can read.
 */
export function categoryMark(category: string): CategoryMark {
  return KNOWN[category.trim().toLowerCase()] ?? { key: null, label: category }
}
