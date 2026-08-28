import { render } from 'preact'
import type { TriageState } from '../engine'
import { App } from './App'
import styles from './panel.css?inline'
import { hasCodeRabbit } from './rows'

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
  if (state.kind === 'not-pr' || isQuiet(state)) {
    unmountPanel()
    return
  }
  render(<App state={state} />, ensureShadowRoot())
}

/**
 * A pull request with nothing of CodeRabbit's on it, which gets no panel at
 * all. Invariant 4, and the only other reason the host comes off the page.
 *
 * **Readability first, always.** A build the detector does not know publishes
 * no notes and no rows, so `hasCodeRabbit` would answer false for it and the
 * unmount would delete the one handle whose whole job is to say the page could
 * not be read. That is invariant 3's failure exactly, so the order of these two
 * tests is the rule rather than a style choice.
 *
 * The host is never created rather than created and removed, which matters
 * beyond tidiness: `isOurs` in `engine.ts` deliberately treats a removal of our
 * own elements as GitHub acting on us, so removing a host would schedule a pass
 * per removal. A page CodeRabbit never touched now costs the DOM nothing.
 */
function isQuiet(state: TriageState): boolean {
  return state.kind === 'classic' && !hasCodeRabbit(state)
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
 * `updatePanel` reaches this when a pass publishes `not-pr`, and when a
 * readable page holds nothing of CodeRabbit's, both of which need a running
 * engine to say so. `bootstrap.ts` calls it directly when it stops the engine
 * altogether, because a stopped engine publishes nothing further for
 * `updatePanel` to react to.
 */
export function unmountPanel(): void {
  const host = document.getElementById(HOST_ID)
  if (host && shadowRoot) render(null, shadowRoot)
  host?.remove()
  shadowRoot = null
}
