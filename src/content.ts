import { detectPage } from './detect'
import { updatePanel } from './panel/mount'

function run(): void {
  updatePanel(detectPage(document, location.href))
}

run()

// GitHub navigates with Turbo, so the content script survives page changes
// without reinjection. Re-detect on every soft navigation.
document.addEventListener('turbo:load', run)
