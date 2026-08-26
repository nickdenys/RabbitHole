import { render } from 'preact'
import type { TriageState } from '../engine'
import { App } from './App'
import styles from './panel.css?inline'

const HOST_ID = 'rabbithole-root'

let shadowRoot: ShadowRoot | null = null

/**
 * The drawer lives in a shadow root on a host appended to <body>, outside
 * React's tree, so neither GitHub's styles nor its rerenders can touch it.
 *
 * Every pass publishes state, so this runs often and has to be cheap and
 * idempotent. It is: preact diffs, and the host is only rebuilt when Turbo has
 * taken the old one away with the body.
 */
export function updatePanel(state: TriageState): void {
  if (state.kind === 'not-pr') {
    unmountPanel()
    return
  }
  render(<App state={state} />, ensureShadowRoot())
}

function ensureShadowRoot(): ShadowRoot {
  const existingHost = document.getElementById(HOST_ID)
  if (shadowRoot && existingHost) return shadowRoot

  existingHost?.remove()
  const host = document.createElement('div')
  host.id = HOST_ID
  document.body.append(host)

  shadowRoot = host.attachShadow({ mode: 'open' })
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(styles)
  shadowRoot.adoptedStyleSheets = [sheet]
  return shadowRoot
}

/**
 * Take the host off the page, on demand rather than only as a side effect of
 * a `not-pr` state.
 *
 * `updatePanel` reaches this when a pass publishes `not-pr`, which needs a
 * running engine to say so. `bootstrap.ts` calls it directly when it stops the
 * engine altogether, because a stopped engine publishes nothing further for
 * `updatePanel` to react to.
 */
export function unmountPanel(): void {
  const host = document.getElementById(HOST_ID)
  if (host && shadowRoot) render(null, shadowRoot)
  host?.remove()
  shadowRoot = null
}
