import { describe, expect, it } from 'vitest'
import { detectPage, pullRequestKey } from '../src/detect'

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument()
  d.body.innerHTML = html
  return d
}

const PR_URL = 'https://github.com/owner/repo/pull/590'

describe('detectPage', () => {
  it('ignores non-PR pages', () => {
    expect(detectPage(doc(''), 'https://github.com/owner/repo')).toBe('not-pr')
  })

  it('ignores PR sub-routes like the Files tab', () => {
    expect(detectPage(doc(''), `${PR_URL}/files`)).toBe('not-pr')
  })

  it('accepts the conversation tab with query or hash', () => {
    expect(detectPage(doc('<div class="js-timeline-item"></div>'), `${PR_URL}?x=1`)).toBe('classic')
    expect(detectPage(doc('<div class="js-timeline-item"></div>'), `${PR_URL}#issuecomment-1`)).toBe('classic')
  })

  it('accepts a trailing slash, with or without query and hash', () => {
    expect(detectPage(doc('<div class="js-timeline-item"></div>'), `${PR_URL}/`)).toBe('classic')
    expect(detectPage(doc('<div class="js-timeline-item"></div>'), `${PR_URL}/?x=1`)).toBe('classic')
    expect(detectPage(doc('<div class="js-timeline-item"></div>'), `${PR_URL}/#issuecomment-1`)).toBe('classic')
  })

  it('detects the classic Rails timeline', () => {
    expect(detectPage(doc('<div class="js-timeline-item"></div>'), PR_URL)).toBe('classic')
  })

  // Hand built on purpose. A logged out session no longer serves the React
  // build, so there is no fixture to assert against; the shell selector below
  // was verified against a real React page on 11 August 2026. The rule that
  // actually protects a reader, an unrecognised build hides nothing, belongs to
  // the engine and does not depend on recognising React specifically.
  it('detects the React build as unsupported when the timeline is absent', () => {
    expect(detectPage(doc('<react-app app-name="pull-requests"></react-app>'), PR_URL)).toBe('react')
  })

  it('treats a timeline inside the React shell as classic', () => {
    // GitHub wraps the Rails-rendered timeline in the react-app shell too, so
    // the shell alone must not veto a timeline the parser can read.
    const html = '<react-app app-name="pull-requests"><div class="js-timeline-item"></div></react-app>'
    expect(detectPage(doc(html), PR_URL)).toBe('classic')
  })

  it('reports unknown when neither build is recognizable', () => {
    expect(detectPage(doc('<div></div>'), PR_URL)).toBe('unknown')
  })
})

/**
 * The engine's "am I still on the same page" question, which is not the
 * detector's "can I read this page" question. Every case here is a pair the two
 * answer differently, because that difference is the whole reason the second
 * function exists.
 */
describe('pullRequestKey', () => {
  it('is the pull request itself, with no tab in it', () => {
    expect(pullRequestKey(PR_URL)).toBe('owner/repo/pull/590')
  })

  it('is the same key on a tab the extension cannot read', () => {
    // `detectPage` calls these three `not-pr`. Treating them as a navigation
    // would clear the session on every trip to Files changed and back.
    for (const url of [`${PR_URL}/files`, `${PR_URL}/commits`, `${PR_URL}/checks`]) {
      expect(pullRequestKey(url)).toBe('owner/repo/pull/590')
    }
  })

  it('survives a trailing slash, a query and a hash', () => {
    for (const url of [`${PR_URL}/`, `${PR_URL}?x=1`, `${PR_URL}#issuecomment-1`]) {
      expect(pullRequestKey(url)).toBe('owner/repo/pull/590')
    }
  })

  it('is null anywhere that is not a pull request', () => {
    expect(pullRequestKey('https://github.com/owner/repo')).toBeNull()
    expect(pullRequestKey('https://github.com/owner/repo/issues/590')).toBeNull()
    expect(pullRequestKey('https://github.com/owner/repo/pulls')).toBeNull()
    expect(pullRequestKey('https://example.com/owner/repo/pull/590')).toBeNull()
  })

  it('separates two pull requests, in one repository or across two', () => {
    expect(pullRequestKey(PR_URL)).not.toBe(pullRequestKey('https://github.com/owner/repo/pull/591'))
    expect(pullRequestKey(PR_URL)).not.toBe(pullRequestKey('https://github.com/other/repo/pull/590'))
  })
})
