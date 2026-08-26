/**
 * The toolbar icon's right-click menu, and nothing else this extension needs a
 * background context for.
 *
 * A service worker, so nothing here may hold state across an idle timeout: MV3
 * tears this down between clicks and respawns it on the next event. Every read
 * and write goes straight to `chrome.storage.local`, never through
 * `src/enabled.ts`'s helpers or `src/prefs.ts`'s stateful `current` cache,
 * both of which assume a long-lived content script. A cache started fresh in
 * a respawned worker and then merged onto would write stale defaults over
 * whatever the reader actually has stored. See `src/enabled.ts`.
 *
 * Written against a hand-picked slice of the `chrome.*` surface, same
 * reasoning as `prefs.ts`'s `StorageArea`: `@types/chrome` would be a
 * dependency the build does not otherwise need, for types this file uses in
 * one place each.
 */

const KEY = 'enabled'
const MENU_ID = 'rabbithole-enabled'
const BADGE_COLOR = '#8b1d1d'

chrome().runtime.onInstalled.addListener(() => void sync())
chrome().runtime.onStartup.addListener(() => void sync())

chrome().contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID) return
  void write(info.checked ?? true)
})

/**
 * (Re)create the one checkbox item and set the badge from whatever is
 * currently stored, on install, on update, and on every browser startup.
 *
 * `removeAll` first rather than trusting a menu Chrome may already be showing:
 * a stale item from a previous version of this file, with a different title
 * or `checked` value baked in at creation time, would otherwise sit there
 * until the next click.
 */
async function sync(): Promise<void> {
  const enabled = await read()

  chrome().contextMenus.removeAll(() => {
    chrome().contextMenus.create({
      id: MENU_ID,
      type: 'checkbox',
      title: 'Enabled',
      checked: enabled,
      contexts: ['action'],
    })
  })

  setBadge(enabled)
}

async function read(): Promise<boolean> {
  const stored = await chrome().storage.local.get(KEY)
  const value = stored?.[KEY]
  return typeof value === 'boolean' ? value : true
}

async function write(enabled: boolean): Promise<void> {
  await chrome().storage.local.set({ [KEY]: enabled })
  setBadge(enabled)
}

/**
 * The one thing a reader can see without right-clicking: `OFF` while
 * disabled, cleared while enabled. The checkbox is the source of truth: this
 * only ever mirrors it, on `sync` as well as on every click, so the two can
 * never show a reader two different answers.
 */
function setBadge(enabled: boolean): void {
  chrome().action.setBadgeText({ text: enabled ? '' : 'OFF' })
  chrome().action.setBadgeBackgroundColor({ color: BADGE_COLOR })
}

interface ChromeApi {
  runtime: {
    onInstalled: Event0
    onStartup: Event0
  }
  contextMenus: {
    create(props: {
      id: string
      type: 'checkbox'
      title: string
      checked: boolean
      contexts: string[]
    }): void
    removeAll(callback: () => void): void
    onClicked: EventListener1<{ menuItemId: string | number; checked?: boolean }>
  }
  action: {
    setBadgeText(details: { text: string }): void
    setBadgeBackgroundColor(details: { color: string }): void
  }
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown> | undefined>
      set(items: Record<string, unknown>): Promise<void>
    }
  }
}

interface Event0 {
  addListener(callback: () => void): void
}

interface EventListener1<T> {
  addListener(callback: (arg: T) => void): void
}

/**
 * The global read as a call rather than a module level constant, so importing
 * this file in a test before `vi.stubGlobal('chrome', ...)` runs never throws
 * on a missing global; the throw happens on first use instead, same as
 * `prefs.ts`'s `storage()`.
 */
function chrome(): ChromeApi {
  return (globalThis as unknown as { chrome: ChromeApi }).chrome
}

// No import or export otherwise touches this file, which TypeScript would
// then treat as a global script rather than a module - this is the whole of
// marking it one, for `import '../src/background'` in the test.
export {}
