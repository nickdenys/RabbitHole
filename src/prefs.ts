import type { HideMode } from './hide/policy'
import { SORT_LABELS, type SortAxis } from './panel/sort'
import { THEME_LABELS, type Theme } from './panel/theme'

/**
 * Everything the extension remembers between visits, which is six choices and
 * nothing about any pull request.
 *
 * No finding, no thread id and no page is ever written to storage. What a
 * reader has read is a fact about a review and belongs to GitHub; what a reader
 * prefers is a fact about the extension, and is the only thing kept here.
 *
 * The tab the drawer is showing and which severity groups are folded shut are
 * deliberately not here. Both are a position in one worklist rather than a
 * preference about the extension, and carrying them to the next pull request
 * would open its drawer on somebody else's place.
 */
export interface Prefs {
  hideMode: HideMode
  sortAxis: SortAxis
  /**
   * Which way round the axis runs: the direction `SORT_DIRECTIONS` names first,
   * or the other one. Stored beside the axis because the pair is one choice as
   * the reader makes it, and an axis remembered without its direction would
   * come back sorted the other way.
   */
  sortLeading: boolean
  drawerOpen: boolean
  /**
   * Which palette the panel draws itself in, which is the one preference that
   * changes nothing but the panel: no thread is hidden or revealed by it, and
   * no pass is run for it.
   */
  theme: Theme
  /**
   * Click GitHub's own "Load more" button for the reader, whenever the count
   * check finds fewer findings than CodeRabbit claims.
   *
   * The one preference besides `hideMode` that acts on the page rather than on
   * the panel, and unlike `hideMode` it never hides or reveals anything: it
   * only clicks a button GitHub already rendered, the same button a reader
   * would click themselves. See `src/loadmore.ts`.
   */
  autoLoadMore: boolean
}

/**
 * Safe mode, severity first and worst first, drawer shut, palette from the
 * system.
 *
 * Also the answer whenever storage cannot be read, which is why the default is
 * the conservative one rather than the last one anybody chose: a failed read
 * must never widen what is hidden.
 */
export const DEFAULT_PREFS: Prefs = {
  hideMode: 'safe',
  sortAxis: 'severity',
  sortLeading: true,
  drawerOpen: false,
  theme: 'auto',
  autoLoadMore: true,
}

/** One key holding the whole record, so a read is one call and a write is one write. */
const KEY = 'prefs'

/**
 * The last prefs this content script knows about, which is what a partial save
 * merges onto.
 *
 * Held rather than re-read, because a save is a click and a read is a round
 * trip to the extension process: merging against a fresh read is the same race
 * as merging against this one, with a slower loser. Two tabs writing different
 * preferences at once is last writer wins, which for six settings is what a
 * reader would expect anyway.
 */
let current: Prefs = DEFAULT_PREFS

/**
 * The stored preferences, or the defaults for anything missing, unreadable, or
 * not a value this build knows.
 *
 * Never rejects. `chrome.storage` is absent in the tests and in any page the
 * content script is evaluated in without the extension around it, and an
 * invalidated extension context makes every call throw after an update. All
 * three are the same answer: the defaults, which hide the least.
 */
export async function loadPrefs(): Promise<Prefs> {
  const area = storage()
  if (area === null) return current

  try {
    const stored = await area.get(KEY)
    current = validate(stored?.[KEY])
  } catch {
    current = DEFAULT_PREFS
  }

  return current
}

/**
 * Write the given fields, leaving the rest as they are.
 *
 * Partial because the settings are changed one at a time by different controls,
 * and a caller that had to pass the whole record would be a caller holding a
 * copy of the rest.
 *
 * Never rejects, for the reasons `loadPrefs` gives, and nothing waits on it:
 * the in-memory value is updated first, so the panel redraws on the click
 * rather than on the write.
 */
export async function savePrefs(prefs: Partial<Prefs>): Promise<void> {
  current = validate({ ...current, ...prefs })

  const area = storage()
  if (area === null) return

  try {
    await area.set({ [KEY]: current })
  } catch {
    // A preference that could not be saved is a preference that reverts on the
    // next visit. Nothing on the page depends on the write, so there is nothing
    // to undo and nothing worth interrupting the reader over.
  }
}

/**
 * Whatever came out of storage, read field by field, with anything
 * unrecognised replaced by its default.
 *
 * Storage outlives the build that wrote it: a sort axis dropped in a later
 * version, or a record from a hand-edited storage area, would otherwise reach
 * the comparators as a key that is not there and the hide policy as a mode that
 * is neither of the two. A value this build does not know is no value at all.
 */
function validate(value: unknown): Prefs {
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFS

  const stored = value as Partial<Record<keyof Prefs, unknown>>

  return {
    hideMode: isHideMode(stored.hideMode) ? stored.hideMode : DEFAULT_PREFS.hideMode,
    sortAxis: isSortAxis(stored.sortAxis) ? stored.sortAxis : DEFAULT_PREFS.sortAxis,
    sortLeading:
      typeof stored.sortLeading === 'boolean' ? stored.sortLeading : DEFAULT_PREFS.sortLeading,
    drawerOpen: typeof stored.drawerOpen === 'boolean' ? stored.drawerOpen : DEFAULT_PREFS.drawerOpen,
    theme: isTheme(stored.theme) ? stored.theme : DEFAULT_PREFS.theme,
    autoLoadMore:
      typeof stored.autoLoadMore === 'boolean' ? stored.autoLoadMore : DEFAULT_PREFS.autoLoadMore,
  }
}

function isHideMode(value: unknown): value is HideMode {
  return value === 'safe' || value === 'aggressive'
}

/**
 * The picker's own keys are the vocabulary, so an axis that exists in one place
 * and not in the other cannot become a preference that silently falls back.
 */
function isSortAxis(value: unknown): value is SortAxis {
  return typeof value === 'string' && Object.hasOwn(SORT_LABELS, value)
}

/** The same rule as `isSortAxis`, against the settings sheet's own keys. */
function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && Object.hasOwn(THEME_LABELS, value)
}

/**
 * The three lines of `chrome.storage.local` this module uses, written out
 * rather than pulled from `@types/chrome`, which would be a dependency the
 * build does not otherwise need. `storage` is the manifest's only permission
 * and this is its only caller.
 */
interface StorageArea {
  get(key: string): Promise<Record<string, unknown> | undefined>
  set(items: Record<string, unknown>): Promise<void>
}

/**
 * Read on every call rather than once at module load, because the extension
 * context behind it can go away underneath a content script, and because a test
 * that stubs the global should not have to import this module afterwards.
 */
function storage(): StorageArea | null {
  const chrome = (globalThis as { chrome?: { storage?: { local?: StorageArea } } }).chrome
  return chrome?.storage?.local ?? null
}
