import { beforeEach, describe, expect, it, vi } from 'vitest'
import { followAnchor, forgetAnchor } from '../src/anchor'
import { applyHiding, revealAll, unreveal } from '../src/hide/apply'
import { loadFixture } from './support/fixture'

const PR = 'https://github.com/owner/repo/pull/1'
const HIDDEN = '.rh-hidden'

/**
 * Both modules keep state that belongs to a page: the reveal set and the last
 * applied targets in `hide/apply`, the anchored fragment here. Every case
 * starts from a page nobody has read.
 */
beforeEach(() => {
  revealAll(document)
  forgetAnchor()
})

/**
 * `DOMParser` rather than `createHTMLDocument`, because a parsed document has a
 * `defaultView` and that is what the offset the anchor is held at is read from.
 * A document with no window is its own case, at the bottom of this file.
 */
function page(html: string): Document {
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html')
}

/** One review's timeline item, holding two of CodeRabbit's threads. */
function timeline(): string {
  return `
    <div class="js-timeline-item">
      <review-thread-collapsible id="thread-1">
        <div class="timeline-comment-group" id="discussion_r111">first finding</div>
      </review-thread-collapsible>
      <review-thread-collapsible id="thread-2">
        <div class="timeline-comment-group" id="discussion_r222">second finding</div>
      </review-thread-collapsible>
    </div>`
}

/** The elements a pass would hand `applyHiding`: every thread in the page. */
function threads(doc: Document): Element[] {
  return [...doc.querySelectorAll('review-thread-collapsible')]
}

function hidden(doc: Document, id: string): boolean {
  return doc.getElementById(id)?.closest(HIDDEN) !== null
}

/**
 * Watch one element's scrolling, in place. The anchor re-reads the element off
 * the document on every pass, so an instance property is seen by all of them.
 */
function watchScroll(el: Element): ReturnType<typeof vi.fn> {
  const spy = vi.fn()
  ;(el as unknown as { scrollIntoView: unknown }).scrollIntoView = spy
  return spy
}

/** Move the page under the anchor, which is how the reader takes it over. */
function scrolledTo(doc: Document, offset: number): void {
  Object.defineProperty(doc.defaultView, 'scrollY', { get: () => offset, configurable: true })
}

describe('a link to one comment', () => {
  it('takes the thread it names back out of the hidden set', () => {
    const doc = page(timeline())
    const targets = threads(doc)
    applyHiding(targets, doc)

    expect(hidden(doc, 'discussion_r111')).toBe(true)

    followAnchor(doc, `${PR}#discussion_r111`, targets)

    expect(hidden(doc, 'discussion_r111')).toBe(false)
  })

  it('scrolls to it, because a revealed comment nobody can find is not a link that worked', () => {
    const doc = page(timeline())
    const targets = threads(doc)
    const scrolled = watchScroll(doc.getElementById('discussion_r111')!)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    expect(scrolled).toHaveBeenCalledTimes(1)
  })

  it('leaves every other thread exactly where the policy put it', () => {
    const doc = page(timeline())
    const targets = threads(doc)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    expect(hidden(doc, 'discussion_r222')).toBe(true)
  })

  it('survives the passes that come after it, like any other reveal', () => {
    const doc = page(timeline())
    const targets = threads(doc)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r111`, targets)
    applyHiding(targets, doc)
    applyHiding(targets, doc)

    expect(hidden(doc, 'discussion_r111')).toBe(false)
  })

  it('never hides anything itself', () => {
    const doc = page(timeline())

    followAnchor(doc, `${PR}#discussion_r111`, [])

    expect(doc.querySelectorAll(HIDDEN)).toHaveLength(0)
  })
})

describe('a link the page cannot answer yet', () => {
  it('is left alone, so nothing is revealed on a guess', () => {
    const doc = page(timeline())
    const targets = threads(doc)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r999`, targets)

    expect(doc.querySelectorAll(HIDDEN)).toHaveLength(1)
  })

  it('anchors on the pass that finally renders it', () => {
    const doc = page(timeline())
    applyHiding(threads(doc), doc)
    followAnchor(doc, `${PR}#discussion_r333`, threads(doc))

    // GitHub answered a "Load more", the way it does on a long conversation.
    doc.querySelector('.js-timeline-item')!.insertAdjacentHTML(
      'beforeend',
      `<review-thread-collapsible id="thread-3">
         <div class="timeline-comment-group" id="discussion_r333">late finding</div>
       </review-thread-collapsible>`,
    )

    const late = threads(doc)
    applyHiding(late, doc)
    const scrolled = watchScroll(doc.getElementById('discussion_r333')!)
    followAnchor(doc, `${PR}#discussion_r333`, late)

    expect(hidden(doc, 'discussion_r333')).toBe(false)
    expect(scrolled).toHaveBeenCalledTimes(1)
  })
})

