import type { TriageRow } from '../engine'
import type { Severity } from '../types'

/**
 * The four axes, complete as of B6. Severity and file shipped in A10; category
 * and effort are this step.
 *
 * The order here is the order the picker offers them in, which is the order
 * they were built in rather than an opinion about which is best: severity is
 * the default and stays first, and nothing below it claims a ranking.
 */
export type SortAxis = 'severity' | 'file' | 'category' | 'effort'

/** What the picker calls each axis, in the order it offers them. */
export const SORT_LABELS: Record<SortAxis, string> = {
  severity: 'Severity',
  file: 'File',
  category: 'Category',
  effort: 'Effort',
}

/**
 * The half line the picker prints to the right of each axis, saying what
 * picking it does rather than repeating its name.
 *
 * Two of them describe the shape of the result rather than the order: severity
 * is what the drawer opens on, and category is the axis whose runs are long
 * enough that the headings are the point.
 */
export const SORT_HINTS: Record<SortAxis, string> = {
  severity: 'default',
  file: 'a–z',
  category: 'grouped',
  effort: 'quick wins',
}

/**
 * What the direction toggle is called on each axis, leading direction first.
 *
 * Spelled out per axis rather than as one pair of words, because "descending"
 * means nothing on a worklist: the reader is choosing between quick wins first
 * and heavy lifts first, and the control should say so.
 */
export const SORT_DIRECTIONS: Record<SortAxis, readonly [string, string]> = {
  severity: ['Most important first', 'Least important first'],
  file: ['A to Z', 'Z to A'],
  category: ['A to Z', 'Z to A'],
  effort: ['Quick wins first', 'Heavy lifts first'],
}

/**
 * A run of rows under one heading, which is what the drawer draws.
 *
 * `label` is null for an axis that does not group, and the whole list arrives
 * as a single unlabelled group in that case, so the drawer has one shape to
 * render rather than two.
 *
 * `severity` is what the heading's dot is coloured from, and only the severity
 * axis produces it: 'none' is a run of findings that state no severity, and
 * null is any group that is not a severity group at all. A category heading has
 * no colour to be, so it gets no dot rather than an arbitrary one.
 */
export interface SortGroup {
  label: string | null
  severity: Severity | 'none' | null
  rows: TriageRow[]
}

/**
 * Severity as a number, worst first, matching the order `Severity` is declared
 * in. A rank past the end of the list is how "unknown" sorts last without being
 * a fifth severity: a finding with no triple is a gap in CodeRabbit's comment,
 * and a gap must never push a row off the list.
 */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  trivial: 3,
}

const UNKNOWN_SEVERITY = 4

/** CodeRabbit's own words, capitalised, which is what a severity heading reads. */
const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
  trivial: 'Trivial',
}

/** The heading over rows whose triple was missing, phrased as the gap it is. */
const NO_SEVERITY = 'No severity stated'

/**
 * CodeRabbit's effort words, cheapest return first, lowercased for matching.
 *
 * Counted across the five fixtures on 21 August 2026: `⚡ Quick win` 129 times,
 * `🏗️ Heavy lift` 6, `💤 Low value` 4, and nothing else. `Low value` is last
 * on purpose even though it is not the most work: it is CodeRabbit's own word
 * for a finding that is not worth doing, which is where a worklist should end.
 *
 * A word that is not on this list is still sorted and still listed, after the
 * three and alphabetically among its own kind. Three measured words are not a
 * closed vocabulary, and the cost of being wrong about a fourth is a row in an
 * odd place rather than a row nobody sees.
 */
const EFFORT_ORDER = ['quick win', 'heavy lift', 'low value']

/** Stated but unrecognised, which still sorts ahead of stating nothing at all. */
const UNKNOWN_EFFORT = EFFORT_ORDER.length

const NO_EFFORT = EFFORT_ORDER.length + 1

/** The heading over rows with no category, phrased as the gap it is. */
const NO_CATEGORY = 'No category stated'

/**
 * The worklist in the order the reader asked for, as a new array.
 *
 * Pure and non-mutating because the input is the panel's `listed` list, which
 * `App` also counts the handle from: sorting in place would reorder the array
 * a sibling render is reading.
 *
 * `leading` is the direction the axis names first in `SORT_DIRECTIONS`, and
 * turning it off negates the comparator rather than reversing the result. The
 * two are not the same thing: `Array.prototype.sort` is stable, so a reverse
 * would also flip the rows that compared equal, and equal rows are in page
 * order. Negating leaves the ties alone, so one file, one category or one
 * effort still reads in the timeline's own sequence either way round.
 *
 * Nothing is ever filtered here. Every row that goes in comes out, including
 * the ones with no severity, no file, no category and no effort, because a row
 * is the only place a hidden finding still exists.
 */
