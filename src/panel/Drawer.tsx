import { useState } from 'preact/hooks'
import type { TriageRow, TriageState } from '../engine'
import { Row } from './Row'
import { emptyState, unreadCount, type EmptyState } from './rows'
import { SORT_LABELS, sortRows, type SortAxis } from './sort'

interface DrawerProps {
  state: TriageState
  /** Computed once by `App`, which needs the same list for the handle's count. */
  listed: TriageRow[]
  onClose: () => void
}

/**
 * The worklist. Fixed to the right edge, inside the panel's shadow root, so
 * neither GitHub's stylesheet nor its rerenders reach it.
 */
export function Drawer({ state, listed, onClose }: DrawerProps) {
  // Held here rather than in `App` so it lives exactly as long as the open
  // drawer does. A pass runs on every mutation and hands down a new `listed`,
  // and preact keeps this across those renders, so a churning page does not
  // reshuffle the list under the reader.
  const [axis, setAxis] = useState<SortAxis>('severity')

  const empty = emptyState(state, listed)
  const open = listed.filter((row) => !row.thread.resolved).length
  const unread = unreadCount(state)
  const sorted = sortRows(listed, axis)

  return (
    <aside class="drawer" aria-label="CodeRabbit Triage">
      <header class="drawer-head">
        <h1 class="drawer-title">{empty === 'unsupported' ? 'CodeRabbit Triage' : headline(open)}</h1>
        <button class="close" type="button" onClick={onClose} aria-label="Close CodeRabbit Triage">
          ×
        </button>
      </header>

      {state.counts.unparsed > 0 && (
        <p class="notice warn">
          {count(state.counts.unparsed, 'thread')} could not be read, so {state.counts.unparsed === 1 ? 'it is' : 'they are'} still in the timeline.
        </p>
      )}

      {empty !== null && <Empty kind={empty} />}

      {listed.length > 0 && <SortPicker axis={axis} onChange={setAxis} />}

      {sorted.length > 0 && (
        <ul class="rows">
          {sorted.map((row) => (
            <Row row={row} key={rowKey(row)} />
          ))}
        </ul>
      )}

      {empty !== 'unsupported' && unread > 0 && (
        <p class="notice">
          {count(unread, 'resolved thread')} not listed: GitHub does not render a resolved thread's
          comments, and fetching them comes in v0.2.
        </p>
      )}
    </aside>
  )
}

/**
 * The axis picker. A select rather than a pair of buttons because B6 adds three
 * more axes to the same control, and a five item toggle row does not fit a
 * 380px drawer.
 */
function SortPicker({ axis, onChange }: { axis: SortAxis; onChange: (axis: SortAxis) => void }) {
  return (
    <div class="sort">
      <label class="sort-label" for="cr-sort">
        Sort by
      </label>
      <select
        class="sort-select"
        id="cr-sort"
        value={axis}
        onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value as SortAxis)}
      >
        {(Object.keys(SORT_LABELS) as SortAxis[]).map((option) => (
          <option value={option} key={option}>
            {SORT_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * The three states that are not a list, spelled out rather than shared, because
 * the whole point of invariant 3 is that they do not read alike.
 */
function Empty({ kind }: { kind: EmptyState }) {
  if (kind === 'unsupported') {
    return (
      <div class="empty">
        <p class="empty-title">This page could not be read</p>
        <p>
          GitHub is serving a pull request layout this extension does not know. Nothing was hidden
          and nothing is listed, which is not the same as finding nothing.
        </p>
      </div>
    )
  }

  if (kind === 'no-findings') {
    return (
      <div class="empty">
        <p class="empty-title">No CodeRabbit findings</p>
        <p>This pull request was read in full and holds no CodeRabbit review thread.</p>
      </div>
    )
  }

  return (
    <div class="empty">
      <p class="empty-title">Nothing left to do</p>
      <p>
        No CodeRabbit finding on this page is still open. Anything resolved but unreadable is
        counted below rather than claimed as read.
      </p>
    </div>
  )
}

function headline(open: number): string {
  return open === 1 ? '1 finding to go' : `${open} findings to go`
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * A thread with no id is never hidden but is still listed, and there can be
 * more than one, so the index keeps preact from reusing a row. Falling back to
 * the file alone would collide on two unreadable threads in one file.
 */
function rowKey(row: TriageRow): string {
  return row.thread.id || `${row.thread.file ?? '?'}#${row.thread.problems.join(',')}`
}
