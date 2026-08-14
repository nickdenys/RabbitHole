import { describe, expect, it } from 'vitest'
import { detectPage } from '../src/detect'

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
