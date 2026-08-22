import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Prefs } from '../src/prefs'

const KEY = 'prefs'

const STORED: Prefs = {
  hideMode: 'aggressive',
  sortAxis: 'file',
  sortLeading: false,
  drawerOpen: true,
  theme: 'dark',
}

/**
 * A `chrome.storage.local` that answers from an object, plus the two spies the
 * cases assert on.
 *
 * `sync` is stubbed as well, and nothing may ever touch it: preferences are per
 * browser on purpose, because a hide mode synced from another machine would
 * change what is hidden on this one without anybody choosing it here.
 */
interface FakeArea {
  get?: (key: string) => Promise<Record<string, unknown>>
  set?: (items: Record<string, unknown>) => Promise<void>
}

function stubChrome(area: FakeArea = {}) {
  const get = vi.fn(area.get ?? (async () => ({})))
  const set = vi.fn(area.set ?? (async () => {}))
  const sync = { get: vi.fn(), set: vi.fn() }

  vi.stubGlobal('chrome', { storage: { local: { get, set }, sync } })
  return { get, set, sync }
}

/** An area holding one record, which is the shape the extension writes. */
function holding(value: unknown): FakeArea {
  return { get: async (key: string) => (key === KEY ? { [KEY]: value } : {}) }
}

/**
 * A fresh copy of the module per case.
 *
 * `prefs.ts` holds the last known record so a partial save has something to
 * merge onto, and that cache is the thing several cases below are about. A
 * shared module would carry one case's write into the next one's read.
 */
async function freshPrefs() {
  vi.resetModules()
  return import('../src/prefs')
}

afterEach(() => vi.unstubAllGlobals())

describe('loadPrefs', () => {
  it('is safe mode, severity, a shut drawer and the system palette with no storage at all', async () => {
    const { loadPrefs, DEFAULT_PREFS } = await freshPrefs()

    expect(await loadPrefs()).toEqual(DEFAULT_PREFS)
    expect(DEFAULT_PREFS).toEqual({
      hideMode: 'safe',
      sortAxis: 'severity',
      sortLeading: true,
      drawerOpen: false,
      theme: 'auto',
    })
  })

  it('reads the stored record', async () => {
    stubChrome(holding(STORED))
    const { loadPrefs } = await freshPrefs()

    expect(await loadPrefs()).toEqual(STORED)
  })

  it('asks chrome.storage.local for one key, and never sync', async () => {
    const { get, sync } = stubChrome(holding(STORED))
    const { loadPrefs } = await freshPrefs()
    await loadPrefs()

    expect(get).toHaveBeenCalledWith(KEY)
    expect(sync.get).not.toHaveBeenCalled()
  })

  it('is the defaults on a storage area holding nothing yet', async () => {
    stubChrome()
    const { loadPrefs, DEFAULT_PREFS } = await freshPrefs()

    expect(await loadPrefs()).toEqual(DEFAULT_PREFS)
  })

  // The reader's own storage area, a record written by an older build, or a
  // field this build renamed. All of them arrive here as one bad value among
  // two good ones, and losing the two good ones would be the fallback doing
  // more damage than the corruption.
  it.each([
    ['hideMode', { ...STORED, hideMode: 'hide-everything' }, { hideMode: 'safe' }],
    ['sortAxis', { ...STORED, sortAxis: 'urgency' }, { sortAxis: 'severity' }],
    ['sortLeading', { ...STORED, sortLeading: 'backwards' }, { sortLeading: true }],
    ['drawerOpen', { ...STORED, drawerOpen: 'yes' }, { drawerOpen: false }],
    ['theme', { ...STORED, theme: 'solarized' }, { theme: 'auto' }],
  ])('falls back on an unknown %s and keeps the rest', async (_field, stored, expected) => {
    stubChrome(holding(stored))
    const { loadPrefs } = await freshPrefs()

    expect(await loadPrefs()).toEqual({ ...STORED, ...expected })
  })

  it.each([null, 'safe', 42, undefined])(
    'is the defaults when the stored value is not a record (%s)',
    async (stored) => {
      stubChrome(holding(stored))
      const { loadPrefs, DEFAULT_PREFS } = await freshPrefs()

      expect(await loadPrefs()).toEqual(DEFAULT_PREFS)
    },
  )

  // What an invalidated extension context does to every storage call after the
  // extension is updated or reloaded. The page keeps working, in safe mode.
  it('is the defaults when the read throws', async () => {
    stubChrome({ get: async () => { throw new Error('Extension context invalidated.') } })
    const { loadPrefs, DEFAULT_PREFS } = await freshPrefs()

    await expect(loadPrefs()).resolves.toEqual(DEFAULT_PREFS)
  })
})

describe('savePrefs', () => {
  it('writes the whole record, with the unchanged fields as they were', async () => {
    const { set } = stubChrome(holding(STORED))
    const { loadPrefs, savePrefs } = await freshPrefs()

    await loadPrefs()
    await savePrefs({ hideMode: 'safe' })

    expect(set).toHaveBeenCalledWith({ [KEY]: { ...STORED, hideMode: 'safe' } })
  })

  it('merges onto the defaults when nothing was loaded first', async () => {
    const { set } = stubChrome()
    const { savePrefs, DEFAULT_PREFS } = await freshPrefs()

    await savePrefs({ drawerOpen: true })

    expect(set).toHaveBeenCalledWith({ [KEY]: { ...DEFAULT_PREFS, drawerOpen: true } })
  })

  it('merges the second save onto the first rather than onto storage', async () => {
    const { set } = stubChrome()
    const { savePrefs, DEFAULT_PREFS } = await freshPrefs()

    await savePrefs({ sortAxis: 'effort' })
    await savePrefs({ drawerOpen: true })

    expect(set).toHaveBeenLastCalledWith({
      [KEY]: { ...DEFAULT_PREFS, sortAxis: 'effort', drawerOpen: true },
    })
  })

  it('never writes a value it would not read back', async () => {
    const { set } = stubChrome()
    const { savePrefs, DEFAULT_PREFS } = await freshPrefs()

    await savePrefs({ sortAxis: 'urgency' } as unknown as Partial<Prefs>)

    expect(set).toHaveBeenCalledWith({ [KEY]: DEFAULT_PREFS })
  })

  it('writes to local and never to sync', async () => {
    const { set, sync } = stubChrome()
    const { savePrefs } = await freshPrefs()

    await savePrefs({ hideMode: 'aggressive' })

    expect(set).toHaveBeenCalledOnce()
    expect(sync.set).not.toHaveBeenCalled()
  })

  it('does nothing at all where there is no storage', async () => {
    const { savePrefs } = await freshPrefs()

    await expect(savePrefs({ hideMode: 'aggressive' })).resolves.toBeUndefined()
  })

  // A write that fails is a preference that reverts on the next visit, and
  // nothing on the page is waiting on it, so it must not reach the caller.
  it('does not reject when the write throws', async () => {
    stubChrome({ set: async () => { throw new Error('Extension context invalidated.') } })
    const { savePrefs } = await freshPrefs()

    await expect(savePrefs({ hideMode: 'aggressive' })).resolves.toBeUndefined()
  })
})
