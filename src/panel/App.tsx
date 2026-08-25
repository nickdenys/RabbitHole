import { useState } from 'preact/hooks'
import type { TriageRow, TriageState } from '../engine'
import type { Severity } from '../types'
import { Drawer } from './Drawer'
import { Mark } from './Mark'
import { Tips, useTip } from './overlay'
import { listedRows } from './rows'
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
 * it open, and the fetch for the resolved threads starts with the page.
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

  function show(next: boolean): void {
    setOpen(next)
    state.setPrefs({ drawerOpen: next })
  }

  function choose(next: Theme): void {
    setTheme(next)
    state.setPrefs({ theme: next })
  }

  const readable = state.kind === 'classic'
  const listed = readable ? listedRows(state) : []
  const todo = listed.filter((row) => !row.thread.resolved)
  const missing = readable ? state.check.missing : 0
  const warn = !readable || state.counts.unparsed > 0 || missing > 0

  return (
    <div class={open ? `panel theme-${theme} open` : `panel theme-${theme}`}>
      <Tips.Provider value={tipFor}>
        {open ? (
          <button
            class="handle collapsed"
            type="button"
            onClick={() => show(false)}
            title="Collapse the CodeRabbit Triage drawer"
            aria-expanded
          >
            <span aria-hidden="true">▶</span>
          </button>
        ) : (
          <button
            class={warn ? 'handle warn' : 'handle'}
            type="button"
            onClick={() => show(true)}
            title={handleTitle(readable, todo.length, state.counts.unparsed, missing)}
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
                  breakdown(todo).map(([severity, n]) => (
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

            <span class="handle-stack">
              <Mark />
              <span class="handle-count">{readable ? todo.length : '—'}</span>
              {warn && (
                <span class="handle-warn" aria-hidden="true">
                  ⚠
                </span>
              )}
              <span class="meter" aria-hidden="true">
                {readable &&
                  breakdown(todo).map(([severity, n]) => (
                    <span class={`meter-part ${severity}`} style={{ flexGrow: n }} key={severity} />
                  ))}
              </span>
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
function handleTitle(readable: boolean, todo: number, unparsed: number, missing: number): string {
  if (!readable) return "CodeRabbit Triage: this GitHub build isn't supported yet. Nothing is hidden."

  const parts = [`${todo} to go`]
  if (missing > 0) parts.push(`${missing} not in the page`)
  if (unparsed > 0) parts.push(`${unparsed} unreadable`)

  return `CodeRabbit Triage: ${parts.join(', ')}`
}
