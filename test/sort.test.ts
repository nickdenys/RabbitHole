import { describe, expect, it } from 'vitest'
import type { TriageRow } from '../src/engine'
import {
  groupRows,
  SORT_DIRECTIONS,
  SORT_HINTS,
  SORT_LABELS,
  sortRows,
  type SortAxis,
} from '../src/panel/sort'
import type { Severity } from '../src/types'

/** The description fields the two B6 axes read. */
interface RowOver {
  category?: string | null
  effort?: string | null
}

/**
 * A row reduced to what sorting reads, plus an `id` to assert the resulting
 * order by. Everything else is what the drawer's own tests cover.
 *
 * A null severity means no finding at all, which is the collapsed thread the
 * fetch has not answered for: it takes the category and the effort with it, so
 * `over` only reaches the finding when there is one.
 */
function row(
  id: string,
  severity: Severity | null,
  file: string | null,
  over: RowOver = {},
): TriageRow {
  return {
    thread: {
      el: null as unknown as Element,
      timelineItem: null,
      id,
      file,
      resolved: false,
      outdated: false,
      collapsed: false,
      deferredUrl: null,
      authors: null,
      problems: [],
    },
    finding:
      severity === null
        ? null
        : {
            title: id,
            category: over.category === undefined ? 'Potential issue' : over.category,
            severity,
            effort: over.effort === undefined ? '~10 minutes' : over.effort,
            aiPrompt: null,
            permalink: null,
          },
    verdict: { hide: true },
  }
}

const ids = (rows: TriageRow[]): string[] => rows.map((r) => r.thread.id)

describe('sortRows, by severity', () => {
  it('orders critical, major, minor, trivial', () => {
    const rows = [
      row('trivial', 'trivial', 'a.ts'),
      row('major', 'major', 'a.ts'),
      row('critical', 'critical', 'a.ts'),
      row('minor', 'minor', 'a.ts'),
    ]

    expect(ids(sortRows(rows, 'severity'))).toEqual(['critical', 'major', 'minor', 'trivial'])
  })

  it('puts an unknown severity last and never drops it', () => {
    const rows = [
      row('no-triple', null, 'a.ts'),
      row('minor', 'minor', 'a.ts'),
      row('no-finding-either', null, 'a.ts'),
      row('critical', 'critical', 'a.ts'),
    ]

    const sorted = sortRows(rows, 'severity')

    expect(ids(sorted)).toEqual(['critical', 'minor', 'no-triple', 'no-finding-either'])
    expect(sorted).toHaveLength(rows.length)
  })

  it('is stable, so equal severities keep page order', () => {
    const rows = [
      row('first', 'minor', 'z.ts'),
      row('second', 'minor', 'a.ts'),
      row('third', 'minor', 'm.ts'),
    ]

    expect(ids(sortRows(rows, 'severity'))).toEqual(['first', 'second', 'third'])
  })
})

describe('sortRows, by file', () => {
  it('orders by path', () => {
    const rows = [
      row('c', 'minor', 'src/panel/App.tsx'),
      row('a', 'minor', 'README.md'),
      row('b', 'minor', 'src/engine.ts'),
    ]

    expect(ids(sortRows(rows, 'file'))).toEqual(['a', 'b', 'c'])
  })

  it('breaks a tie on severity, worst first', () => {
    const rows = [
      row('a-minor', 'minor', 'a.ts'),
      row('a-critical', 'critical', 'a.ts'),
      row('b-major', 'major', 'b.ts'),
      row('a-major', 'major', 'a.ts'),
    ]

    expect(ids(sortRows(rows, 'file'))).toEqual(['a-critical', 'a-major', 'a-minor', 'b-major'])
  })

  it('puts an unknown file last and never drops it', () => {
    const rows = [
      row('unknown', 'critical', null),
      row('known', 'trivial', 'z.ts'),
    ]

    const sorted = sortRows(rows, 'file')

    expect(ids(sorted)).toEqual(['known', 'unknown'])
    expect(sorted).toHaveLength(rows.length)
  })

  it('is stable across two unknown files', () => {
    const rows = [
      row('first', 'minor', null),
      row('second', 'minor', null),
    ]

    expect(ids(sortRows(rows, 'file'))).toEqual(['first', 'second'])
  })
})

describe('sortRows, both axes', () => {
  it('sorts an empty list to an empty list', () => {
    expect(sortRows([], 'severity')).toEqual([])
    expect(sortRows([], 'file')).toEqual([])
  })

  it('does not mutate its input', () => {
    const rows = [row('b', 'minor', 'b.ts'), row('a', 'critical', 'a.ts')]
    const before = ids(rows)

    sortRows(rows, 'severity')
    sortRows(rows, 'file')

    expect(ids(rows)).toEqual(before)
  })

  it('returns a new array', () => {
    const rows = [row('a', 'minor', 'a.ts')]

    expect(sortRows(rows, 'severity')).not.toBe(rows)
  })
})

