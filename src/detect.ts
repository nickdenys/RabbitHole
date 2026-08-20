import type { PageKind } from './types'

// Conversation tab only: /pull/N with no sub-route (files, commits, checks).
// A trailing slash is still the Conversation tab, so it has to pass.
const PR_CONVERSATION_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/?(?:[?#]|$)/

// The same pull request, whichever of its tabs is showing. Deliberately wider
// than the rule above, because the two answer different questions: one asks
// "can this page be read", the other asks "is this still the same pull
// request". The Files tab is not readable and is not a different pull request.
const PULL_REQUEST_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+\/pull\/\d+)(?:[/?#]|$)/

/**
 * GitHub is mid-rollout of a React rewrite of the Conversation page. The
 * classic Rails timeline is the only build this extension can read. The panel
 * must always distinguish "zero findings" from "could not read this page", so
 * unrecognized builds get an explicit unsupported state instead of an empty list.
 *
 * The timeline is checked first because GitHub wraps Rails-rendered timelines
 * in the `react-app` shell as well, so the shell alone proves nothing. The
 * timeline markup is what the parser reads, so its presence is the verdict.
 * A PR with no review threads still has timeline items, which is why this keys
 * off `.js-timeline-item` rather than the thread elements.
 */
export function detectPage(doc: Document, url: string): PageKind {
  if (!PR_CONVERSATION_URL.test(url)) return 'not-pr'
  if (doc.querySelector('.js-timeline-item')) return 'classic'
  if (doc.querySelector('react-app[app-name="pull-requests"]')) return 'react'
  return 'unknown'
}

/**
 * Which pull request this URL belongs to, or null when it is not one.
 *
 * `owner/repo/pull/N`, and nothing about the tab: the Conversation and Files
 * views of one pull request give the same key, and two pull requests never do.
 * The engine watches this to know when it has arrived somewhere new, so what it
 * ignores matters as much as what it captures. A tab change must not read as a
 * navigation, or a round trip to Files changed would throw away everything the
 * reader has done; a different pull request must, or its findings would be
 * merged with the last one's.
 */
export function pullRequestKey(url: string): string | null {
  return PULL_REQUEST_URL.exec(url)?.[1] ?? null
}
