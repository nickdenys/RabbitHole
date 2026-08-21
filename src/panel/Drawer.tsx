import { useLayoutEffect, useState } from 'preact/hooks'
import type { TriageRow, TriageState } from '../engine'
import { Row } from './Row'
import { emptyState, unreadCount, type EmptyState } from './rows'
import { Settings } from './Settings'
import { groupRows, SORT_LABELS, sortRows, type SortAxis } from './sort'

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
  //
  // The remembered axis is the initial value and never a controlled one: the
  // engine's copy of the prefs changes on every save, and reading it on each
  // render would put the drawer back to the stored axis the moment another
  // preference was written.
  const [axis, setAxis] = useState<SortAxis>(state.prefs.sortAxis)

  function chooseAxis(next: SortAxis): void {
    setAxis(next)
    state.setPrefs({ sortAxis: next })
  }

  // "Lazy, on panel open" in one line: this component exists only while the
  // drawer is open, so mounting it is the open and unmounting it is the close,
  // and a reader who never opens the drawer never asks GitHub for anything.
  //
  // Every render rather than only the first, because the request set grows: a
  // thread resolved here collapses, and the pass that notices hands down a new
  // state whose render picks it up. The engine skips anything already answered
  // or in flight, so the repeat costs a walk over the thread list.
  //
  // Layout rather than plain, for the same reason as `Row`'s: preact defers
  // `useEffect` behind a frame, and there is no reason for the first request to
  // wait on paint. It publishes nothing synchronously, so no render is nested
  // inside this one.
  useLayoutEffect(() => state.readResolved())

  const empty = emptyState(state, listed)
  const open = listed.filter((row) => !row.thread.resolved).length
  const unread = unreadCount(state)
  const groups = groupRows(sortRows(listed, axis), axis)

  return (
    <aside class="drawer" aria-label="CodeRabbit Triage">
      <header class="drawer-head">
        <h1 class="drawer-title">{empty === 'unsupported' ? 'CodeRabbit Triage' : headline(open)}</h1>
        <button class="close" type="button" onClick={onClose} aria-label="Close CodeRabbit Triage">
          ×
        </button>
      </header>

      {state.check.missing > 0 && (
        <p class="notice warn">
          CodeRabbit posted {state.check.claimed} findings and {state.check.found} are in this page.
          GitHub renders a long conversation in pieces, so load the rest of it before trusting this
          list.
        </p>
      )}

      {state.counts.unparsed > 0 && (
        <p class="notice warn">
          {count(state.counts.unparsed, 'thread')} could not be read, so {state.counts.unparsed === 1 ? 'it is' : 'they are'} still in the timeline.
        </p>
      )}

      {empty !== null && <Empty kind={empty} />}

      {listed.length > 0 && <SortPicker axis={axis} onChange={chooseAxis} />}

      {groups.map((group) => (
        <section class="group" key={group.label ?? 'all'}>
          {group.label !== null && <h2 class="group-head">{group.label}</h2>}
          <ul class="rows">
            {group.rows.map((row) => (
              <Row row={row} key={rowKey(row)} />
            ))}
          </ul>
        </section>
      ))}

      {empty !== 'unsupported' && unread > 0 && (
        <p class="notice">
          Reading {count(unread, 'resolved thread')} from GitHub. GitHub does not render a resolved
          thread's comments, so each one is fetched and listed as it arrives.
        </p>
      )}

      {/* Not on a build the extension could not read, where nothing was hidden
          in either mode and the control would claim otherwise. */}
      {empty !== 'unsupported' && (
        <Settings
          mode={state.prefs.hideMode}
          onChange={(mode) => state.setPrefs({ hideMode: mode })}
        />
      )}
    </aside>
  )
}

/**
 * The axis picker. A select rather than a row of buttons because B6 brought the
 * control to five axes, and five toggles do not fit a 380px drawer.
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
