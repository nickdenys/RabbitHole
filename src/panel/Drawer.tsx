import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { TriageRow, TriageState } from '../engine'
import { Mark } from './Mark'
import { Tips, useDismiss } from './overlay'
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
  const [alertOpen, setAlertOpen] = useState(false)

  const sortButton = useRef<HTMLButtonElement | null>(null)
  const sortMenu = useRef<HTMLDivElement | null>(null)
  useDismiss(sortOpen, () => setSortOpen(false), sortMenu, sortButton)

  const warnButton = useRef<HTMLButtonElement | null>(null)
  const alertCard = useRef<HTMLDivElement | null>(null)
  const alertOk = useRef<HTMLButtonElement | null>(null)
  useDismiss(alertOpen, dismissAlert, alertCard, warnButton)

  // Focus moves into the dialog as it opens, so the keyboard is not left on a
  // triangle that is now behind a scrim. Layout rather than plain, so the move
  // happens in the same frame the scrim is painted in.
  useLayoutEffect(() => {
    if (alertOpen) alertOk.current?.focus()
  }, [alertOpen])

  const tipFor = useContext(Tips)

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

  /**
   * Closing the alert, from the triangle, either of the dialog's own buttons,
   * Escape, or a press outside it.
   *
   * Focus goes back to the triangle only while the dialog is holding it, so
   * Escape and "Got it" return the keyboard to the control that opened the
   * dialog and a press on the page behind leaves that press's own target
   * alone. `activeElement` is read off the card's own root rather than off
   * `document`, which retargets everything inside the shadow root to the host
   * and would make every close look like the dialog had focus.
   */
  function dismissAlert(): void {
    const card = alertCard.current
    const root = card?.getRootNode() as (Node & DocumentOrShadowRoot) | undefined
    const active = root?.activeElement ?? null

    setAlertOpen(false)
    if (card !== null && active !== null && card.contains(active)) warnButton.current?.focus()
  }

  const empty = emptyState(state, listed)
  const unsupported = empty === 'unsupported'

  /**
   * The two halves of the worklist, and the shown half cut into its groups.
   *
   * Memoised because this drawer redraws far more often than the page changes.
   * The panel's one tooltip is held by `App` above it, so hovering any control
   * on any row rerenders the whole panel, and copying and sorting the whole
   * worklist on mouse-over is the one derivation here expensive enough to
   * notice: on three of the four axes every comparison of that sort goes
   * through the collator. See `useTip` in `overlay.ts`.
   *
   * `listed` arrives already memoised on the published state, so its identity
   * only moves when a pass has actually read a new page, and the two counts
   * the tabs carry stay stable with it. The axis, the direction and the tab are
   * the reader's own choices, and each of them genuinely is a new order.
   */
  const openRows = useMemo(() => listed.filter((row) => !row.thread.resolved), [listed])
  const doneRows = useMemo(() => listed.filter((row) => row.thread.resolved), [listed])
  const shown = tab === 'open' ? openRows : doneRows
  const groups = useMemo(() => groupRows(sortRows(shown, axis, leading), axis), [shown, axis, leading])

  const unread = unreadCount(state)
  const warnings = warningsOf(state)

  // The whole-page states outrank the tab, and only the Open tab draws the two
  // that are claims about the worklist: "nothing left to do" under a Resolved
  // tab full of rows would be describing the list beside it.
  const wholePage = unsupported || tab === 'open' ? empty : null

  return (
    <aside class="drawer" aria-label="RabbitHole">
      <header class="drawer-head">
        <Mark />
        <h1 class="drawer-title">RabbitHole</h1>

        {/* Two signals in one slot, and no slot at all when neither is
            showing. Both are caveats about the list rather than parts of it:
            a row above the worklist would spend a line of every session on a
            sentence most sessions never need, and a warning nobody needs is a
            warning nobody reads. */}
        {(warnings.length > 0 || unread > 0) && (
          <div class="signals">
            {warnings.length > 0 && (
              <button
                class={alertOpen ? 'icon warn on' : 'icon warn'}
                type="button"
                ref={warnButton}
                aria-haspopup="dialog"
                aria-expanded={alertOpen}
                aria-label="Something needs your attention"
                {...tipFor('Something needs your attention')}
                onClick={() => (alertOpen ? dismissAlert() : setAlertOpen(true))}
              >
                <span aria-hidden="true">⚠</span>
              </button>
            )}

            {/* Not a button: there is nothing to do about a fetch in flight,
                so it takes no tab stop and says its sentence to a pointer
                through the tooltip and to a reader through its role. */}
            {unread > 0 && (
              <span
                class="signal-loader"
                role="status"
                aria-label={readingLabel(unread)}
                {...tipFor(readingLabel(unread))}
              >
                <span class="spinner" aria-hidden="true" />
              </span>
            )}
          </div>
        )}

        <span class="head-gap" />
        <button class="icon close" type="button" onClick={onClose} aria-label="Close RabbitHole">
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
            <span class="head-gap" />
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

      {/* Last inside the drawer, and scoped to it, because what it says is
          about this list. Deliberate open and deliberate close: the reader
          asked for the sentence, so it is worth blocking the panel until they
          have read it. */}
      {alertOpen && (
        <div class="scrim">
          <div
            class="alert"
            role="dialog"
            aria-modal="true"
            aria-labelledby="alert-title"
            ref={alertCard}
          >
            <header class="alert-head">
              <span class="alert-mark" aria-hidden="true">
                ⚠
              </span>
              <h2 class="alert-title" id="alert-title">
                {alertTitle(state)}
              </h2>
              <button class="icon" type="button" onClick={dismissAlert} aria-label="Close">
                <span aria-hidden="true">×</span>
              </button>
            </header>

            {warnings.map((text) => (
              <p class="alert-text" key={text}>
                {text}
              </p>
            ))}

            <footer class="alert-foot">
              <button class="alert-ok" type="button" ref={alertOk} onClick={dismissAlert}>
                Got it
              </button>
            </footer>
          </div>
        </div>
      )}
    </aside>
  )
}

