/**
 * Whether the extension may run at all, which is not one of `Prefs`.
 *
 * Kept in its own `chrome.storage.local` key rather than folded into the
 * `prefs` record, because it has a second writer: the background service
 * worker's toolbar checkbox, never the in-page panel. A shared key would mean
 * the service worker has to read-merge-write around whatever the panel last
 * saved, across two module instances that cannot see each other's in-memory
 * cache. A dedicated key means each writer only ever owns its own value. See
 * `src/background.ts` and `src/bootstrap.ts`.
 *
 * `true` is the only default: a reader who has never touched the toggle gets
 * the extension exactly as it behaved before this existed, on a fresh install
 * and on a storage read that fails alike.
 */
const KEY = 'enabled'

/**
 * The stored flag, or `true` for anything missing, unreadable, or not a
 * boolean. Never rejects, for the same reasons `prefs.ts`'s `loadPrefs` does
 * not.
 */
export async function loadEnabled(): Promise<boolean> {
  const area = storage()
  if (area === null) return true

  try {
    const stored = await area.get(KEY)
    return asBoolean(stored?.[KEY])
  } catch {
    return true
  }
}

/**
 * Call `onChange` with the new value whenever another context flips `enabled`
 * elsewhere, which in practice is only ever the background service worker's
 * toolbar checkbox.
 *
 * Scoped to this one key in the `local` area, so a change to any of the five
 * `Prefs` fields, written under a different key entirely, never reaches here.
 * A change this tab wrote itself also fires `chrome.storage.onChanged`, and
 * that is fine: `bootstrap.ts`'s `apply` is idempotent, so hearing about your
 * own write is a no-op rather than a bug to guard against.
 */
export function onEnabledChanged(onChange: (enabled: boolean) => void): void {
  const changed = onChangedEvent()

  changed?.addListener((changes, areaName) => {
    if (areaName !== 'local') return

    const change = changes[KEY]
    if (change === undefined) return

    onChange(asBoolean(change.newValue))
  })
}

function asBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true
}

/** The one field of `chrome.storage.local` this module reads from. */
interface StorageArea {
  get(key: string): Promise<Record<string, unknown> | undefined>
}

/** The one field of `chrome.storage.onChanged` this module listens on. */
interface OnChangedEvent {
  addListener(
    callback: (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      areaName: string,
    ) => void,
  ): void
}

/**
 * Read on every call rather than once at module load, matching `prefs.ts`'s
 * `storage`: the extension context behind it can go away underneath a content
 * script, and a test stubbing the global should not have to import this
 * module afterwards.
 */
function storage(): StorageArea | null {
  const chrome = (globalThis as { chrome?: { storage?: { local?: StorageArea } } }).chrome
  return chrome?.storage?.local ?? null
}

function onChangedEvent(): OnChangedEvent | null {
  const chrome = (globalThis as { chrome?: { storage?: { onChanged?: OnChangedEvent } } }).chrome
  return chrome?.storage?.onChanged ?? null
}
