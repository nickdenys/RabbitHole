import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { isTarget, manifest, type Target } from './src/manifest.ts'

/**
 * What both build configs need to know about which browser they are building
 * for, and the plugin that writes that browser's manifest.
 *
 * The two configs exist for a reason that has nothing to do with targets (one
 * output has to be an IIFE content script, the other is a separate entry, and
 * Vite's lib mode ties one entry to one config), so the target has to come from
 * outside both. It comes from the environment: `npm run build` runs each config
 * once per target with `TARGET` set.
 */

/**
 * The target this invocation is building, defaulting to `chrome`.
 *
 * A default rather than a required variable, so a bare `vite build` still
 * produces something loadable and a reader who has not read `package.json` gets
 * a build rather than a stack trace. An *unrecognised* value throws, because
 * `TARGET=Firefox` silently building Chrome is the failure that would be found
 * in the store review queue.
 */
export function target(): Target {
  const value = process.env.TARGET ?? 'chrome'
  if (!isTarget(value)) {
    throw new Error(`TARGET must be one of chrome, firefox. Got: ${value}`)
  }
  return value
}

/**
 * Where this invocation's output goes, which is one directory per target.
 *
 * Both targets get their own complete, loadable directory rather than a shared
 * one with two manifests beside each other, because a browser is pointed at a
 * directory and the directory has to be exactly what ships.
 */
export function outDir(target: Target): string {
  return join('dist', target)
}

/**
 * Write `manifest.json` for this target once the bundle is out.
 *
 * `closeBundle` rather than `generateBundle` with `emitFile`, because the
 * manifest is not an output of the Rollup graph and pretending it is would make
 * it subject to `assetFileNames` and hashing.
 *
 * Attached to the content script config only. Both configs write into the same
 * directory and either could do it, but doing it in both would mean two writes
 * of the same bytes and a rebuild order that decides which one wins.
 */
export function manifestPlugin(target: Target): Plugin {
  const dir = outDir(target)

  return {
    name: 'rabbithole-manifest',
    closeBundle() {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest(target), null, 2)}\n`)
    },
  }
}