/**
 * What the header's triangle has to say, worst first.
 *
 * The shortfall gets two remedies, because there are two ways to be short.
 * GitHub still holding threads back is the reader's to fix and the button is
 * where; a page with no control left is CodeRabbit counting a finding it never
 * posted, which no clicking will ever close. Saying the first to a reader in
 * the second case sends them hunting for a button that is not on the page.
 *
 * Empty is the ordinary case, and an empty list is what keeps the triangle off
 * the header entirely.
 */
function warningsOf(state: TriageState): string[] {
  const said: string[] = []

  if (state.check.missing > 0) {
    const remedy = state.check.more
      ? 'On a long conversation, GitHub hides the rest behind its own "Load more…" button rather than loading it as you scroll, click that before trusting this list.'
      : "Nothing is left to load, so the gap is in CodeRabbit's own total: it counts findings that never became threads here."

    said.push(
      `Only ${state.check.found} of the ${state.check.claimed} findings CodeRabbit posted are in the page. ${remedy}`,
    )
  }

  if (state.counts.unparsed > 0) {
    const they = state.counts.unparsed === 1 ? 'it is' : 'they are'
    said.push(
      `${count(state.counts.unparsed, 'thread')} could not be read, so ${they} still in the timeline.`,
    )
  }

  return said
}

/**
 * The dialog's heading, which names the stronger of the two claims when both
 * are being made. A shortfall is findings the drawer never got to list; an
 * unreadable thread is listed, badged and still in the timeline, so calling
 * that one "missing" would be the drawer accusing itself of the wrong fault.
 */
function alertTitle(state: TriageState): string {
  return state.check.missing > 0 ? 'Findings may be missing' : 'Some threads could not be read'
}

/**
 * The spinner's sentence. It keeps the number, because "still working" without
 * one says nothing about whether the list is nearly right or barely started.
 */
function readingLabel(unread: number): string {
  return `Finding all issues on the page… ${count(unread, 'resolved thread')} still to read.`
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
        <p>
          CodeRabbit reviewed this pull request in full and posted nothing to work down. A pull
          request it never reviewed has no drawer at all.
        </p>
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
