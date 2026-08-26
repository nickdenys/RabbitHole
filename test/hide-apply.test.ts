import { beforeEach, describe, expect, it } from 'vitest'
import { applyHiding, isHidden, reveal, revealAll, unreveal } from '../src/hide/apply'
import { hideVerdict, type HideMode } from '../src/hide/policy'
import { scanNotes } from '../src/parse/notes'
import { scanThreads } from '../src/parse/thread'
import { loadFixture } from './support/fixture'

const HIDDEN = '.rh-hidden'
const STYLE_ID = 'rabbithole-style'

/**
 * The module keeps two pieces of state, the reveal set and the last applied
 * targets, because a reveal has to survive the next pass and take effect
 * without waiting for it. Both belong to a page, so every test starts from a
 * torn down one rather than inheriting the previous test's reveals.
 */
beforeEach(() => {
  revealAll(document)
})

/** One review's timeline item: an optional note row, then `threads` thread rows. */
function item(threads: number, note = false): string {
  const rows = Array.from(
    { length: threads },
    (_, i) => `
      <div class="TimelineItem">
        <review-thread-collapsible id="thread-${i}">
          <div class="timeline-comment-group">thread ${i}</div>
        </review-thread-collapsible>
      </div>`,
  ).join('')

  const summary = note
    ? `<div class="TimelineItem" id="note"><div class="timeline-comment-group">summary</div></div>`
    : ''

  return `<div class="js-timeline-item">${summary}${rows}</div>`
}

/** Same shape as `item`, plus GitHub's "there is more" control among the threads. */
function itemWithMoreControl(threads: number): string {
  const rows = Array.from(
    { length: threads },
    (_, i) => `
      <div class="TimelineItem">
        <review-thread-collapsible id="thread-${i}">
          <div class="timeline-comment-group">thread ${i}</div>
        </review-thread-collapsible>
      </div>`,
  ).join('')

  return `<div class="js-timeline-item">${rows}<form id="more-control" class="ajax-pagination-form">N hidden conversations</form></div>`
}

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument()
  d.body.innerHTML = html
  return d
}

function hidden(d: Document): string[] {
  return [...d.querySelectorAll(HIDDEN)].map(
    (el) => el.id || el.className.replace('rh-hidden', '').trim(),
  )
}

function threads(d: Document): Element[] {
  return [...d.querySelectorAll('review-thread-collapsible')]
}

describe('applyHiding', () => {
  it('hides the timeline item when every thread and comment in it is a target', () => {
    const d = doc(item(3))

    applyHiding(threads(d), d)

    expect(d.querySelectorAll(HIDDEN)).toHaveLength(1)
    expect(hidden(d)).toEqual(['js-timeline-item'])
  })

  it('hides the threads themselves when one of them stays', () => {
    const d = doc(item(3))
    const [first, second] = threads(d)

    applyHiding([first, second], d)

    expect(hidden(d)).toEqual(['thread-0', 'thread-1'])
  })

  it('leaves the item alone when it also holds a comment nobody named', () => {
    // Four single-thread items in the fixtures are this shape: one CodeRabbit
    // thread beside the summary of the review that posted it. Hiding the item
    // would take a comment the caller never proved anything about.
    const d = doc(item(1, true))

    applyHiding(threads(d), d)

    expect(hidden(d)).toEqual(['thread-0'])
  })

  it('hides the item once the note is named too', () => {
    const d = doc(item(1, true))
    const note = d.getElementById('note')!

    applyHiding([...threads(d), note], d)

    expect(hidden(d)).toEqual(['js-timeline-item'])
  })

  it('leaves the item alone when it holds GitHub\'s own "more" control, even with every rendered thread targeted', () => {
    // The bug this closes: a review posting more threads than GitHub renders
    // up front carries a `form.ajax-pagination-form` beside the ones it did
    // render. Every rendered thread being CodeRabbit's used to collapse the
    // whole item, taking GitHub's own "N hidden conversations" button with it,
    // so a reader had no way to load the rest and no warning ever told them.
    const d = doc(itemWithMoreControl(3))

    applyHiding(threads(d), d)

    expect(hidden(d)).toEqual(['thread-0', 'thread-1', 'thread-2'])
    expect(d.getElementById('more-control')?.closest(HIDDEN)).toBe(null)
  })

  it('does nothing the second time', () => {
    const d = doc(item(3) + item(2, true))
    const targets = threads(d)

    applyHiding(targets, d)
    const first = d.body.innerHTML

    applyHiding(targets, d)

    expect(d.body.innerHTML).toBe(first)
  })

  it('reveals what has left the target list', () => {
    // How a mode toggle takes effect, and why the pass owns the whole hidden
    // set rather than only adding to it.
    const d = doc(item(3))
    const all = threads(d)

    applyHiding(all, d)
    applyHiding(all.slice(0, 2), d)

    expect(hidden(d)).toEqual(['thread-0', 'thread-1'])
  })

  it('writes one stylesheet, and puts it back when it is removed', () => {
    const d = doc(item(1))

    applyHiding(threads(d), d)
    applyHiding(threads(d), d)

    expect(d.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1)
    expect(d.getElementById(STYLE_ID)?.textContent).toContain('display: none !important')

    d.getElementById(STYLE_ID)!.remove()
    applyHiding(threads(d), d)

    expect(d.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1)
  })
})

