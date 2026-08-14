import { detectPage } from './detect'
import { isPanelMounted, updatePanel } from './panel/mount'
import type { PageKind } from './types'

const SETTLE_MS = 150

let lastKind: PageKind | null = null
let scheduled: ReturnType<typeof setTimeout> | undefined

function run(): void {
  const kind = detectPage(document, location.href)

  // Turbo can replace <body> and take the panel host with it, so a repeat
  // verdict still has to remount when the host is gone.
  const remountNeeded = kind !== 'not-pr' && !isPanelMounted()
  if (kind === lastKind && !remountNeeded) return

  lastKind = kind
  updatePanel(kind)
}

function scheduleRun(): void {
  if (scheduled !== undefined) return
  scheduled = setTimeout(() => {
    scheduled = undefined
    run()
  }, SETTLE_MS)
}

run()

// The Conversation timeline renders after document_idle, so the first pass can
// land on 'unknown' before any of it exists. Watching the document lets the
// verdict correct itself, and the observer stays connected because late loading
// threads matter to the hide engine too. Debounced, and updatePanel only runs
// when the verdict actually changes, so GitHub's own churn stays cheap.
new MutationObserver(scheduleRun).observe(document.documentElement, {
  childList: true,
  subtree: true,
})

// GitHub navigates with Turbo, so the content script survives page changes
// without reinjection. Re-detect on every soft navigation.
document.addEventListener('turbo:load', run)
