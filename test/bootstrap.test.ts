import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted, per vitest's own pattern for a `vi.mock` factory that needs to
// close over spies the cases assert on: `vi.mock` calls are hoisted above
// ordinary `const`s, so anything a factory references has to be created
// through `vi.hoisted` to exist by the time the factory runs.
const { startEngine, teardown, updatePanel, unmountPanel, loadPrefs } = vi.hoisted(() => {
  const teardown = vi.fn()
  return {
    startEngine: vi.fn(() => teardown),
    teardown,
    updatePanel: vi.fn(),
    unmountPanel: vi.fn(),
    loadPrefs: vi.fn(async () => 'the-prefs'),
  }
})

// `engine.ts`, `panel/mount.tsx` and `prefs.ts` are each tested on their own
// terms elsewhere (`engine.test.ts`, `mount.test.tsx`, `prefs.test.ts`). This
// file is about the one thing that is new here: whether `run` starts and
// stops them at the right moments. `enabled.ts` is deliberately left real,
// stubbed only at the `chrome` global, because reacting correctly to it is
// exactly what `run` is for.
vi.mock('../src/engine', () => ({ startEngine }))
vi.mock('../src/panel/mount', () => ({ updatePanel, unmountPanel }))
vi.mock('../src/prefs', () => ({ loadPrefs }))

const KEY = 'enabled'

function stubChrome(enabled: boolean) {
  const store: Record<string, unknown> = { [KEY]: enabled }
  let fire: ((changes: Record<string, { newValue?: unknown }>, areaName: string) => void) | undefined

  vi.stubGlobal('chrome', {
    storage: {
      local: { get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})) },
      onChanged: { addListener: vi.fn((cb: typeof fire) => { fire = cb }) },
    },
  })

  return {
    flip(value: boolean) {
      store[KEY] = value
      fire?.({ [KEY]: { newValue: value } }, 'local')
    },
  }
}

/** Every microtask a fire-and-forget `void someAsyncCall()` kicked off. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('run', () => {
  it('starts the engine, with the loaded prefs, when enabled loads true', async () => {
    stubChrome(true)
    const { run } = await import('../src/bootstrap')

    run(document)
    await flush()

    expect(loadPrefs).toHaveBeenCalledOnce()
    expect(startEngine).toHaveBeenCalledWith(document, updatePanel, 'the-prefs')
  })

  it('never starts the engine when enabled loads false', async () => {
    stubChrome(false)
    const { run } = await import('../src/bootstrap')

    run(document)
    await flush()

    expect(startEngine).not.toHaveBeenCalled()
  })

  it('stops the engine and unmounts the panel when enabled flips false elsewhere', async () => {
    const stub = stubChrome(true)
    const { run } = await import('../src/bootstrap')

    run(document)
    await flush()

    stub.flip(false)
    await flush()

    expect(teardown).toHaveBeenCalledOnce()
    expect(unmountPanel).toHaveBeenCalledOnce()
  })

  it('restarts the engine, reloading prefs, when enabled flips back true', async () => {
    const stub = stubChrome(true)
    const { run } = await import('../src/bootstrap')

    run(document)
    await flush()
    stub.flip(false)
    await flush()
    stub.flip(true)
    await flush()

    expect(startEngine).toHaveBeenCalledTimes(2)
    expect(loadPrefs).toHaveBeenCalledTimes(2)
  })

  it('does not start a second engine on a redundant enabled change', async () => {
    const stub = stubChrome(true)
    const { run } = await import('../src/bootstrap')

    run(document)
    await flush()
    stub.flip(true)
    await flush()

    expect(startEngine).toHaveBeenCalledOnce()
  })

  it('does not stop again on a redundant disabled change', async () => {
    const stub = stubChrome(false)
    const { run } = await import('../src/bootstrap')

    run(document)
    await flush()
    stub.flip(false)
    await flush()

    expect(teardown).not.toHaveBeenCalled()
    expect(unmountPanel).not.toHaveBeenCalled()
  })
})
