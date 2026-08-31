import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { TriageRow, TriageState } from '../engine'
import type { Severity } from '../types'
import { Drawer } from './Drawer'
import { Mark } from './Mark'
import { tipFitsAbove, Tips, useTip } from './overlay'
import { listedRows, unreadCount } from './rows'
import type { Theme } from './theme'

interface AppProps {
  state: TriageState
}

/**
 * CodeRabbit's severities, worst first, which is the order the meter stacks
 * them in and the order the breakdown reads them out.
 */
const SEVERITIES: readonly Severity[] = ['critical', 'major', 'minor', 'trivial']

/**
 * The handle, always, and the drawer when it is open.
 *
 * Open state lives here rather than in the engine: a pass runs on every
 * mutation and publishes a new state object, and preact keeps this component's
 * state across those renders, so a page that churns does not close the drawer.
 *
 * The remembered value seeds it and is written back on every toggle, so a
 * reader who works with the drawer open arrives at the next pull request with
 * it open. It no longer decides anything about the fetch: that starts with the
 * page whether the drawer is open or not.
 *
 * The theme is held the same way and for a sharper reason: a theme change runs
 * no pass, so the engine's copy of the prefs is never republished for it, and a
 * panel that read `state.prefs.theme` on each render would stay in the old
 * palette until something else redrew it. Seeded from the remembered value,
 * written back on every pick, and the class it puts on the root is the whole of
 * how the panel is themed. See `theme.ts`.
 *
 * The tooltip is held here for a reason of painting order rather than of state:
 * it belongs beside the drawer and the tab, not inside either, or the tab hides
 * it. See `Tips` in `overlay.ts`.
 */
export function App({ state }: AppProps) {
  const [open, setOpen] = useState(state.prefs.drawerOpen)
  const [theme, setTheme] = useState<Theme>(state.prefs.theme)
  const [tip, tipFor] = useTip()
  const tipEl = useRef<HTMLSpanElement | null>(null)

  /**
   * Which side of its control the tooltip ends up on, decided after it is
   * drawn because deciding needs its height and its height is however many
   * lines the sentence wrapped to.
   *
   * Written onto the element rather than held as state, so the tooltip is
   * never painted on the wrong side for a frame on its way to the right one.
   * Nothing is fighting for these two properties: preact owns this element's
   * text and its `left`, and only this effect ever touches its `top` and the
   * one class.
   *
   * Layout rather than plain, so the move lands in the same frame the tooltip
   * first appears in.
   */
  useLayoutEffect(() => {
    const el = tipEl.current
    if (el === null || tip === null) return

    const above = tipFitsAbove(tip.anchor, el.getBoundingClientRect().height)
    el.classList.toggle('below', !above)
    el.style.top = `${above ? tip.anchor.top : tip.anchor.bottom}px`
  })

  function show(next: boolean): void {
    setOpen(next)
    state.setPrefs({ drawerOpen: next })
  }

  function choose(next: Theme): void {
    setTheme(next)
    state.setPrefs({ theme: next })
  }

  const readable = state.kind === 'classic'

  /**
   * The worklist, and the open half of it.
   *
   * Memoised on the state object, which is a new one on every pass and never
   * mutated in place, so the identity is exactly the "has the page changed"
   * question these two answer to. The saving is not about passes: it is about
   * the renders that are not passes. This component holds the tooltip, so
   * every hover on any control in any row redraws it, and without this a
   * pointer crossing a long worklist rebuilt the list and re-derived the whole
   * drawer under it on each control it passed. See `useTip` in `overlay.ts`.
   *
   * `listed` is handed to the drawer as well, so this keeps its identity
   * stable across those hovers and the drawer's own memos hold with it.
   */
  const listed = useMemo(() => (readable ? listedRows(state) : []), [state])
  const todo = useMemo(() => listed.filter((row) => !row.thread.resolved), [listed])
  // Only the shortfall the reader can act on. A page GitHub has half rendered
  // is a list not to be trusted and the handle says so; a total CodeRabbit
  // counted higher than it posted is a list holding every finding there is,
  // and marking that handle teaches the triangle to mean nothing. The drawer's
  // own notice still names both numbers either way, see `Drawer.tsx`.
  const missing = readable && state.check.more ? state.check.missing : 0

  // The drawer's spinner, on the resting tab. It matters more here than it did
  // there now that the fetch starts with the page rather than with the drawer:
  // the window it covers is the one before the reader has opened anything, and
  // the tab is the only thing on screen during it.
  const reading = readable ? unreadCount(state) : 0

  /**
   * Whether the panel is still filling, from either of the two things that
   * fill it: the deferred fetch, and the auto "Load more" clicking its way
   * through a timeline GitHub renders in chunks.
   *
   * The second is the one that made the triangle flicker. A long pull request
   * opens claiming 102 findings and holding 13, so the shortfall is real, large
   * and about to close itself, and marking the handle for it is a warning that
   * appears on every long page and then takes itself back. A caveat that
   * resolves on its own was never a caveat.
   */
  const loading =
    reading > 0 || (readable && state.prefs.autoLoadMore && state.check.more && state.check.missing > 0)

  // Nothing about the list while the list is still arriving, on the triangle or
  // in the title behind it: the two have to agree, or a hover during the load
  // contradicts the tab it is hovering. An unreadable build is not a loading
  // state and is said either way.
  const shortfall = loading ? 0 : missing
  const unreadable = loading ? 0 : state.counts.unparsed
  const warn = !readable || unreadable > 0 || shortfall > 0

  // The label and the meter draw the same tally twice, so it is counted once.
  // A pass publishes a new state on every mutation of the page, which is a
  // render, which was two walks of the worklist building two identical maps.
  const parts = useMemo(() => (readable ? breakdown(todo) : []), [todo])

  return (
    <div class={open ? `panel theme-${theme} open` : `panel theme-${theme}`}>
      <Tips.Provider value={tipFor}>
        {open ? (
          <button
            class="handle collapsed"
            type="button"
            onClick={() => show(false)}
            title="Collapse the RabbitHole drawer"
            aria-expanded
          >
            <span aria-hidden="true">▶</span>
          </button>
        ) : (
          <button
            class={warn ? 'handle warn' : 'handle'}
            type="button"
            onClick={() => show(true)}
            title={handleTitle(readable, todo.length, unreadable, shortfall, reading)}
            aria-expanded={false}
          >
            {/* The label the tab widens to show. It carries the sentence a first
                time reader needs, so the resting tab can be a mark, a number and
                a meter and nothing else. */}
            <span class="handle-label">
              <span class="handle-title">
                {readable ? headline(todo.length) : 'This page could not be read'}
              </span>
              <span class="handle-breakdown">
                {readable ? (
                  parts.map(([severity, n]) => (
                    <span class="handle-part" key={severity}>
                      <span class={`dot ${severity}`} aria-hidden="true" />
                      {n} {severity}
                    </span>
                  ))
                ) : (
                  <span class="handle-part">Nothing was hidden</span>
                )}
              </span>
            </span>

            <span class={reading > 0 ? 'handle-stack loading' : 'handle-stack'}>
              <Mark />
              <span class="handle-count">{readable ? todo.length : '—'}</span>
              {warn && (
                <span class="handle-warn" aria-hidden="true">
                  ⚠
                </span>
              )}
              <span class="meter" aria-hidden="true">
                {parts.map(([severity, n]) => (
                  <span class={`meter-part ${severity}`} style={{ flexGrow: n }} key={severity} />
                ))}
              </span>

              {/* Last, so it paints over the three above it, and hidden from
                  the accessibility tree because the button's own title already
                  carries the sentence. A second `role="status"` inside a
                  button would be a live region nobody asked for. */}
              {reading > 0 && (
                <span class="handle-loader" aria-hidden="true">
                  <span class="spinner" />
                </span>
              )}
            </span>
          </button>
        )}

        {open && (
          <Drawer
            state={state}
            listed={listed}
            theme={theme}
            onTheme={choose}
            onClose={() => show(false)}
          />
        )}

        {tip !== null && (
          <span
            class="tip"
            role="tooltip"
            ref={tipEl}
            style={{ left: `${tip.anchor.left}px`, top: `${tip.anchor.top}px` }}
          >
            {tip.text}
          </span>
        )}
      </Tips.Provider>
    </div>
  )
}

