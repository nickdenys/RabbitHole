/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// Single content script, bundled as one IIFE file. Content scripts cannot be
// ES modules, so everything (including CSS imported with ?inline) is inlined.
//
// `emptyOutDir: false`, because `dist/background.js` comes from the other
// build, `vite.background.config.ts`, into this same `outDir`. Left at Vite's
// default of `true`, this config would delete `background.js` on every one of
// its own rebuilds, including every rebuild `vite build --watch` does in
// isolation - which is exactly what emptied it while the two builds' outputs
// were still being worked out. `npm run build` still starts from a clean
// `dist/` because the `build` script removes it once before either config
// runs, so neither config emptying its own output is what keeps it clean.
export default defineConfig({
  build: {
    outDir: 'dist',
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
