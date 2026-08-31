import pkg from '../package.json' with { type: 'json' }

/**
 * The one description of this extension, from which both stores' manifests are
 * written.
 *
 * There is no `public/manifest.json` any more. Chrome and Firefox disagree
 * about exactly three things and agree about everything else, and two
 * hand-maintained files that agree about everything else is a pair that drifts:
 * a permission added for one, an icon size added to one, a description reworded
 * in one. The build writes both from here instead, and `test/manifest.test.ts`
 * asserts they differ only where they are meant to.
 *
 * See `vite.shared.ts` for how it reaches `dist/<target>/manifest.json`.
 */

/** The two builds this repo produces, which is also the set of `dist/` subdirectories. */
export const TARGETS = ['chrome', 'firefox'] as const

export type Target = (typeof TARGETS)[number]

export function isTarget(value: unknown): value is Target {
  return TARGETS.includes(value as Target)
}

/**
 * Firefox will not install an MV3 extension without an id it can key storage
 * and updates to, and an id chosen at signing time is an id that changes if the
 * add-on is ever resubmitted, taking every reader's stored preferences with it.
 * Pinned here for the same reason the version is: so it is a fact about the
 * project rather than a fact about one upload.
 *
 * A namespace the author owns rather than a GUID, which is the convention AMO
 * documents and the one a reader can read.
 */
const GECKO_ID = 'rabbithole@nickdenys.github.io'

/**
 * The oldest Firefox this build is claimed to work on.
 *
 * Set by the newest thing the panel depends on rather than by the oldest
 * Firefox still in the wild: `panel.css` is written entirely in `light-dark()`,
 * which lands in Firefox 120, and MV3 itself lands in 109. 128 is the first ESR
 * above both, so an enterprise reader on an ESR is either supported or told
 * plainly that they are not, rather than installing a build whose palette
 * silently resolves to nothing.
 *
 * Deliberately *not* 153, which is where `ShadowRoot.adoptedStyleSheets` became
 * reachable from a content script. The panel injects a `<style>` element
 * instead, precisely so this number does not have to be that one. See
 * `src/panel/mount.tsx`.
 */
const GECKO_MIN_VERSION = '128.0'

/**
 * What this extension collects and transmits, which is nothing.
 *
 * Required of every new AMO submission since 3 November 2025, and `["none"]` is
 * the declared way to say none rather than the value you get by omitting the
 * key. It is a claim about transmission, not about storage: the six
 * preferences in `chrome.storage.local` never leave the browser, and the only
 * request this extension makes is to GitHub's own deferred thread endpoint, on
 * the reader's own session, for the page they already have open. There is no
 * backend to send anything to. See `src/prefs.ts` and `src/fetch/threads.ts`.
 */
const GECKO_DATA_COLLECTION = { required: ['none'] }

/**
 * The oldest Chrome this build is claimed to work on, set by the same rule that
 * set Firefox's 128 rather than by MV3.
 *
 * MV3 itself lands in Chrome 88, and stopping there would be a build that
 * installs and then draws itself in no colour at all: `panel.css` is written
 * entirely in `light-dark()`, which lands in Chrome 123. A reader below that
 * gets told plainly by the store that this extension is not for their browser,
 * which is the honest failure rather than the silent one.
 *
 * Chrome only. Firefox reads `strict_min_version` out of
 * `browser_specific_settings` instead, and warns about keys it does not know.
 */
const CHROME_MIN_VERSION = '123'

/**
 * Where a reader goes to read the code, which is the whole of this project's
 * privacy story and most of its documentation.
 *
 * Shared by both manifests. Chrome shows it as the listing's "Website" and
 * AMO as the add-on's homepage, so one URL answers both.
 */
const HOMEPAGE_URL = 'https://github.com/nickdenys/RabbitHole'

const ICONS = {
  '16': 'icons/icon16.png',
  '32': 'icons/icon32.png',
  '48': 'icons/icon48.png',
  '128': 'icons/icon128.png',
}

/**
 * The manifest for one target, as an object ready to be serialised.
 *
 * Everything outside the `platform` spread is shared by construction rather
 * than by being copied and kept in step.
 */
export function manifest(target: Target): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: 'RabbitHole',
    // From `package.json`, so a release is one number changed in one place.
    version: pkg.version,
    // Not from `package.json`, deliberately. This one is read by a stranger in
    // a store listing, under a heading that has already said it is a browser
    // extension, so it opens on the verb; `package.json`'s says what the
    // repository is to somebody reading the repository. Two audiences, two
    // sentences, and neither is the other's summary.
    description: 'Turns CodeRabbit review comments into a triage worklist on GitHub pull requests.',
    permissions: ['storage', 'contextMenus'],
    homepage_url: HOMEPAGE_URL,
    icons: ICONS,
    action: { default_icon: ICONS },
    ...platform(target),
    content_scripts: [
      {
        matches: ['https://github.com/*'],
        js: ['content.js'],
        run_at: 'document_idle',
      },
    ],
  }
}

/**
 * Everything the two browsers genuinely disagree about, which is how the
 * background script is declared and where each store keeps its floor.
 *
 * Chrome runs MV3 background code as a service worker. Firefox does not
 * implement `background.service_worker` at all and runs an event page from
 * `background.scripts` instead. The two are close enough for this extension
 * because `background.ts` already holds no state across a teardown, which MV3
 * required of it on Chrome for exactly the same reason.
 *
 * Neither entry carries `"type": "module"`. Both builds emit an IIFE, because
 * `background.ts` imports nothing and Firefox's support for module event pages
 * is not documented well enough to rest a build on. See
 * `vite.background.config.ts`.
 *
 * The two minimum versions say the same thing in each store's own key, and both
 * are set by `light-dark()` rather than by MV3. Neither key is portable:
 * `minimum_chrome_version` is a top level Chrome key, `strict_min_version`
 * lives under `browser_specific_settings.gecko`, and each browser warns about
 * the other's.
 */
function platform(target: Target): Record<string, unknown> {
  if (target === 'firefox') {
    return {
      background: { scripts: ['background.js'] },
      browser_specific_settings: {
        gecko: {
          id: GECKO_ID,
          strict_min_version: GECKO_MIN_VERSION,
          data_collection_permissions: GECKO_DATA_COLLECTION,
        },
      },
    }
  }

  return {
    background: { service_worker: 'background.js' },
    minimum_chrome_version: CHROME_MIN_VERSION,
  }
}
