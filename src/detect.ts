import type { PageKind } from './types'

// Conversation tab only: /pull/N with no sub-route (files, commits, checks).
const PR_CONVERSATION_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[?#]|$)/

/**
 * GitHub is mid-rollout of a React rewrite of the Conversation page. The
 * classic Rails timeline is the only build this extension can read. The panel
 * must always distinguish "zero findings" from "could not read this page", so
 * unrecognized builds get an explicit unsupported state instead of an empty list.
 */
export function detectPage(doc: Document, url: string): PageKind {
  if (!PR_CONVERSATION_URL.test(url)) return 'not-pr'
  if (doc.querySelector('react-app[app-name="pull-requests"]')) return 'react'
  if (doc.querySelector('.js-timeline-item')) return 'classic'
  return 'unknown'
}
