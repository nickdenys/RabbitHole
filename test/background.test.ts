import { afterEach, describe, expect, it, vi } from 'vitest'

const KEY = 'enabled'
const MENU_ID = 'rabbithole-enabled'

/**
 * A macrotask boundary, so every microtask a handler kicked off with a bare
 * `void someAsyncCall()` has settled by the time a case asserts on its effect.
 * `background.ts`'s listeners are deliberately fire-and-forget, the way a real
 * `chrome.*` event dispatch is, so nothing in the stub itself is awaitable.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

interface CreateArgs {
  id: string
  type: string
  title: string
  checked: boolean
  contexts: string[]
}

/**
 * A `chrome` stub with just enough of `runtime`, `contextMenus`, `action` and
 * `storage.local` for `background.ts`, plus handles the cases fire through:
 * `installed`/`started` replay the two listeners that (re)build the menu, and
 * `click` replays the one that handles a checkbox press.
 */
function stubChrome(stored: Record<string, unknown> = {}) {
  const store = { ...stored }
  const created: CreateArgs[] = []
  const badges: { text: string }[] = []

  let installed: (() => void) | undefined
  let started: (() => void) | undefined
  let clicked: ((info: { menuItemId: string; checked?: boolean }) => void) | undefined

  const chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn((cb: () => void) => { installed = cb }) },
      onStartup: { addListener: vi.fn((cb: () => void) => { started = cb }) },
    },
    contextMenus: {
      create: vi.fn((props: CreateArgs) => { created.push(props) }),
      removeAll: vi.fn(async () => {}),
      onClicked: {
        addListener: vi.fn((cb: (info: { menuItemId: string; checked?: boolean }) => void) => {
          clicked = cb
        }),
      },
    },
    action: {
      setBadgeText: vi.fn((details: { text: string }) => { badges.push(details) }),
      setBadgeBackgroundColor: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items)),
      },
    },
  }

  vi.stubGlobal('chrome', chrome)

  return {
    chrome,
    store,
    created,
    badges,
    installed: async () => { installed?.(); await flush() },
    started: async () => { started?.(); await flush() },
    click: async (checked: boolean) => { clicked?.({ menuItemId: MENU_ID, checked }); await flush() },
    clickOther: async () => { clicked?.({ menuItemId: 'something-else', checked: true }); await flush() },
  }
}

async function freshBackground() {
  vi.resetModules()
  await import('../src/background')
}

afterEach(() => vi.unstubAllGlobals())

describe('background', () => {
  it('registers onInstalled, onStartup and onClicked synchronously on import', async () => {
    const { chrome } = stubChrome()
    await freshBackground()

    expect(chrome.runtime.onInstalled.addListener).toHaveBeenCalled()
    expect(chrome.runtime.onStartup.addListener).toHaveBeenCalled()
    expect(chrome.contextMenus.onClicked.addListener).toHaveBeenCalled()
  })

  it('creates a checked checkbox on the action icon when nothing is stored yet', async () => {
    const stub = stubChrome()
    await freshBackground()
    await stub.installed()

    expect(stub.created).toHaveLength(1)
    expect(stub.created[0]).toMatchObject({
      id: MENU_ID,
      type: 'checkbox',
      checked: true,
      contexts: ['action'],
    })
    expect(stub.badges).toContainEqual({ text: '' })
  })

  it('creates an unchecked checkbox and the OFF badge when disabled is stored', async () => {
    const stub = stubChrome({ [KEY]: false })
    await freshBackground()
    await stub.installed()

    expect(stub.created[0]).toMatchObject({ checked: false })
    expect(stub.badges).toContainEqual({ text: 'OFF' })
  })

  it('removes any existing menu before recreating it, on both install and startup', async () => {
    const stub = stubChrome()
    await freshBackground()

    await stub.installed()
    await stub.started()

    expect(stub.chrome.contextMenus.removeAll).toHaveBeenCalledTimes(2)
    expect(stub.created).toHaveLength(2)
  })

  it('writes the flipped value and updates the badge on a click', async () => {
    const stub = stubChrome({ [KEY]: true })
    await freshBackground()
    await stub.installed()

    await stub.click(false)

    expect(stub.store[KEY]).toBe(false)
    expect(stub.badges.at(-1)).toEqual({ text: 'OFF' })
  })

  it('ignores a click on a menu item that is not the checkbox', async () => {
    const stub = stubChrome({ [KEY]: true })
    await freshBackground()
    await stub.installed()

    await stub.clickOther()

    expect(stub.chrome.storage.local.set).not.toHaveBeenCalled()
  })

  it('treats a click with no checked field as enabling', async () => {
    const stub = stubChrome({ [KEY]: false })
    await freshBackground()
    await stub.installed()

    await stub.click(undefined as unknown as boolean)

    expect(stub.store[KEY]).toBe(true)
  })
})
