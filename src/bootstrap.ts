import { onEnabledChanged, loadEnabled } from './enabled'
import { startEngine } from './engine'
import { unmountPanel, updatePanel } from './panel/mount'
import { loadPrefs } from './prefs'

/**
 * Start the engine while the extension is enabled, and fully stop it while it
 * is not, reacting live to the toolbar's checkbox in every open tab.
 *
 * Takes `doc` rather than reading the global, same reasoning as `engine.ts`:
 * this is the one piece of `content.ts` complex enough to be worth testing
 * against a document that is not `window.document`. Everything else in
 * `content.ts` stays the one line it was, which is what let it go untested
 * before this existed.
 *
 * **A full stop, not a paused pass.** `startEngine`'s teardown disconnects the
 * `MutationObserver` and the `turbo:load` listener, which is genuinely inert
 * rather than an engine that keeps watching and declining to act. `updatePanel`
 * only unmounts the panel as a side effect of a published `not-pr` state, and a
 * stopped engine publishes nothing further, so the unmount is called directly.
 */
export function run(doc: Document): void {
  let stop: (() => void) | null = null

  async function start(): Promise<void> {
    if (stop !== null) return

    const prefs = await loadPrefs()
    stop = startEngine(doc, updatePanel, prefs)
  }

  function halt(): void {
    if (stop === null) return

    stop()
    stop = null
    unmountPanel()
  }

  // Idempotent by construction: `start` is a no-op with an engine already
  // running, and `halt` is a no-op with `stop` already `null`. That is what
  // makes it safe to call `apply` for a change this same tab just wrote, which
  // `onEnabledChanged` cannot tell apart from one written elsewhere.
  function apply(enabled: boolean): void {
    if (enabled) void start()
    else halt()
  }

  onEnabledChanged(apply)
  void loadEnabled().then(apply)
}
