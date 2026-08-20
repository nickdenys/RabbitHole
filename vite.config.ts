/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// Single content script, bundled as one IIFE file. Content scripts cannot be
// ES modules, so everything (including CSS imported with ?inline) is inlined.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    lib: {
      entry: 'src/content.ts',
      formats: ['iife'],
      name: 'coderabbitTriage',
      fileName: () => 'content.js',
    },
  },
  test: {
    environment: 'happy-dom',
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
