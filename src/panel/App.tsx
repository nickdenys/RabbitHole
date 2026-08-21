import { useState } from 'preact/hooks'
import type { TriageState } from '../engine'
import { Drawer } from './Drawer'
import { listedRows } from './rows'

interface AppProps {
  state: TriageState
}

/**
 * The handle, always, and the drawer when it is open.
 *
 * Open state lives here rather than in the engine: a pass runs on every
 * mutation and publishes a new state object, and preact keeps this component's
 * state across those renders, so a page that churns does not close the drawer.
 */
export function App({ state }: AppProps) {
  const [open, setOpen] = useState(false)

  const readable = state.kind === 'classic'
  const listed = readable ? listedRows(state) : []
  const todo = listed.filter((row) => !row.thread.resolved).length
  const missing = readable ? state.check.missing : 0
  const warn = !readable || state.counts.unparsed > 0 || missing > 0

  return (
    <div class={open ? 'panel open' : 'panel'}>
      <button
        class={warn ? 'handle warn' : 'handle'}
        type="button"
        onClick={() => setOpen(!open)}
        title={handleTitle(readable, todo, state.counts.unparsed, missing)}
        aria-expanded={open}
      >
        {readable ? `CR ${todo}` : 'CR ⚠'}
        {warn && readable ? ' ⚠' : ''}
      </button>

      {open && <Drawer state={state} listed={listed} onClose={() => setOpen(false)} />}
    </div>
  )
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
