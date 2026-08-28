/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { manifestPlugin, outDir, target } from './vite.shared.ts'

// Single content script, bundled as one IIFE file. Content scripts cannot be
// ES modules, so everything (including CSS imported with ?inline) is inlined.
//
// The output goes to `dist/<target>/`, one complete loadable directory per
// browser, and this config is run once per target with `TARGET` set. The two
// directories differ in `manifest.json` and nothing else: the content script
// and the background script are byte for byte the same in both, because every
// Chrome and Firefox difference this extension has turned out to have lives in
// the manifest. See `src/manifest.ts`.
//
// `emptyOutDir: false`, because `dist/<target>/background.js` comes from the
// other build, `vite.background.config.ts`, into this same `outDir`. Left at
// Vite's default of `true`, this config would delete `background.js` on every
// one of its own rebuilds, including every rebuild `vite build --watch` does in
// isolation - which is exactly what emptied it while the two builds' outputs
// were still being worked out. `npm run build` still starts from a clean
// `dist/` because the `build` script removes it once before any config runs, so
// neither config emptying its own output is what keeps it clean.
const TARGET = target()

export default defineConfig({
  // Writing the manifest is attached here rather than to the background config
  // for one reason: both write into the same directory, and doing it in both
  // would be two writes of the same bytes with a rebuild order deciding which
  // one lands. See `vite.shared.ts`.
  plugins: [manifestPlugin(TARGET)],
  build: {
    outDir: outDir(TARGET),
    emptyOutDir: false,
    target: 'es2022',
    // The manifest matches all of github.com, so this script is fetched and
    // parsed on every page a reader opens there and not only on pull requests.
    // Unminified it is 197.6 kB against 65.5 kB, which is the one cost in this
    // extension a reader pays without ever opening the panel.
    //
    // The sourcemap is what makes that affordable while the extension is still
    // developed unpacked: DevTools shows `src/` rather than one line of
    // mangled names, and `content.js.map` is only fetched when they are open.
    minify: true,
    sourcemap: true,
    lib: {
      entry: 'src/content.ts',
      formats: ['iife'],
      name: 'rabbitHole',
      fileName: () => 'content.js',
    },
  },
  test: {
    environment: 'happy-dom',
    // `panel.css?inline` resolves to an empty string with vitest's default of
    // `css: false`, which was invisible while the panel was styled by
    // `replaceSync(styles)` and nothing asserted on the result. It stopped being
    // invisible when the stylesheet moved into the rendered tree, where an empty
    // import is an empty `<style>` element and a test claiming to check the
    // panel's styles checks nothing. One 1.3k line file is the whole blast
    // radius: it is the only stylesheet this build imports anywhere.
    css: true,
    // The largest fixture is 8.7 MB of markup and five test files parse it.
    // In a full parallel run the workers contend, and a single case can spend
    // more than vitest's 5 second default just building its document, which
    // fails a test that is not slow so much as sharing a machine.
    testTimeout: 20_000,
    // Same reason, one hook further out: A9's drawer tests parse a fixture in a
    // `beforeAll` so the whole file shares one engine pass, and the default
    // here is 10 seconds rather than the 5 above.
    hookTimeout: 20_000,
    // Fixtures are whole GitHub pages, so they carry <link> tags pointing at
    // githubassets.com. happy-dom will fetch those for real, which makes the
    // suite hit the network and fail offline. Nothing here renders, so none of
    // it is wanted.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableJavaScriptEvaluation: true,
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
          disableIframePageLoading: true,
        },
      },
    },
  },
})