describe('sortRows, by category', () => {
  it('orders by the category word', () => {
    const rows = [
      row('security', 'minor', 'a.ts', { category: 'Security & Privacy' }),
      row('correctness', 'minor', 'a.ts', { category: 'Functional Correctness' }),
      row('maintainability', 'minor', 'a.ts', { category: 'Maintainability & Code Quality' }),
    ]

    expect(ids(sortRows(rows, 'category'))).toEqual(['correctness', 'maintainability', 'security'])
  })

  it('breaks a tie on severity, worst first', () => {
    const rows = [
      row('a-minor', 'minor', 'z.ts', { category: 'A' }),
      row('a-critical', 'critical', 'z.ts', { category: 'A' }),
    ]

    expect(ids(sortRows(rows, 'category'))).toEqual(['a-critical', 'a-minor'])
  })

  it('puts a missing category last and never drops it', () => {
    const rows = [
      row('none', 'critical', 'a.ts', { category: null }),
      row('no-finding', null, 'a.ts'),
      row('stated', 'trivial', 'a.ts', { category: 'Stability & Availability' }),
    ]

    const sorted = sortRows(rows, 'category')

    expect(ids(sorted)).toEqual(['stated', 'none', 'no-finding'])
    expect(sorted).toHaveLength(rows.length)
  })
})

describe('sortRows, by effort', () => {
  it('orders CodeRabbit s three words cheapest return first', () => {
    const rows = [
      row('low', 'minor', 'a.ts', { effort: 'Low value' }),
      row('heavy', 'minor', 'a.ts', { effort: 'Heavy lift' }),
      row('quick', 'minor', 'a.ts', { effort: 'Quick win' }),
    ]

    expect(ids(sortRows(rows, 'effort'))).toEqual(['quick', 'heavy', 'low'])
  })

  it('matches the word however it is cased', () => {
    const rows = [
      row('shouty', 'minor', 'a.ts', { effort: 'LOW VALUE' }),
      row('quiet', 'minor', 'a.ts', { effort: 'quick win' }),
    ]

    expect(ids(sortRows(rows, 'effort'))).toEqual(['quiet', 'shouty'])
  })

  it('sorts a word it does not know after the three, alphabetically', () => {
    const rows = [
      row('zeta', 'minor', 'a.ts', { effort: 'Zeta effort' }),
      row('none', 'minor', 'a.ts', { effort: null }),
      row('alpha', 'minor', 'a.ts', { effort: 'Alpha effort' }),
      row('low', 'minor', 'a.ts', { effort: 'Low value' }),
    ]

    const sorted = sortRows(rows, 'effort')

    expect(ids(sorted)).toEqual(['low', 'alpha', 'zeta', 'none'])
    expect(sorted).toHaveLength(rows.length)
  })

  it('breaks a tie on severity, worst first', () => {
    const rows = [
      row('quick-minor', 'minor', 'a.ts', { effort: 'Quick win' }),
      row('quick-major', 'major', 'a.ts', { effort: 'Quick win' }),
    ]

    expect(ids(sortRows(rows, 'effort'))).toEqual(['quick-major', 'quick-minor'])
  })
})

describe('sortRows, every axis', () => {
  const axes = Object.keys(SORT_LABELS) as SortAxis[]

  it('offers the four the design settled on, severity first', () => {
    expect(axes).toEqual(['severity', 'file', 'category', 'effort'])
  })

  it.each(axes)('sorts an empty list to an empty list on %s', (axis) => {
    expect(sortRows([], axis)).toEqual([])
  })

  it.each(axes)('keeps every row on %s', (axis) => {
    const rows = [
      row('described', 'major', 'a.ts', { category: 'B', effort: 'Quick win' }),
      row('bare', null, null),
      row('done', 'trivial', 'z.ts', { category: null, effort: null }),
    ]

    expect(ids(sortRows(rows, axis)).sort()).toEqual(['bare', 'described', 'done'])
  })

  it.each(axes)('does not mutate its input on %s', (axis) => {
    const rows = [row('b', 'minor', 'b.ts'), row('a', 'critical', 'a.ts')]
    const before = ids(rows)

    sortRows(rows, axis)

    expect(ids(rows)).toEqual(before)
  })

  it('names every axis in the picker, with a hint and both directions', () => {
    for (const axis of axes) {
      expect(SORT_HINTS[axis]).toBeTruthy()
      expect(SORT_DIRECTIONS[axis]).toHaveLength(2)
      expect(SORT_DIRECTIONS[axis][0]).not.toBe(SORT_DIRECTIONS[axis][1])
    }
  })
})

/**
 * The direction toggle, which is the one control that can put a worklist in the
 * order nobody would choose by default. Turning it off has to be exactly the
 * inverse of leaving it on, and has to leave the ties alone.
 */
