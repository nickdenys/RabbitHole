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
  const warn = !readable || state.counts.unparsed > 0

  return (
    <div class={open ? 'panel open' : 'panel'}>
      <button
        class={warn ? 'handle warn' : 'handle'}
        type="button"
        onClick={() => setOpen(!open)}
        title={handleTitle(readable, todo, state.counts.unparsed)}
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
 */
function handleTitle(readable: boolean, todo: number, unparsed: number): string {
  if (!readable) return "CodeRabbit Triage: this GitHub build isn't supported yet. Nothing is hidden."

  const base = `CodeRabbit Triage: ${todo} to go`
  return unparsed > 0 ? `${base}, ${unparsed} unreadable` : base
}
