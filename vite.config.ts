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
  },
})
