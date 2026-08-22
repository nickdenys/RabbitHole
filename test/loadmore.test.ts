import { describe, expect, it } from 'vitest'
import { clickLoadMore } from '../src/loadmore'

/** GitHub's own control, either shape: a count button and a "Load more…" one. */
function control(id: string, disabled = false): string {
  return `
    <form id="${id}" class="ajax-pagination-form js-ajax-pagination">
      <button type="submit">N hidden conversations</button>
      <button type="submit" data-disable-with="Loading…" ${disabled ? 'disabled' : ''}>Load more…</button>
    </form>`
}

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument()
  d.body.innerHTML = html
  return d
}

describe('clickLoadMore', () => {
  it('clicks the "Load more…" button, not the one beside it', () => {
    const d = doc(control('a'))
    const clicks: string[] = []
    for (const button of d.querySelectorAll('button')) {
      button.addEventListener('click', () => clicks.push(button.textContent ?? ''))
    }

    const clicked = clickLoadMore(d)

    expect(clicked).toBe(1)
    expect(clicks).toEqual(['Load more…'])
  })

  it('clicks every control on the page, not only the first', () => {
    const d = doc(control('a') + control('b'))

    expect(clickLoadMore(d)).toBe(2)
  })

  it('skips a control whose button is already mid-request', () => {
    const d = doc(control('a', true))
    const clicks: string[] = []
    d.querySelector('[data-disable-with]')!.addEventListener('click', () => clicks.push('clicked'))

    expect(clickLoadMore(d)).toBe(0)
    expect(clicks).toEqual([])
  })

  it('does nothing on a page with no such control', () => {
    const d = doc('<div class="js-timeline-item">ordinary content</div>')

    expect(clickLoadMore(d)).toBe(0)
  })

  it('does nothing to a form of this class with no "Load more" button in it', () => {
    // Defensive: nothing in the real markup produces this, but a caller must
    // never throw on a page shape it has not seen yet.
    const d = doc('<form class="ajax-pagination-form"><button type="submit">Something else</button></form>')

    expect(clickLoadMore(d)).toBe(0)
  })
})