describe('reveal', () => {
  it('keeps a thread visible through the next pass', () => {
    const d = doc(item(3))
    const targets = threads(d)

    applyHiding(targets, d)
    reveal(targets[1])
    applyHiding(targets, d)

    expect(targets[1].closest(HIDDEN)).toBe(null)
  })

  it('re-hides the siblings individually when the whole item was hidden', () => {
    // The revealed thread has no class of its own to remove, because the item
    // carried it. Reversing that has to put the siblings back one at a time or
    // revealing one thread reveals the review.
    const d = doc(item(3))
    const targets = threads(d)

    applyHiding(targets, d)
    reveal(targets[1])

    expect(hidden(d)).toEqual(['thread-0', 'thread-2'])
  })

  it('is per element, so revealing one thread leaves the other reviews hidden', () => {
    const d = doc(item(2) + item(2))
    const targets = threads(d)

    applyHiding(targets, d)
    reveal(targets[0])

    expect(targets[1].closest(HIDDEN)).not.toBe(null)
    expect(targets[2].closest(HIDDEN)).not.toBe(null)
  })
})

describe('unreveal', () => {
  it('puts a revealed thread back where the last pass wanted it', () => {
    const d = doc(item(3))
    const targets = threads(d)

    applyHiding(targets, d)
    reveal(targets[1])
    unreveal(targets[1])

    expect(isHidden(targets[1])).toBe(true)
  })

  // Reversing a reveal has to reverse the individual re-hiding it caused, or
  // the review stays as three hidden threads where it was one hidden item, and
  // a second reveal would be reversing a different page.
  it('collapses the review back into one hidden element', () => {
    const d = doc(item(3))
    const targets = threads(d)

    applyHiding(targets, d)
    reveal(targets[1])
    unreveal(targets[1])

    expect(hidden(d)).toEqual(['js-timeline-item'])
  })

  // The reveal set is what a later pass consults, so an undo that only took the
  // class off would come back the next time anything on the page changed.
  it('lets the next pass hide it again on its own', () => {
    const d = doc(item(3))
    const targets = threads(d)

    applyHiding(targets, d)
    reveal(targets[1])
    unreveal(targets[1])
    applyHiding(targets, d)

    expect(hidden(d)).toEqual(['js-timeline-item'])
  })

  // Nothing here decides what may be hidden, so an element the last pass never
  // named cannot be hidden by dropping a reveal of it.
  it('cannot hide an element the last pass did not name', () => {
    const d = doc(item(2) + item(2))
    const targets = threads(d)

    applyHiding([targets[0], targets[1]], d)
    unreveal(targets[2])

    expect(isHidden(targets[2])).toBe(false)
  })
})