/**
 * The open findings by severity, worst first, with the empty severities left
 * out so the meter shows three blockers next to ten nitpicks rather than four
 * segments of which two are zero.
 *
 * A finding with no severity is counted under 'none', because leaving it out
 * would make the parts add up to less than the number above them.
 */
function breakdown(rows: TriageRow[]): [Severity | 'none', number][] {
  const counted = new Map<Severity | 'none', number>()

  for (const row of rows) {
    const severity = row.finding?.severity ?? 'none'
    counted.set(severity, (counted.get(severity) ?? 0) + 1)
  }

  const ordered: [Severity | 'none', number][] = []
  for (const severity of [...SEVERITIES, 'none' as const]) {
    const n = counted.get(severity)
    if (n !== undefined && n > 0) ordered.push([severity, n])
  }

  return ordered
}

function headline(todo: number): string {
  if (todo === 0) return 'Nothing left to do'
  return todo === 1 ? '1 open finding' : `${todo} open findings`
}

/**
 * The count is the listed worklist rather than `counts.unresolved`, which
 * includes human threads the drawer never lists. A handle that says 27 over a
 * list of 3 is a handle nobody trusts.
 *
 * The missing count is the reverse of that problem and the reason B5 exists: a
 * handle saying 3 over a page GitHub has only half rendered is also a handle
 * nobody should trust, and it is the small reassuring number that reads as good
 * news. It comes first in the title because it is the one that says the rest of
 * the title is incomplete.
 */
function handleTitle(
  readable: boolean,
  todo: number,
  unparsed: number,
  missing: number,
  reading: number,
): string {
  if (!readable) return "RabbitHole: this GitHub build isn't supported yet. Nothing is hidden."

  const parts = [`${todo} to go`]
  if (missing > 0) parts.push(`${missing} not in the page`)
  if (unparsed > 0) parts.push(`${unparsed} unreadable`)
  // Last, because it is the one that says the rest is still moving.
  if (reading > 0) parts.push(`${reading} still to read`)

  return `RabbitHole: ${parts.join(', ')}`
}
