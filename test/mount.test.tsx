import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { NO_CHECK } from '../src/count'
import type { TriageState } from '../src/engine'
import { updatePanel } from '../src/panel/mount'
import { DEFAULT_PREFS } from '../src/prefs'
import type { CodeRabbitNote } from '../src/parse/notes'
import type { PageKind } from '../src/types'

const HOST_ID = 'rabbithole-root'

const PR_URL = 'https://github.com/owner/repo/pull/1'

beforeAll(() => {
  ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(PR_URL)
})

afterEach(() => {
  // The mount keeps a module level reference to its shadow root, so every case
  // has to leave the page with no host for the next one to build its own.
  updatePanel(state('not-pr'))
})

/**
 * A page of the given kind, carrying CodeRabbit's walkthrough unless asked not
 * to, which is all the host cares about.
 *
 * The note is the whole difference between a page that gets a panel and one
 * that does not, per invariant 4. It is passed rather than defaulted silently,
 * because a helper that quietly stopped building "an empty page" would make
 * every case below pass for a reason it does not state.
 */
function state(kind: PageKind, { coderabbit = true }: { coderabbit?: boolean } = {}): TriageState {
  return {
    kind,
    threads: [],
    rows: [],
    notes: coderabbit ? [walkthrough()] : [],
    hidden: new Set(),
    counts: { total: 0, unresolved: 0, hidden: 0, unparsed: 0 },
    check: NO_CHECK,
    prefs: DEFAULT_PREFS,
    setPrefs: () => {},
  }
}

/**
 * The one thing `hasCodeRabbit` reads off an otherwise empty state. Its element
 * is never hidden here: nothing in this file runs the hide engine.
 */
function walkthrough(): CodeRabbitNote {
  return {
    el: document.createElement('div'),
    timelineItem: null,
    kind: 'walkthrough',
    actionableCount: null,
  }
}

function host(): HTMLElement | null {
  return document.getElementById(HOST_ID)
}

/**
 * The host and its shadow root, which is the part Turbo can take away.
 *
 * Nothing here asserts on what the panel draws, which is `panel.test.tsx`'s
 * job. This is about the one thing a navigation can break: a mount holding a
 * shadow root that is no longer on the page, rendering into nothing while the
 * reader sees no handle at all.
 */
describe('updatePanel', () => {
  it('mounts a host with a shadow root and a stylesheet', () => {
    updatePanel(state('classic'))

    const mounted = host()
    expect(mounted).not.toBeNull()
    expect(mounted?.shadowRoot).not.toBeNull()
    expect(mounted?.shadowRoot?.querySelector('.handle')).not.toBeNull()
  })

  it('reuses the same host across passes', () => {
    updatePanel(state('classic'))
    const first = host()

    updatePanel(state('classic'))
    updatePanel(state('classic'))

    expect(host()).toBe(first)
    expect(document.querySelectorAll(`#${HOST_ID}`).length).toBe(1)
  })

  it('rebuilds the host when Turbo takes the body away', () => {
    updatePanel(state('classic'))
    const first = host()

    // What a Turbo body swap does to anything appended to <body>.
    document.body.innerHTML = ''
    expect(host()).toBeNull()

    updatePanel(state('classic'))

    const rebuilt = host()
    expect(rebuilt).not.toBeNull()
    expect(rebuilt).not.toBe(first)
    expect(rebuilt?.shadowRoot?.querySelector('.handle')).not.toBeNull()
  })

  it('keeps a handle on a build it cannot read, because that is the warning', () => {
    updatePanel(state('react'))

    expect(host()?.shadowRoot?.querySelector('.handle.warn')).not.toBeNull()
  })

  /**
   * Invariant 4, at the only place it is enforced. A readable pull request
   * CodeRabbit never reviewed gets no host, so the extension leaves no trace on
   * the page at all.
   */
  it('mounts nothing on a pull request CodeRabbit never touched', () => {
    updatePanel(state('classic', { coderabbit: false }))

    expect(host()).toBeNull()
  })

  // The order of the two tests in `isQuiet`, asserted rather than argued: an
  // unreadable build also has no notes and no rows, and losing its handle would
  // be invariant 3 failing.
  it.each(['react', 'unknown'] as const)('keeps the handle on a %s build with no notes', (kind) => {
    updatePanel(state(kind, { coderabbit: false }))

    expect(host()?.shadowRoot?.querySelector('.handle.warn')).not.toBeNull()
  })

  it('takes the host down when CodeRabbit turns out not to be there, and puts it back', () => {
    updatePanel(state('classic'))
    updatePanel(state('classic', { coderabbit: false }))
    expect(host()).toBeNull()

    updatePanel(state('classic'))

    expect(host()?.shadowRoot?.querySelector('.handle')).not.toBeNull()
  })

  it('takes the host off the page away from a pull request', () => {
    updatePanel(state('classic'))
    updatePanel(state('not-pr'))

    expect(host()).toBeNull()
  })

  it('is safe to unmount twice, and to mount again afterwards', () => {
    updatePanel(state('classic'))
    updatePanel(state('not-pr'))
    updatePanel(state('not-pr'))

    updatePanel(state('classic'))

    expect(host()?.shadowRoot?.querySelector('.handle')).not.toBeNull()
  })
})
