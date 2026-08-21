/**
 * Fixture capture snippet.
 *
 * This is a console paste, not a Node script. The markup it captures only
 * exists behind your GitHub session, so there is nothing for Node to fetch.
 *
 * Usage:
 *
 *   1. Open a pull request's Conversation tab while LOGGED IN. A logged out
 *      session gets GitHub's React build, which is not the markup this
 *      extension parses, and a capture of it is worthless except as the
 *      deliberate `react-build.html` fixture.
 *   2. Paste this whole file into the devtools console.
 *   3. Run, for example:
 *
 *        captureFixture('unresolved-and-resolved')
 *
 *   4. Move the downloaded file into test/fixtures/public/ (or
 *      test/fixtures/private/ if the PR is not public), and record its source
 *      URL and capture date in test/fixtures/README.md.
 *
 * What it captures: the PARENT of the first `.js-timeline-item`, cloned. Taking
 * the parent is derived from the page rather than guessed at, so it survives
 * GitHub renaming its timeline container.
 *
 * What it strips: every `<script>`, and the value of any CSRF token input, so a
 * committed fixture carries no session secret. Both walks descend into
 * `<template>` content, which `querySelectorAll` does not reach on its own; see
 * `scrub`. Nothing else is touched, because every attribute is potentially a
 * selector some later step depends on.
 *
 * It throws rather than downloading if a token survives, because a fixture is
 * committed and a leak cannot be taken back.
 */
globalThis.captureFixture = function captureFixture(name) {
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error('Pass a kebab-case fixture name, e.g. captureFixture("unresolved-and-resolved")')
  }

  const firstItem = document.querySelector('.js-timeline-item')
  const container = firstItem ? firstItem.parentElement : document.querySelector('react-app[app-name="pull-requests"]')

  if (!container) {
    throw new Error(
      'Found neither a .js-timeline-item nor the react-app shell. This is not a PR Conversation tab, or the page has not finished loading.',
    )
  }
  if (!firstItem) {
    console.warn('[capture] No timeline found. Capturing the React shell instead. This is only useful as the react-build.html fixture.')
  }

  const clone = container.cloneNode(true)

  const scrubbed = scrub(clone)

  if (scrubbed.leaked > 0) {
    throw new Error(
      `[capture] ${scrubbed.leaked} CSRF token(s) survived redaction. Refusing to build the file. Fix scrub() before capturing again.`,
    )
  }

  const capturedOn = new Date().toISOString().slice(0, 10)
  const html = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<!-- captured from ${document.location.href} on ${capturedOn} -->`,
    '</head>',
    '<body>',
    clone.outerHTML,
    '</body>',
    '</html>',
    '',
  ].join('\n')

  // Kept on the function so you can `copy(captureFixture.last)` if the download
  // is blocked, or diff two captures without leaving the page.
  captureFixture.last = html

  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name}.html`
  anchor.click()
  URL.revokeObjectURL(url)

  const summary = {
    name: `${name}.html`,
    url: document.location.href,
    capturedOn,
    kilobytes: Math.round(html.length / 1024),
    scriptsRemoved: true,
    csrfTokensRedacted: scrubbed.redacted,
    csrfTokensInTemplates: scrubbed.inTemplates,
    counts: count(clone),
  }
  console.log('[capture]', summary)
  console.log('[capture] Record the URL and date in test/fixtures/README.md. If no download appeared, run copy(captureFixture.last)')
  return summary
}

/**
 * Remove the scripts and blank the CSRF tokens, everywhere they can hide.
 *
 * **The bug this exists to close:** `querySelectorAll` does not descend into a
 * `<template>`. Its children are not in the document tree at all, they are in a
 * separate `content` fragment, so a selector run on the clone walks straight
 * past them. GitHub renders its inline comment form inside templates, one per
 * thread, each carrying a live `authenticity_token`. On 21 August 2026 the
 * capture of `nickdenys/optios-booking#1` came out with 95 tokens redacted and
 * 9 untouched, all 9 inside templates, and the same gap put 10 live tokens into
 * the fixture committed on 20 August.
 *
 * A token is a session secret. It is scoped to one session and expires with it,
 * so this is not on the level of a leaked access token, but it has no business
 * in a committed file and a fixture cannot be un-committed once pushed.
 *
 * The walk is recursive because a template may hold a template. `leaked` is the
 * count that must be zero afterwards, checked by the caller against the raw
 * text rather than trusted, so a future GitHub hiding place fails the capture
 * instead of shipping.
 */
function scrub(root) {
  let redacted = 0
  let inTemplates = 0

  function walk(node, depth) {
    for (const script of node.querySelectorAll('script')) script.remove()

    for (const input of node.querySelectorAll(
      'input[name="authenticity_token"], input[name="csrf_token"]',
    )) {
      input.setAttribute('value', 'REDACTED')
      redacted++
      if (depth > 0) inTemplates++
    }

    for (const template of node.querySelectorAll('template')) walk(template.content, depth + 1)
  }

  walk(root, 0)

  // Belt and braces: count what is left in the serialised text, which is what
  // actually reaches disk. A hiding place this function does not know about
  // shows up here rather than in the committed file.
  const live = (root.outerHTML ?? '').match(
    /<input[^>]*(?:authenticity_token|csrf_token)[^>]*>/g,
  )
  const leaked = (live ?? []).filter((tag) => !tag.includes('REDACTED')).length

  return { redacted, inTemplates, leaked }
}

/**
 * The numbers you need to hand count a fixture against. Every step from A2 on
 * asserts against a hand count, and counting here beats counting later from the
 * saved file, because right now you can still see the page they came from.
 */
function count(root) {
  const threads = [...root.querySelectorAll('review-thread-collapsible')]
  const isCodeRabbit = (el) => el.querySelector('a.author[href="/apps/coderabbitai"]') !== null

  return {
    timelineItems: root.querySelectorAll('.js-timeline-item').length,
    threads: threads.length,
    threadsResolved: threads.filter((t) => t.getAttribute('data-resolved') === 'true').length,
    threadsWithDeferredUrl: threads.filter((t) => t.hasAttribute('data-deferred-content-url')).length,
    threadsWithBody: threads.filter((t) => t.querySelector('.comment-body') !== null).length,
    threadsWithCodeRabbit: threads.filter(isCodeRabbit).length,
    codeRabbitAuthorLinks: root.querySelectorAll('a.author[href="/apps/coderabbitai"]').length,
    outdatedLabels: [...root.querySelectorAll('.Label')].filter((l) => /outdated/i.test(l.textContent ?? '')).length,
    pendingText: /pending in batch/i.test(root.textContent ?? ''),
  }
}
