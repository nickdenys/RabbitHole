import type { TriageRow } from '../engine'
import type { Severity } from '../types'

/**
 * The two axes v0.1 ships. State, category and effort join them in B6, which is
 * why this is a union rather than a boolean.
 */
export type SortAxis = 'severity' | 'file'

/** What the picker calls each axis, in the order it offers them. */
export const SORT_LABELS: Record<SortAxis, string> = {
  severity: 'Severity',
  file: 'File',
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
 * The worklist in the order the reader asked for, as a new array.
 *
 * Pure and non-mutating because the input is the panel's `listed` list, which
 * `App` also counts the handle from: sorting in place would reorder the array
 * a sibling render is reading.
 *
 * Nothing is ever filtered here. Every row that goes in comes out, including
 * the ones with no severity and no file, because a row is the only place a
 * hidden finding still exists.
 */
export function sortRows(rows: TriageRow[], axis: SortAxis): TriageRow[] {
  return [...rows].sort(axis === 'severity' ? bySeverity : byFile)
}

/**
 * Ties are left to the sort's own stability, which means equal severities stay
 * in page order. That order is the timeline's, so a reader who scrolls the pull
 * request sees the same sequence rather than an arbitrary one.
 */
function bySeverity(a: TriageRow, b: TriageRow): number {
  return severityRank(a) - severityRank(b)
}

/** Path first, severity second, so one file's findings read worst first. */
function byFile(a: TriageRow, b: TriageRow): number {
  return compareFiles(a.thread.file, b.thread.file) || bySeverity(a, b)
}

function severityRank(row: TriageRow): number {
  const severity = row.finding?.severity
  return severity == null ? UNKNOWN_SEVERITY : SEVERITY_RANK[severity]
}

/**
 * A missing path sorts last for the same reason a missing severity does: it is
 * a thread that could not be fully described, not a thread that stops existing.
 *
 * `localeCompare` with a fixed locale rather than `<`, so `README.md` and
 * `src/app.ts` group the way a file list reads instead of by code point, and so
 * the result does not move with the machine's locale.
 */
function compareFiles(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b, 'en')
}
