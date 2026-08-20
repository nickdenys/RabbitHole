import { describe, expect, it } from 'vitest'
import type { TriageRow } from '../src/engine'
import { sortRows } from '../src/panel/sort'
import type { Severity } from '../src/types'

/**
 * A row reduced to the two things sorting reads, plus an `id` to assert the
 * resulting order by. Everything else is what the drawer's own tests cover.
 */
function row(id: string, severity: Severity | null, file: string | null): TriageRow {
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
            category: 'Potential issue',
            severity,
            effort: '~10 minutes',
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