describe('isHidden', () => {
  it('is true for a thread whose whole timeline item carries the class', () => {
    const d = doc(item(2))
    const targets = threads(d)

    applyHiding(targets, d)

    expect(targets[0].classList.contains('rh-hidden')).toBe(false)
    expect(isHidden(targets[0])).toBe(true)
  })

  it('is false before anything is applied and after it is all reversed', () => {
    const d = doc(item(2))
    const targets = threads(d)

    expect(isHidden(targets[0])).toBe(false)

    applyHiding(targets, d)
    revealAll(d)

    expect(isHidden(targets[0])).toBe(false)
  })
})

describe('revealAll', () => {
  it('restores the document to what it looked like before the first pass', () => {
    const d = doc(item(3) + item(2, true))
    const before = d.documentElement.outerHTML

    applyHiding([...threads(d), d.getElementById('note')!], d)
    revealAll(d)

    expect(d.documentElement.outerHTML).toBe(before)
  })

  it('forgets the reveals, so the next pass hides everything again', () => {
    const d = doc(item(3))
    const targets = threads(d)

    applyHiding(targets, d)
    reveal(targets[1])
    revealAll(d)
    applyHiding(targets, d)

    expect(hidden(d)).toEqual(['js-timeline-item'])
  })
})

/**
 * Elements carrying the class, per fixture and mode, measured 20 August 2026.
 *
 * The number is smaller than the target count because a review whose threads
 * all go hides as one element. `resolvable.html` is the extreme: 13 targets,
 * 3 elements, one per review plus the walkthrough. `pending-in-batch.html` is
 * the other end, 14 targets as 13 elements, because a pending comment keeps a
 * thread on the page and so keeps its review's item on the page too.
 *
 * The counts move whenever the collapse rule does, which is the point of
 * pinning them. That nothing *wrong* is hidden is asserted separately, over
 * every fixture and both modes, in `invariants.test.ts`.
 */
const APPLIED = {
  'unresolved-and-resolved': { targets: 7, safe: 6, aggressive: 6 },
  'human-replies': { targets: 25, safe: 12, aggressive: 22 },
  'pending-in-batch': { targets: 14, safe: 13, aggressive: 13 },
  'no-coderabbit': { targets: 0, safe: 0, aggressive: 0 },
  'resolvable': { targets: 12, safe: 8, aggressive: 8 },
} as const

// Parsed once and shared, as in the other fixture tests: human-replies.html is
// 8.3 MB and re-parsing it per case exhausts the test worker. Each case undoes
// its own writes with `revealAll`, which restores the document exactly.
const docs = Object.fromEntries(
  Object.keys(APPLIED).map((name) => [name, loadFixture(name)]),
) as Record<keyof typeof APPLIED, Document>

describe('over the fixtures', () => {
  for (const [name, counts] of Object.entries(APPLIED)) {
    for (const mode of ['safe', 'aggressive'] as HideMode[]) {
      it(`hides ${counts.targets} targets on ${name}.html as ${counts[mode]} elements in ${mode} mode`, () => {
        const d = docs[name as keyof typeof APPLIED]

        try {
          applyHiding(targetsFor(d, mode), d)

          expect(d.querySelectorAll(HIDDEN)).toHaveLength(counts[mode])
        } finally {
          revealAll(d)
        }
      })
    }
  }

  it('leaves the page untouched when nothing in it is CodeRabbit\'s', () => {
    const d = docs['no-coderabbit']
    const before = d.body.innerHTML

    applyHiding(targetsFor(d, 'aggressive'), d)

    expect(d.body.innerHTML).toBe(before)
    expect(targetsFor(d, 'aggressive')).toEqual([])
  })
})

/** What the A8 engine loop will pass: hideable threads, plus both kinds of note. */
function targetsFor(d: Document, mode: HideMode): Element[] {
  return [
    ...scanThreads(d)
      .filter((thread) => hideVerdict(thread, mode).hide)
      .map((thread) => thread.el),
    ...scanNotes(d).map((note) => note.el),
  ]
}
