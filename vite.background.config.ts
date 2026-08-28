import { defineConfig } from 'vite'
import { outDir, target } from './vite.shared.ts'

// The background script, built separately from `vite.config.ts`'s content
// script. Vite's lib mode ties one `formats` list and one entry to a whole
// config, so two outputs need two configs rather than one with two entries.
//
// **IIFE, and no `"type": "module"` in either manifest.** Chrome runs this as
// an MV3 service worker and Firefox as an MV3 event page, and a service worker
// may be a module while Firefox's support for module event pages is not
// documented well enough to rest a build on. `background.ts` imports nothing,
// so a classic script costs it nothing at all: the two targets get the same
// bytes, and the one real difference between them stays in the manifest where
// it can be read. This used to emit `es` for Chrome alone.
//
// `emptyOutDir: false` for the same reason `vite.config.ts` sets it too: this
// build's `outDir` is the other config's as well, and either one emptying it
// would delete the other's output on its own next rebuild, watch mode
// included. See that file's comment.
export default defineConfig({
  build: {
    outDir: outDir(target()),
    emptyOutDir: false,
    target: 'es2022',
    minify: false,
    lib: {
      entry: 'src/background.ts',
      formats: ['iife'],
      name: 'rabbitHoleBackground',
      fileName: () => 'background.js',
    },
  },
})
