import type { PageKind } from '../types'

interface AppProps {
  kind: PageKind
}

export function App({ kind }: AppProps) {
  if (kind === 'react' || kind === 'unknown') {
    return (
      <div class="handle warn" title="CodeRabbit Triage: this GitHub build isn't supported yet. Nothing is hidden.">
        CR ⚠
      </div>
    )
  }

  // TODO(v0.1): drawer with the unresolved worklist. For now the handle only
  // proves the shadow DOM mount works on a classic-build PR page.
  return (
    <div class="handle" title="CodeRabbit Triage (scaffold)">
      CR
    </div>
  )
}