describe('a link to a finding somebody has since resolved', () => {
  /**
   * A resolved thread is collapsed and its comments are not in the page at all,
   * so the fragment names nothing. The stub carries the ids it is holding, which
   * is the only route left to it.
   */
  const collapsed = `
    <div class="js-timeline-item">
      <review-thread-collapsible
        id="thread-9"
        data-resolved="true"
        data-hidden-comment-ids="3718910202,3718910300"
        data-deferred-content-url="/owner/repo/pull/1/threads/2526327885"></review-thread-collapsible>
    </div>`

  it('scrolls to the collapsed thread standing in for it', () => {
    const doc = page(collapsed)
    const targets = threads(doc)
    const scrolled = watchScroll(targets[0])

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r3718910202`, targets)

    expect(doc.getElementById('thread-9')!.closest(HIDDEN)).toBeNull()
    expect(scrolled).toHaveBeenCalledTimes(1)
  })

  it('matches one id of the comma separated list rather than the list as a string', () => {
    const doc = page(collapsed)
    const targets = threads(doc)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r3718910300`, targets)

    expect(doc.getElementById('thread-9')!.closest(HIDDEN)).toBeNull()
  })

  it('is not confused by an id that is only a prefix of one', () => {
    const doc = page(collapsed)
    const targets = threads(doc)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r371891020`, targets)

    expect(doc.getElementById('thread-9')!.closest(HIDDEN)).not.toBeNull()
  })
})

describe('holding the anchor while the page grows under it', () => {
  it('scrolls again on a later pass, because "Load more" lands above it', () => {
    const doc = page(timeline())
    const targets = threads(doc)
    const scrolled = watchScroll(doc.getElementById('discussion_r111')!)
    scrolledTo(doc, 0)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r111`, targets)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    expect(scrolled).toHaveBeenCalledTimes(2)
  })

  it('stops the moment the reader scrolls, and stays stopped', () => {
    const doc = page(timeline())
    const targets = threads(doc)
    const scrolled = watchScroll(doc.getElementById('discussion_r111')!)
    scrolledTo(doc, 0)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    scrolledTo(doc, 800)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    scrolledTo(doc, 0)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    expect(scrolled).toHaveBeenCalledTimes(1)
  })

  it('stops when the reader puts the thread back out of the timeline', () => {
    const doc = page(timeline())
    const targets = threads(doc)
    const scrolled = watchScroll(doc.getElementById('discussion_r111')!)
    scrolledTo(doc, 0)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    // What the row's title does on a second press.
    unreveal(targets[0])
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    expect(hidden(doc, 'discussion_r111')).toBe(true)
    expect(scrolled).toHaveBeenCalledTimes(1)
  })

  it('waits out a thread GitHub is re-rendering rather than giving up on it', () => {
    const doc = page(timeline())
    const targets = threads(doc)
    scrolledTo(doc, 0)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    // GitHub swaps a thread's partial in place on resolve, so the comment is
    // briefly absent and then back.
    const comment = doc.getElementById('discussion_r111')!
    const parent = comment.parentElement!
    comment.remove()
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    parent.append(comment)
    const scrolled = watchScroll(comment)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    expect(scrolled).toHaveBeenCalledTimes(1)
  })
})

