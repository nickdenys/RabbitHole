import { afterEach, describe, expect, it, vi } from 'vitest'

const KEY = 'enabled'

interface FakeArea {
  get?: (key: string) => Promise<Record<string, unknown>>
}

interface FakeChanged {
  addListener?: (
    callback: (
      changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
      areaName: string,
    ) => void,
  ) => void
}

function stubChrome(area: FakeArea = {}, changed: FakeChanged = {}) {
  const get = vi.fn(area.get ?? (async () => ({})))
  const addListener = vi.fn(changed.addListener ?? (() => {}))

  vi.stubGlobal('chrome', { storage: { local: { get }, onChanged: { addListener } } })
  return { get, addListener }
}

/** An area holding one record, which is the shape `write` in `background.ts` uses. */
function holding(value: unknown): FakeArea {
  return { get: async (key: string) => (key === KEY ? { [KEY]: value } : {}) }
}

async function freshEnabled() {
  vi.resetModules()
  return import('../src/enabled')
}

afterEach(() => vi.unstubAllGlobals())

describe('loadEnabled', () => {
  it('is true with no storage at all', async () => {
    const { loadEnabled } = await freshEnabled()

    expect(await loadEnabled()).toBe(true)
  })

  it('reads the stored value', async () => {
    stubChrome(holding(false))
    const { loadEnabled } = await freshEnabled()

    expect(await loadEnabled()).toBe(false)
  })

  it('is true on a storage area holding nothing yet', async () => {
    stubChrome()
    const { loadEnabled } = await freshEnabled()

    expect(await loadEnabled()).toBe(true)
  })

  it.each([null, 'off', 0, undefined])('is true when the stored value is not a boolean (%s)', async (stored) => {
    stubChrome(holding(stored))
    const { loadEnabled } = await freshEnabled()

    expect(await loadEnabled()).toBe(true)
  })

  it('is true when the read throws', async () => {
    stubChrome({ get: async () => { throw new Error('Extension context invalidated.') } })
    const { loadEnabled } = await freshEnabled()

    await expect(loadEnabled()).resolves.toBe(true)
  })
})

describe('onEnabledChanged', () => {
  it('calls back with the new value on a change to the enabled key in local', async () => {
    let fire: ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined
    stubChrome({}, { addListener: (cb) => { fire = cb } })
    const { onEnabledChanged } = await freshEnabled()

    const onChange = vi.fn()
    onEnabledChanged(onChange)
    fire?.({ [KEY]: { newValue: false } }, 'local')

    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('ignores a change in a different area', async () => {
    let fire: ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined
    stubChrome({}, { addListener: (cb) => { fire = cb } })
    const { onEnabledChanged } = await freshEnabled()

    const onChange = vi.fn()
    onEnabledChanged(onChange)
    fire?.({ [KEY]: { newValue: false } }, 'sync')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('ignores a change to an unrelated key', async () => {
    let fire: ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined
    stubChrome({}, { addListener: (cb) => { fire = cb } })
    const { onEnabledChanged } = await freshEnabled()

    const onChange = vi.fn()
    onEnabledChanged(onChange)
    fire?.({ prefs: { newValue: {} } }, 'local')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('treats a non boolean new value as true', async () => {
    let fire: ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined
    stubChrome({}, { addListener: (cb) => { fire = cb } })
    const { onEnabledChanged } = await freshEnabled()

    const onChange = vi.fn()
    onEnabledChanged(onChange)
    fire?.({ [KEY]: { newValue: undefined } }, 'local')

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('does nothing where there is no storage', async () => {
    const { onEnabledChanged } = await freshEnabled()

    expect(() => onEnabledChanged(vi.fn())).not.toThrow()
  })
})
