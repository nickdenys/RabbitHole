import type { TriageRow } from '../engine'
import type { Severity } from '../types'

/**
 * The five axes, complete as of B6. Severity and file shipped in A10; state,
 * category and effort are this step.
 *
 * The order here is the order the picker offers them in, which is the order
 * they were built in rather than an opinion about which is best: severity is
 * the default and stays first, and nothing below it claims a ranking.
 */
export type SortAxis = 'severity' | 'file' | 'state' | 'category' | 'effort'

/** What the picker calls each axis, in the order it offers them. */
export const SORT_LABELS: Record<SortAxis, string> = {
  severity: 'Severity',
  file: 'File',
  state: 'State',
  category: 'Category',
  effort: 'Effort',
}

/**
 * A run of rows under one heading, which is what the drawer draws.
 *
 * `label` is null for an axis that does not group, and the whole list arrives
 * as a single unlabelled group in that case, so the drawer has one shape to
 * render rather than two.
 */
export interface SortGroup {
  label: string | null
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

/**
 * The three states a reader triages by, worst-first in the sense of "still your
 * problem".
 *
 * Read off the thread and never off the finding, so this axis works on a thread
 * whose body could not be read at all. Outdated sits between the two because an
 * open finding on code that has since moved is real work with a strong chance
 * of being obsolete, and burying it under the resolved ones would hide it.
 *
 * Resolved is last rather than first because the drawer is a worklist. An
 * outdated thread that is also resolved is resolved: done outranks stale.
 */
const STATE_LABELS = ['Open', 'Outdated', 'Resolved'] as const

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
 * Nothing is ever filtered here. Every row that goes in comes out, including
 * the ones with no severity, no file, no category and no effort, because a row
 * is the only place a hidden finding still exists.
 */
export function sortRows(rows: TriageRow[], axis: SortAxis): TriageRow[] {
  return [...rows].sort(COMPARATORS[axis])
}

/**
 * A sorted list cut into the runs the drawer puts a heading over.
 *
 * A chunker and nothing more: it takes the order it is given and never makes
 * one, so the axis decides the sequence in exactly one place. Consecutive rows
 * sharing a label are one group, which is only the same thing as "all rows with
 * that label" because the caller sorted on the same axis first.
 *
 * Category and state group; severity, file and effort do not. Severity is
 * already legible from the coloured dot on every row, a file heading would
 * repeat the line each row already carries, and effort has three values across
 * every capture, so all three would be headings that add a line and say nothing
 * the row does not.
 */
export function groupRows(rows: TriageRow[], axis: SortAxis): SortGroup[] {
  const label = GROUP_LABELS[axis]
  if (label === null) return rows.length === 0 ? [] : [{ label: null, rows }]

  const groups: SortGroup[] = []

  for (const row of rows) {
    const heading = label(row)
    const last = groups.at(-1)

    if (last !== undefined && last.label === heading) last.rows.push(row)
    else groups.push({ label: heading, rows: [row] })
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
 * Every other axis breaks its ties on severity, so one file, one state, one
 * category and one effort each read worst first.
 */
function then(compare: Comparator): Comparator {
  return (a, b) => compare(a, b) || bySeverity(a, b)
}

const COMPARATORS: Record<SortAxis, Comparator> = {
  severity: bySeverity,
  file: then((a, b) => compareText(a.thread.file, b.thread.file)),
  state: then((a, b) => stateRank(a) - stateRank(b)),
  category: then((a, b) => compareText(a.finding?.category ?? null, b.finding?.category ?? null)),
  effort: then(byEffort),
}

/**
 * Null for an axis whose runs get no heading, so `groupRows` has one thing to
 * check rather than a list of axis names to keep in step with `SortAxis`.
 */
const GROUP_LABELS: Record<SortAxis, ((row: TriageRow) => string) | null> = {
  severity: null,
  file: null,
  state: (row) => STATE_LABELS[stateRank(row)],
  category: (row) => row.finding?.category ?? NO_CATEGORY,
  effort: null,
}

function severityRank(row: TriageRow): number {
  const severity = row.finding?.severity
  return severity == null ? UNKNOWN_SEVERITY : SEVERITY_RANK[severity]
}

/** An index into `STATE_LABELS`, so the order and the headings cannot drift. */
function stateRank(row: TriageRow): number {
  if (row.thread.resolved) return 2
  return row.thread.outdated ? 1 : 0
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
 * A missing value sorts last for the same reason a missing severity does: it is
 * a thread that could not be fully described, not a thread that stops existing.
 *
 * `localeCompare` with a fixed locale rather than `<`, so `README.md` and
 * `src/app.ts` group the way a file list reads instead of by code point, and so
 * the result does not move with the machine's locale.
 */
function compareText(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b, 'en')
}
