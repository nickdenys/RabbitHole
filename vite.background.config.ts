import { defineConfig } from 'vite'

// The service worker, built separately from `vite.config.ts`'s content script.
// MV3 service workers can be ES modules (`background.type: 'module'` in the
// manifest), and `vite.config.ts`'s content script has to stay `iife`, since
// content scripts cannot be modules. Vite's lib mode ties one `formats` list
// to a whole config, so the two outputs need two configs rather than one with
// two entries.
//
// `emptyOutDir: false` for the same reason `vite.config.ts` sets it too: this
// build's `outDir` is the other config's as well, and either one emptying it
// would delete the other's output on its own next rebuild, watch mode
// included. See that file's comment.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    minify: false,
    lib: {
      entry: 'src/background.ts',
      formats: ['es'],
      fileName: () => 'background.js',
    },
  },
})
