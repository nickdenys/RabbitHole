import { describe, expect, it } from 'vitest'
import pkg from '../package.json' with { type: 'json' }
import { isTarget, manifest, TARGETS } from '../src/manifest'

/**
 * The drift guard for `src/manifest.ts`.
 *
 * Two stores' manifests written from one source only pay for themselves if
 * something asserts that they still agree about everything they are meant to
 * agree about. This is that: the shared half is checked target by target, and
 * the differing half is named exactly, so a key added for one browser and
 * forgotten for the other fails here rather than in a review queue.
 *
 * Nothing here reads `dist/`. The manifests are a pure function of this build,
 * so testing the function tests every file it will ever write.
 */

describe('manifest', () => {
  it.each(TARGETS)('describes the same extension for %s', (target) => {
    expect(manifest(target)).toMatchObject({
      manifest_version: 3,
      name: 'RabbitHole',
      version: pkg.version,
      description: 'Turns CodeRabbit review comments into a triage worklist on GitHub pull requests.',
      permissions: ['storage', 'contextMenus'],
      content_scripts: [
        {
          matches: ['https://github.com/*'],
          js: ['content.js'],
          run_at: 'document_idle',
        },
      ],
    })
  })

  /**
   * The whole point of generating them. Everything outside `background` and
   * `browser_specific_settings` has to be identical, so the icons, the
   * permissions, the matches and the description cannot drift apart.
   */
  it('differs between the two targets only in how the background script is declared', () => {
    const differs = ['background', 'browser_specific_settings']

    const chrome = rest(manifest('chrome'), differs)
    const firefox = rest(manifest('firefox'), differs)

    expect(chrome).toEqual(firefox)
  })

  /**
   * The one hard incompatibility. Firefox does not implement
   * `background.service_worker` at all, and an MV3 manifest carrying it and
   * nothing else gives Firefox no background script to run, which is the
   * toolbar checkbox silently doing nothing.
   */
  it('gives Chrome a service worker and Firefox an event page', () => {
    expect(manifest('chrome').background).toEqual({ service_worker: 'background.js' })
    expect(manifest('firefox').background).toEqual({ scripts: ['background.js'] })
  })

  /**
   * Neither one, and deliberately: both builds emit an IIFE so that Firefox
   * never has to run a module event page. See `vite.background.config.ts`.
   */
  it.each(TARGETS)('declares no module type for %s', (target) => {
    expect(manifest(target).background).not.toHaveProperty('type')
  })

  /**
   * A Firefox id that changes is every reader's stored preferences lost, so it
   * is pinned in the source rather than assigned at signing time. The minimum
   * version is asserted as a number rather than a string shape because it is a
   * claim about `panel.css`: `light-dark()` lands in Firefox 120.
   */
  it('pins a Firefox id and a minimum version above the panel CSS it needs', () => {
    const gecko = (manifest('firefox').browser_specific_settings as { gecko: Record<string, string> })
      .gecko

    expect(gecko.id).toBe('rabbithole@nickdenys.github.io')
    expect(Number.parseFloat(gecko.strict_min_version)).toBeGreaterThanOrEqual(120)
  })

  /**
   * AMO rejects a new submission without this key, and `["none"]` is the
   * declared way to say the extension transmits nothing rather than something
   * you get by leaving it out. Asserted so that a future permission added for
   * some other reason has to come past this claim.
   */
  it('declares that Firefox collects and transmits no data', () => {
    const gecko = (
      manifest('firefox').browser_specific_settings as {
        gecko: { data_collection_permissions: { required: string[] } }
      }
    ).gecko

    expect(gecko.data_collection_permissions).toEqual({ required: ['none'] })
  })

  /** Chrome warns on manifest keys it does not know, so Firefox's stay out of it. */
  it('keeps Firefox settings out of the Chrome manifest', () => {
    expect(manifest('chrome')).not.toHaveProperty('browser_specific_settings')
  })

  it('recognises exactly the two targets the build knows how to write', () => {
    expect(TARGETS).toEqual(['chrome', 'firefox'])
    expect(isTarget('chrome')).toBe(true)
    expect(isTarget('Firefox')).toBe(false)
    expect(isTarget(undefined)).toBe(false)
  })
})

function rest(value: Record<string, unknown>, without: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !without.includes(key)))
}
