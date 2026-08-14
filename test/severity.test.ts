// NOTE: these snippets are hand-built placeholders until the fixture capture
// script lands (v0.1). Committed fixtures must come from real public PRs, per
// test/fixtures/README.md.
import { describe, expect, it } from 'vitest'
import { parseTriple } from '../src/parse/severity'

function commentBody(html: string): Element {
  const el = document.createElement('div')
  el.className = 'comment-body'
  el.innerHTML = html
  return el
}

describe('parseTriple', () => {
  it('parses the emoji-prefixed triple', () => {
    const body = commentBody(
      '<p><em>🗄️ Data Integrity &amp; Integration</em> | <em>🟠 Major</em> | <em>⚡ Quick win</em></p>',
    )
    expect(parseTriple(body)).toEqual({
      category: 'Data Integrity & Integration',
      severity: 'major',
      effort: 'Quick win',
    })
  })

  it('returns null with fewer than three em elements', () => {
    expect(parseTriple(commentBody('<p><em>🟠 Major</em></p>'))).toBeNull()
  })

  it('returns null when the severity word is unrecognized', () => {
    const body = commentBody('<p><em>🧹 Style</em> | <em>🌀 Cosmic</em> | <em>⚡ Quick win</em></p>')
    expect(parseTriple(body)).toBeNull()
  })

  it('does not match severity words in prose, unlike a body-wide text search', () => {
    const body = commentBody('<p>This is a <em>major</em> refactor of the <em>critical</em> path, <em>minor</em> nit.</p>')
    // Three ems with a plausible severity word exist, but none carry the
    // emoji prefix that marks a real triple part.
    expect(parseTriple(body)).toBeNull()
  })
})
