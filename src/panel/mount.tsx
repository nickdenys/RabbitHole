import { render } from 'preact'
import type { PageKind } from '../types'
import { App } from './App'
import styles from './panel.css?inline'

const HOST_ID = 'coderabbit-triage-root'

let shadowRoot: ShadowRoot | null = null

/**
 * The drawer lives in a shadow root on a host appended to <body>, outside
 * React's tree, so neither GitHub's styles nor its rerenders can touch it.
 */
export function updatePanel(kind: PageKind): void {
  if (kind === 'not-pr') {
    unmountPanel()
    return
  }
  render(<App kind={kind} />, ensureShadowRoot())
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

function unmountPanel(): void {
  const host = document.getElementById(HOST_ID)
  if (host && shadowRoot) render(null, shadowRoot)
  host?.remove()
  shadowRoot = null
}