describe('the fragment itself', () => {
  it('is nothing to do on a URL without one', () => {
    const doc = page(timeline())
    const targets = threads(doc)
    const scrolled = watchScroll(doc.getElementById('discussion_r111')!)

    applyHiding(targets, doc)
    followAnchor(doc, PR, targets)

    expect(hidden(doc, 'discussion_r111')).toBe(true)
    expect(scrolled).not.toHaveBeenCalled()
  })

  it('anchors again after the reader navigated away from it and back', () => {
    const doc = page(timeline())
    const targets = threads(doc)
    const scrolled = watchScroll(doc.getElementById('discussion_r111')!)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r111`, targets)
    followAnchor(doc, PR, targets)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    expect(scrolled).toHaveBeenCalledTimes(2)
  })

  it('follows a second link on the same page', () => {
    const doc = page(timeline())
    const targets = threads(doc)
    const second = watchScroll(doc.getElementById('discussion_r222')!)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r111`, targets)
    followAnchor(doc, `${PR}#discussion_r222`, targets)

    expect(hidden(doc, 'discussion_r111')).toBe(false)
    expect(hidden(doc, 'discussion_r222')).toBe(false)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('names whatever the reader linked to, not only a review comment', () => {
    const doc = page(`
      <div class="js-timeline-item" id="note">
        <div class="timeline-comment-group" id="issuecomment-42">walkthrough</div>
      </div>`)
    const targets = [doc.getElementById('note')!]

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#issuecomment-42`, targets)

    expect(hidden(doc, 'issuecomment-42')).toBe(false)
  })

  it('is read from the URL it is given, so a malformed one is simply no anchor', () => {
    const doc = page(timeline())
    const targets = threads(doc)

    applyHiding(targets, doc)
    followAnchor(doc, 'not a url at all', targets)

    expect(hidden(doc, 'discussion_r111')).toBe(true)
  })

  it('survives an escape that will not decode', () => {
    const doc = page(`<div class="js-timeline-item" id="odd"><span id="100%">x</span></div>`)
    const targets = [doc.getElementById('odd')!]

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#100%`, targets)

    expect(doc.getElementById('100%')!.closest(HIDDEN)).toBeNull()
  })

  it('anchors again after the engine forgot the page', () => {
    const doc = page(timeline())
    const targets = threads(doc)
    const scrolled = watchScroll(doc.getElementById('discussion_r111')!)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    // What the engine does on the way to a build it cannot read, and back.
    revealAll(doc)
    forgetAnchor()
    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    expect(hidden(doc, 'discussion_r111')).toBe(false)
    expect(scrolled).toHaveBeenCalledTimes(2)
  })
})

describe('a document with no window', () => {
  /**
   * Only a test builds one, but it is the case that decides what happens when
   * the offset cannot be read at all: anchor once, then leave the page alone
   * rather than scroll it on every pass forever.
   */
  it('is anchored once and then left alone', () => {
    const doc = document.implementation.createHTMLDocument()
    doc.body.innerHTML = timeline()
    const targets = threads(doc)
    const scrolled = watchScroll(doc.getElementById('discussion_r111')!)

    applyHiding(targets, doc)
    followAnchor(doc, `${PR}#discussion_r111`, targets)
    followAnchor(doc, `${PR}#discussion_r111`, targets)

    expect(hidden(doc, 'discussion_r111')).toBe(false)
    expect(scrolled).toHaveBeenCalledTimes(1)
  })
})

/**
 * The two cheapest captures rather than all five. What is under test here is
 * GitHub's real markup for the two routes a fragment can take, and these hold
 * both: `no-coderabbit.html` is the one small fixture with a collapsed thread
 * holding several comments, and `unresolved-and-resolved.html` has rendered
 * comments with their own permalinks. The 8.3 MB capture would add minutes to
 * the suite to answer the same question a third time.
 */
describe.each(['no-coderabbit', 'unresolved-and-resolved'])('over %s', (name) => {
  let doc: Document

  beforeEach(() => {
    doc = loadFixture(name)
  })

  it('finds the collapsed thread standing in for every comment it is holding', () => {
    const collapsed = [...doc.querySelectorAll('review-thread-collapsible[data-hidden-comment-ids]')]
    expect(collapsed.length).toBeGreaterThan(0)

    for (const thread of collapsed) {
      for (const id of thread.getAttribute('data-hidden-comment-ids')!.split(',')) {
        // A reveal outlives every pass by design, so each id starts from a
        // page nobody has followed a link into. Two ids of one thread would
        // otherwise measure the first id's reveal twice.
        revealAll(doc)
        forgetAnchor()
        applyHiding([thread], doc)
        expect(thread.closest(HIDDEN), `${name} comment ${id}, before`).not.toBeNull()

        followAnchor(doc, `${PR}#discussion_r${id}`, [thread])
        expect(thread.closest(HIDDEN), `${name} comment ${id}`).toBeNull()
      }
    }
  })

  it('follows the permalink CodeRabbit renders on a comment back to its thread', () => {
    const links = [...doc.querySelectorAll('a.js-timestamp[href*="#discussion_r"]')]
    expect(links.length).toBeGreaterThan(0)

    for (const link of links) {
      const thread = link.closest('review-thread-collapsible')
      if (thread === null) continue

      revealAll(doc)
      forgetAnchor()
      applyHiding([thread], doc)
      expect(thread.closest(HIDDEN), `${name} ${link.getAttribute('href')}, before`).not.toBeNull()

      followAnchor(doc, `${PR}${link.getAttribute('href')}`, [thread])
      expect(thread.closest(HIDDEN), `${name} ${link.getAttribute('href')}`).toBeNull()
    }
  })
})