describe('sortRows, the other way round', () => {
  it('reads the axis backwards on every one of them', () => {
    const rows = [
      row('a', 'critical', 'a.ts', { category: 'A', effort: 'Quick win' }),
      row('b', 'trivial', 'z.ts', { category: 'Z', effort: 'Low value' }),
    ]

    for (const axis of Object.keys(SORT_LABELS) as SortAxis[]) {
      expect(ids(sortRows(rows, axis, false))).toEqual(
        ids(sortRows(rows, axis, true)).reverse(),
      )
    }
  })

  /**
   * Negated rather than reversed, which is the whole reason it is written that
   * way: a reverse would also flip two rows that compared equal, and equal rows
   * are in the timeline's own order.
   */
  it('leaves rows that compare equal in page order', () => {
    const rows = [
      row('first', 'minor', 'a.ts', { effort: 'Quick win' }),
      row('second', 'minor', 'a.ts', { effort: 'Quick win' }),
    ]

    expect(ids(sortRows(rows, 'effort', false))).toEqual(['first', 'second'])
  })

  it('still keeps every row', () => {
    const rows = [row('described', 'major', 'a.ts'), row('bare', null, null)]

    expect(ids(sortRows(rows, 'severity', false)).sort()).toEqual(['bare', 'described'])
  })
})

describe('groupRows', () => {
  const labels = (groups: { label: string | null }[]): (string | null)[] =>
    groups.map((group) => group.label)

  it('leaves file and effort in one unlabelled group', () => {
    const rows = [row('a', 'minor', 'a.ts'), row('b', 'major', 'b.ts')]

    for (const axis of ['file', 'effort'] as const) {
      const groups = groupRows(sortRows(rows, axis), axis)

      expect(labels(groups)).toEqual([null])
      expect(ids(groups[0].rows)).toHaveLength(2)
    }
  })

  /**
   * The drawer opens on this one, so it is the grouping a reader meets first:
   * three blockers standing apart from ten nitpicks rather than a flat run of
   * thirteen that has to be read to be counted.
   */
  it('heads each severity with CodeRabbit s own word', () => {
    const rows = [
      row('trivial', 'trivial', 'a.ts'),
      row('major-1', 'major', 'a.ts'),
      row('major-2', 'major', 'b.ts'),
    ]

    const groups = groupRows(sortRows(rows, 'severity'), 'severity')

    expect(labels(groups)).toEqual(['Major', 'Trivial'])
    expect(ids(groups[0].rows)).toEqual(['major-1', 'major-2'])
  })

  it('heads a missing severity as the gap it is', () => {
    const groups = groupRows(sortRows([row('bare', null, 'a.ts')], 'severity'), 'severity')

    expect(labels(groups)).toEqual(['No severity stated'])
  })

  /**
   * Only the severity axis has a colour to be, so it is the only one that hands
   * the drawer one. A category heading given an arbitrary hue would be reading
   * as a severity nobody stated.
   */
  it('carries the severity for the heading s dot, and only on that axis', () => {
    const rows = [row('a', 'major', 'a.ts'), row('bare', null, 'a.ts')]

    expect(groupRows(sortRows(rows, 'severity'), 'severity').map((g) => g.severity)).toEqual([
      'major',
      'none',
    ])
    expect(groupRows(sortRows(rows, 'category'), 'category').map((g) => g.severity)).toEqual([
      null,
      null,
    ])
  })

  it('heads each category with its own word', () => {
    const rows = [
      row('sec', 'minor', 'a.ts', { category: 'Security & Privacy' }),
      row('fix-1', 'minor', 'a.ts', { category: 'Functional Correctness' }),
      row('fix-2', 'major', 'a.ts', { category: 'Functional Correctness' }),
    ]

    const groups = groupRows(sortRows(rows, 'category'), 'category')

    expect(labels(groups)).toEqual(['Functional Correctness', 'Security & Privacy'])
    expect(ids(groups[0].rows)).toEqual(['fix-2', 'fix-1'])
  })

  it('heads a missing category as the gap it is', () => {
    const rows = [row('none', 'minor', 'a.ts', { category: null })]

    expect(labels(groupRows(rows, 'category'))).toEqual(['No category stated'])
  })

  it('groups nothing into nothing', () => {
    expect(groupRows([], 'category')).toEqual([])
    expect(groupRows([], 'severity')).toEqual([])
  })

  it('keeps every row exactly once', () => {
    const rows = [
      row('a', 'minor', 'a.ts', { category: 'A' }),
      row('b', 'minor', 'a.ts', { category: 'B' }),
      row('c', null, null),
    ]

    const groups = groupRows(sortRows(rows, 'category'), 'category')

    expect(groups.flatMap((group) => ids(group.rows)).sort()).toEqual(['a', 'b', 'c'])
  })

  it('does not reorder what it is given', () => {
    // A chunker, never a sorter: given an unsorted list it makes two runs of the
    // same label rather than quietly merging them, which is what keeps the
    // ordering decision in exactly one place.
    const rows = [
      row('a', 'minor', 'x.ts', { category: 'A' }),
      row('b', 'minor', 'x.ts', { category: 'B' }),
      row('a-again', 'minor', 'x.ts', { category: 'A' }),
    ]

    expect(labels(groupRows(rows, 'category'))).toEqual(['A', 'B', 'A'])
  })
})