export function sortRows(rows: TriageRow[], axis: SortAxis, leading = true): TriageRow[] {
  const compare = COMPARATORS[axis]
  return rows.sort(leading ? compare : (a, b) => -compare(a, b))
}

/**
 * A sorted list cut into the runs the drawer puts a heading over.
 *
 * A chunker and nothing more: it takes the order it is given and never makes
 * one, so the axis decides the sequence in exactly one place. Consecutive rows
 * sharing a label are one group, which is only the same thing as "all rows with
 * that label" because the caller sorted on the same axis first.
 *
 * Severity and category group; file and effort do not. Severity heads its runs
 * because the drawer opens on it and a reader wants to see three blockers
 * standing apart from ten nitpicks. A file heading would repeat the line each
 * row already carries, and effort has three values across every capture, so
 * both would add a line and say nothing the row does not.
 */
export function groupRows(rows: TriageRow[], axis: SortAxis): SortGroup[] {
  const label = GROUP_LABELS[axis]
  if (label === null) return rows.length === 0 ? [] : [{ label: null, severity: null, rows }]

  const groups: SortGroup[] = []

  for (const row of rows) {
    const heading = label(row)
    const last = groups.at(-1)

    if (last !== undefined && last.label === heading) last.rows.push(row)
    else groups.push({ label: heading, severity: headingSeverity(row, axis), rows: [row] })
  }

  return groups
}

type Comparator = (a: TriageRow, b: TriageRow) => number

/**
 * Ties are left to the sort's own stability, which means equal severities stay
 * in page order. That order is the timeline's, so a reader who scrolls the pull
 * request sees the same sequence rather than an arbitrary one.
 */
function bySeverity(a: TriageRow, b: TriageRow): number {
  return severityRank(a) - severityRank(b)
}

/**
 * Every other axis breaks its ties on severity, so one file, one category and
 * one effort each read worst first.
 */
function then(compare: Comparator): Comparator {
  return (a, b) => compare(a, b) || bySeverity(a, b)
}

const COMPARATORS: Record<SortAxis, Comparator> = {
  severity: bySeverity,
  file: then((a, b) => compareText(a.thread.file, b.thread.file)),
  category: then((a, b) => compareText(a.finding?.category ?? null, b.finding?.category ?? null)),
  effort: then(byEffort),
}

/**
 * Null for an axis whose runs get no heading, so `groupRows` has one thing to
 * check rather than a list of axis names to keep in step with `SortAxis`.
 */
const GROUP_LABELS: Record<SortAxis, ((row: TriageRow) => string) | null> = {
  severity: (row) => severityLabel(row),
  file: null,
  category: (row) => row.finding?.category ?? NO_CATEGORY,
  effort: null,
}

/** The colour the heading's dot takes, which only the severity axis has one for. */
function headingSeverity(row: TriageRow, axis: SortAxis): Severity | 'none' | null {
  if (axis !== 'severity') return null
  return row.finding?.severity ?? 'none'
}

function severityLabel(row: TriageRow): string {
  const severity = row.finding?.severity
  return severity == null ? NO_SEVERITY : SEVERITY_LABELS[severity]
}

function severityRank(row: TriageRow): number {
  const severity = row.finding?.severity
  return severity == null ? UNKNOWN_SEVERITY : SEVERITY_RANK[severity]
}

/**
 * Known words in their measured order, then anything else alphabetically, then
 * the rows that state no effort at all.
 *
 * The second comparison only ever decides between two unrecognised words, since
 * two rows sharing a known rank share the word itself and compare equal.
 */
function byEffort(a: TriageRow, b: TriageRow): number {
  const effortA = a.finding?.effort ?? null
  const effortB = b.finding?.effort ?? null

  return effortRank(effortA) - effortRank(effortB) || compareText(effortA, effortB)
}

function effortRank(effort: string | null): number {
  if (effort === null) return NO_EFFORT

  const known = EFFORT_ORDER.indexOf(effort.toLowerCase())
  return known === -1 ? UNKNOWN_EFFORT : known
}

/**
 * One collator, built once, rather than the one `localeCompare` builds per
 * call.
 *
 * `a.localeCompare(b, 'en')` is this comparison, and engines are free to
 * construct a collator for the locale on every call to it. Sorting the
 * worklist on file, category or effort is a comparison per step of the sort,
 * so a hundred rows is several hundred of them, on every render that changes
 * the axis. Identical answers: a fixed locale and no options either way.
 */
const COLLATOR = new Intl.Collator('en')

/**
 * A missing value sorts last for the same reason a missing severity does: it is
 * a thread that could not be fully described, not a thread that stops existing.
 *
 * Collated with a fixed locale rather than compared with `<`, so `README.md`
 * and `src/app.ts` group the way a file list reads instead of by code point,
 * and so the result does not move with the machine's locale.
 */
function compareText(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return COLLATOR.compare(a, b)
}
