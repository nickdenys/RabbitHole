import type { TriageState } from '../engine'

interface AppProps {
  state: TriageState
}

export function App({ state }: AppProps) {
  if (state.kind === 'react' || state.kind === 'unknown') {
    return (
      <div class="handle warn" title="CodeRabbit Triage: this GitHub build isn't supported yet. Nothing is hidden.">
        CR ⚠
      </div>
    )
  }

  // TODO(A9): the drawer. The handle takes its count from the state now, so
  // what is missing is the list, not the wiring.
  return (
    <div class="handle" title={`CodeRabbit Triage: ${state.counts.unresolved} unresolved`}>
      CR {state.counts.unresolved}
    </div>
  )
}
