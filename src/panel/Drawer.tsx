import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { TriageRow, TriageState } from '../engine'
import { useDismiss } from './overlay'
import { Row } from './Row'
import { emptyState, unreadCount, type EmptyState } from './rows'
import { Settings } from './Settings'
import {
  groupRows,
  SORT_DIRECTIONS,
  SORT_HINTS,
  SORT_LABELS,
  sortRows,
  type SortAxis,
} from './sort'
import type { Theme } from './theme'

interface DrawerProps {
  state: TriageState
  /** Computed once by `App`, which needs the same list for the handle's count. */
  listed: TriageRow[]
  /**
   * Held by `App`, because the palette is a property of the whole panel and the
   * handle is themed even when this drawer does not exist. The settings sheet
   * lives here, so the control is here and the state it changes is not.
   */
  theme: Theme
  onTheme: (theme: Theme) => void
  onClose: () => void
}

/** Which half of the worklist the drawer is showing. */
type Tab = 'open' | 'resolved'

/**
 * The worklist. Fixed to the right edge, inside the panel's shadow root, so
 * neither GitHub's stylesheet nor its rerenders reach it.
 */
export function Drawer({ state, listed, theme, onTheme, onClose }: DrawerProps) {
  // Held here rather than in `App` so it lives exactly as long as the open
  // drawer does. A pass runs on every mutation and hands down a new `listed`,
  // and preact keeps this across those renders, so a churning page does not
  // reshuffle the list under the reader.
  //
  // The remembered axis and direction are initial values and never controlled
  // ones: the engine's copy of the prefs changes on every save, and reading it
  // on each render would put the drawer back to the stored axis the moment
  // another preference was written.
  const [axis, setAxis] = useState<SortAxis>(state.prefs.sortAxis)
  const [leading, setLeading] = useState<boolean>(state.prefs.sortLeading)
  const [tab, setTab] = useState<Tab>('open')
  const [sortOpen, setSortOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [menuKey, setMenuKey] = useState<string | null>(null)
  // Only the folded ones are held, so a group that appears later opens by
  // default rather than inheriting a fold nobody asked for.
  const [folded, setFolded] = useState<Record<string, true>>({})

  const sortButton = useRef<HTMLButtonElement | null>(null)
  const sortMenu = useRef<HTMLDivElement | null>(null)
  useDismiss(sortOpen, () => setSortOpen(false), sortMenu, sortButton)

  function chooseAxis(next: SortAxis): void {
    setAxis(next)
    setSortOpen(false)
    state.setPrefs({ sortAxis: next })
  }

  function flipDirection(): void {
    const next = !leading
    setLeading(next)
    state.setPrefs({ sortLeading: next })
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
  const unsupported = empty === 'unsupported'
  const openRows = listed.filter((row) => !row.thread.resolved)
  const doneRows = listed.filter((row) => row.thread.resolved)
  const shown = tab === 'open' ? openRows : doneRows
  const unread = unreadCount(state)
  const groups = groupRows(sortRows(shown, axis, leading), axis)

  // The whole-page states outrank the tab, and only the Open tab draws the two
  // that are claims about the worklist: "nothing left to do" under a Resolved
  // tab full of rows would be describing the list beside it.
  const wholePage = unsupported || tab === 'open' ? empty : null

  return (
    <aside class="drawer" aria-label="CodeRabbit Triage">
      <header class="drawer-head">
        <span class="mark" aria-hidden="true">
          CR
        </span>
        <h1 class="drawer-title">CodeRabbit Triage</h1>
        <button class="icon close" type="button" onClick={onClose} aria-label="Close CodeRabbit Triage">
          <span aria-hidden="true">×</span>
        </button>
      </header>

      {!unsupported && (
        <div class="drawer-tools">
          <div class="tabs" role="tablist" aria-label="Findings">
            <Tabs tab={tab} open={openRows.length} done={doneRows.length} onChange={setTab} />
          </div>

          <div class="sort">
            <button
              class={sortOpen ? 'sort-button on' : 'sort-button'}
              type="button"
              ref={sortButton}
              aria-haspopup="menu"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen(!sortOpen)}
            >
              Sort: {SORT_LABELS[axis]}
              <span class="caret" aria-hidden="true">
                ▼
              </span>
            </button>

            {sortOpen && (
              <div class="sort-menu" role="menu" ref={sortMenu}>
                <p class="sort-menu-head">Sort findings by</p>
                <div class="sort-menu-body">
                  {(Object.keys(SORT_LABELS) as SortAxis[]).map((option) => (
                    <button
                      class={option === axis ? 'sort-option on' : 'sort-option'}
                      type="button"
                      role="menuitemradio"
                      aria-checked={option === axis}
                      key={option}
                      onClick={() => chooseAxis(option)}
                    >
                      <span class="sort-check" aria-hidden="true">
                        {option === axis ? '✓' : ''}
                      </span>
                      <span class="sort-option-label">{SORT_LABELS[option]}</span>
                      <span class="sort-option-hint">{SORT_HINTS[option]}</span>
                    </button>
                  ))}
                </div>
                <div class="sort-menu-foot">
                  <button class="sort-direction" type="button" role="menuitem" onClick={flipDirection}>
                    <span class="sort-check" aria-hidden="true">
                      {leading ? '↓' : '↑'}
                    </span>
                    <span class="sort-option-label">{SORT_DIRECTIONS[axis][leading ? 0 : 1]}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {state.check.missing > 0 && (
        <p class="notice warn">
          Only {state.check.found} of the {state.check.claimed} findings CodeRabbit posted have
          loaded. On a long conversation, GitHub hides the rest behind its own "Load more…" button
          rather than loading it as you scroll, click that before trusting this list.
        </p>
      )}

      {state.counts.unparsed > 0 && (
        <p class="notice warn">
          {count(state.counts.unparsed, 'thread')} could not be read, so{' '}
          {state.counts.unparsed === 1 ? 'it is' : 'they are'} still in the timeline.
        </p>
      )}

      {/* The menu is positioned against the viewport, so a list that scrolls
          under it would leave it hanging over the wrong row. */}
      <div class="list" onScroll={() => setMenuKey(null)}>
        {wholePage !== null && <Empty kind={wholePage} />}

        {wholePage === null && shown.length === 0 && (
          <p class="empty-note">
            {tab === 'open'
              ? 'Nothing open under this tab.'
              : 'Nothing resolved on this page yet.'}
          </p>
        )}

        {groups.map((group) => {
          const label = group.label
          const shut = label !== null && folded[label] === true

          return (
            <section class="group" key={label ?? 'all'}>
              {label !== null && (
                <h2 class="group-head">
                  <button
                    class="group-toggle"
                    type="button"
                    aria-expanded={!shut}
                    onClick={() => fold(setFolded, label)}
                  >
                    <span class="chevron" aria-hidden="true">
                      {shut ? '▶' : '▼'}
                    </span>
                    {group.severity !== null && (
                      <span class={`dot ${group.severity}`} aria-hidden="true" />
                    )}
                    <span class="group-label">{label}</span>
                    <span class="group-count">{group.rows.length}</span>
                  </button>
                </h2>
              )}
              {!shut && (
                <ul class="rows">
                  {group.rows.map((row) => {
                    const key = rowKey(row)
                    return (
                      <Row
                        row={row}
                        key={key}
                        showSeverity={axis !== 'severity'}
                        menuOpen={menuKey === key}
                        onMenu={(open) => setMenuKey(open ? key : null)}
                      />
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}

        {!unsupported && unread > 0 && (
          <p class="notice reading">
            Reading {count(unread, 'resolved thread')} from GitHub. GitHub does not render a
            resolved thread's comments, so each one is fetched and listed as it arrives.
          </p>
        )}
      </div>

      {/* Not on a build the extension could not read, where nothing was hidden
          in either mode and the footer would claim progress over a page it did
          not touch. */}
      {!unsupported && (
        <footer class="drawer-foot">
          <span class="progress-label">{progressLabel(doneRows.length, listed.length)}</span>
          <span
            class="progress"
            role="progressbar"
            aria-valuenow={doneRows.length}
            aria-valuemin={0}
            aria-valuemax={listed.length}
          >
            <span class="progress-bar" style={{ width: percent(doneRows.length, listed.length) }} />
          </span>
          <button
            class="icon gear"
            type="button"
            aria-label="Settings"
            aria-expanded={settingsOpen}
            onClick={() => {
              setSortOpen(false)
              setMenuKey(null)
              setSettingsOpen(true)
            }}
          >
            <span aria-hidden="true">⚙</span>
          </button>
        </footer>
      )}

      {/* Rendered whether or not it is showing, so it slides rather than
          appears, and inert while it is off screen so nothing behind the panel
          can be tabbed into. */}
      {!unsupported && (
        <div class={settingsOpen ? 'sheet open' : 'sheet'} inert={!settingsOpen}>
          <header class="drawer-head">
            <button
              class="icon back"
              type="button"
              onClick={() => setSettingsOpen(false)}
              aria-label="Back to the worklist"
            >
              <span aria-hidden="true">←</span>
            </button>
            <h2 class="drawer-title">Settings</h2>
            <button
              class="icon close"
              type="button"
              onClick={() => setSettingsOpen(false)}
              aria-label="Close settings"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div class="sheet-body">
            <Settings
              mode={state.prefs.hideMode}
              onMode={(mode) => state.setPrefs({ hideMode: mode })}
              theme={theme}
              onTheme={onTheme}
              autoLoadMore={state.prefs.autoLoadMore}
              onAutoLoadMore={(autoLoadMore) => state.setPrefs({ autoLoadMore })}
            />
          </div>
        </div>
      )}
    </aside>
  )
}

/**
 * The two halves of the worklist, each carrying its own count.
 *
 * A resolved finding leaves the Open tab only once GitHub says it is resolved,
 * which is the same rule the strikethrough follows: a click moves nothing.
 */
function Tabs({
  tab,
  open,
  done,
  onChange,
}: {
  tab: Tab
  open: number
  done: number
  onChange: (tab: Tab) => void
}) {
  const each: [Tab, string, number][] = [
    ['open', 'Open', open],
    ['resolved', 'Resolved', done],
  ]

  return (
    <>
      {each.map(([key, label, n]) => (
        <button
          class={tab === key ? `tab ${key} on` : `tab ${key}`}
          type="button"
          role="tab"
          aria-selected={tab === key}
          key={key}
          onClick={() => onChange(key)}
        >
          {label} <span class="tab-count">{n}</span>
        </button>
      ))}
    </>
  )
}

/** Fold a group shut, or open it again. */
function fold(
  set: (update: (folded: Record<string, true>) => Record<string, true>) => void,
  label: string,
): void {
  set((current) => {
    if (current[label] === true) {
      const { [label]: _shut, ...rest } = current
      return rest
    }
    return { ...current, [label]: true }
  })
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

/** The footer's own sentence, which says nothing rather than "0 of 0". */
function progressLabel(done: number, total: number): string {
  return total === 0 ? 'Nothing to work through' : `${done} of ${total} resolved`
}

function percent(done: number, total: number): string {
  return total === 0 ? '0%' : `${Math.round((done / total) * 100)}%`
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * A thread with no id is never hidden but is still listed, and there can be
 * more than one, so the problems keep preact from reusing a row. Falling back
 * to the file alone would collide on two unreadable threads in one file.
 */
function rowKey(row: TriageRow): string {
  return row.thread.id || `${row.thread.file ?? '?'}#${row.thread.problems.join(',')}`
}
