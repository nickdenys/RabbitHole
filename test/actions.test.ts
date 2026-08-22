import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TriageRow } from '../src/engine'
import { applyHiding, revealAll } from '../src/hide/apply'
import {
  copyPrompt,
  forgetSessionFindings,
  resolveThread,
  sessionFinding,
  showsInTimeline,
  toggleInTimeline,
  unresolveThread,
} from '../src/panel/actions'
import { listedRows, unreadCount } from '../src/panel/rows'
import { scanThreads } from '../src/parse/thread'
import type { Finding, Thread } from '../src/types'
import { loadFixture } from './support/fixture'

const HIDDEN = '.crt-hidden'

/**
 * Both modules under test keep page-lifetime state: `hide/apply` holds the
 * reveal set and the last applied targets, `actions` holds the session
 * findings. Both belong to one page, so every case starts from a torn down one.
 */
beforeEach(() => {
  revealAll(document)
  forgetSessionFindings()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument()
  d.body.innerHTML = html
  return d
}

const FINDING: Finding = {
  title: 'Guard against a null user',
  category: 'Potential issue',
  severity: 'major',
  effort: '~10 minutes',
  aiPrompt: 'In src/app.ts around line 12,\nguard the null case.',
  permalink: '#discussion_r1',
}

/**
 * A row over a real element, because every action here reaches into the page.
 * `finding` defaults to a complete one so a case that cares about the prompt or
 * the cache does not have to restate it.
 */
function rowOver(
  el: Element,
  over: { thread?: Partial<Thread>; finding?: Finding | null } = {},
): TriageRow {
  const thread: Thread = {
    el,
    timelineItem: el.closest('.js-timeline-item'),
    id: 'thread-1',
    file: 'src/app.ts',
    resolved: false,
    outdated: false,
    collapsed: false,
    deferredUrl: null,
    authors: null,
    problems: [],
    ...over.thread,
  }

  return {
    thread,
    finding: over.finding === undefined ? FINDING : over.finding,
    verdict: { hide: true },
  }
}

/** GitHub's own markup, trimmed to what the selector has to walk. */
function resolvableThread(action = '/owner/repo/pull/1/threads/2596022521/resolve'): string {
  return `
    <review-thread-collapsible id="thread-1" data-resolved="false">
      <form action="/owner/repo/pull/1/review_comment/create" method="post">
        <button type="submit" class="review-simple-reply-button">Comment</button>
      </form>
      <form class="js-resolvable-timeline-thread-form" data-turbo="false" action="${action}" method="post">
        <button type="submit" class="Button--secondary">
          <span class="Button-content"><span class="Button-label">Resolve conversation</span></span>
        </button>
      </form>
    </review-thread-collapsible>`
}

describe('resolveThread', () => {
  it('clicks GitHub s own resolve button and reports that it did', () => {
    const d = doc(resolvableThread())
    const el = d.querySelector('review-thread-collapsible') as Element
    const clicked: Element[] = []
    for (const button of d.querySelectorAll('button')) {
      button.addEventListener('click', (event) => {
        event.preventDefault()
        clicked.push(event.currentTarget as Element)
      })
    }

    expect(resolveThread(rowOver(el))).toBe(true)
    expect(clicked).toHaveLength(1)
    expect(clicked[0]?.textContent).toContain('Resolve conversation')
  })

  // The reply form's button is a submit button too, and it comes first in the
  // document. Matching on the form's action rather than on the thread is what
  // keeps a resolve from posting an empty reply.
  it('never touches the reply form s button', () => {
    const d = doc(resolvableThread())
    const el = d.querySelector('review-thread-collapsible') as Element
    const reply = d.querySelector('.review-simple-reply-button') as HTMLElement
    const onReply = vi.fn((event: Event) => event.preventDefault())
    reply.addEventListener('click', onReply)

    resolveThread(rowOver(el))

    expect(onReply).not.toHaveBeenCalled()
  })

  /**
   * The form is GitHub's and so is the handler bound to it. Clicking the button
   * raises a cancellable `submit` whose submitter is that button, which is the
   * event GitHub's own code intercepts to swap the thread partial in place.
   * Calling `form.submit()` instead would raise no event at all, post around
   * that handler and navigate the page out from under the panel.
   */
  it('goes through the form s submit event rather than around it', () => {
    const d = doc(resolvableThread())
    const el = d.querySelector('review-thread-collapsible') as Element
    const form = d.querySelector('.js-resolvable-timeline-thread-form') as HTMLFormElement
    const submitters: unknown[] = []
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      submitters.push((event as SubmitEvent).submitter)
    })

    resolveThread(rowOver(el))

    expect(submitters).toHaveLength(1)
    expect((submitters[0] as Element).textContent).toContain('Resolve conversation')
  })

  // GitHub renders the button for a reader who can write to the repository, not
  // for anyone with a session, so this is an ordinary outcome on a stranger's
  // pull request rather than a sign the markup moved.
  it('returns false when GitHub rendered no resolve button', () => {
    const d = doc('<review-thread-collapsible id="thread-1"></review-thread-collapsible>')
    const el = d.querySelector('review-thread-collapsible') as Element

    expect(resolveThread(rowOver(el))).toBe(false)
  })

  it('is not fooled by another form whose action merely contains resolve', () => {
    const d = doc(resolvableThread('/owner/repo/pull/1/resolve/something-else'))
    const el = d.querySelector('review-thread-collapsible') as Element

    expect(resolveThread(rowOver(el))).toBe(false)
  })

  /**
   * Every thread GitHub still calls open. The other two are B4's: one resolved
   * and expanded, carrying an `/unresolve` form instead, and one resolved and
   * collapsed, carrying no form at all.
   */
  it('finds the button in GitHub s real markup, on every open thread of the fixture', () => {
    const d = loadFixture('resolvable')
    const threads = scanThreads(d)
    const open = threads.filter((thread) => !thread.resolved)

    expect(threads).toHaveLength(10)
    expect(open).toHaveLength(8)
    for (const thread of open) {
      const button = thread.el.querySelector('form[action$="/resolve"] button')
      expect(button?.textContent?.trim(), thread.id).toBe('Resolve conversation')
    }
  })
})

/**
 * GitHub's markup for a resolved thread, in the two states it has.
 *
 * Both are copied from `resolvable.html`, captured 21 August 2026 on
 * `nickdenys/optios-booking#1` while logged in as somebody who can write to it.
 * That repository is the only place the question can be asked at all: on a
 * stranger's pull request there is no form either way, and the absence proves
 * nothing about collapsing.
 */
function unresolvableThread(action = '/owner/repo/pull/1/threads/2596049536/unresolve'): string {
  return `
    <review-thread-collapsible id="thread-1" data-resolved="true">
      <button data-action="click:review-thread-collapsible#toggle" aria-expanded="true" type="button"></button>
      <form action="/owner/repo/pull/1/review_comment/3819804339/minimize" data-turbo="false" method="post">
        <button type="submit">Hide comment</button>
      </form>
      <form class="js-inline-comment-form" data-turbo="false" action="/owner/repo/pull/1/review_comment/create" method="post">
        <button type="submit" class="review-simple-reply-button">Comment</button>
      </form>
      <form class="js-resolvable-timeline-thread-form" data-turbo="false" action="${action}" method="post">
        <button type="submit" class="Button--secondary">
          <span class="Button-content"><span class="Button-label">Unresolve conversation</span></span>
        </button>
      </form>
    </review-thread-collapsible>`
}

/** The same thread before anyone expanded it: a stub, and not one form in it. */
function collapsedResolvedThread(): string {
  return `
    <review-thread-collapsible id="thread-1" data-resolved="true"
      data-deferred-content-url="/owner/repo/pull/1/threads/2596049562?rendering_on_files_tab=false">
      <div class="js-toggle-outdated-comments">
        <button data-target="review-thread-collapsible.button" data-action="click:review-thread-collapsible#toggle"
          aria-expanded="false" type="button" class="review-thread-chevron"></button>
        <a class="text-mono">test_optios.py</a>
        <button data-action="click:review-thread-collapsible#toggle" type="button" class="review-thread-show-text">Show resolved</button>
      </div>
    </review-thread-collapsible>`
}

describe('unresolveThread', () => {
  it('clicks GitHub s own unresolve button and reports that it did', () => {
    const d = doc(unresolvableThread())
    const el = d.querySelector('review-thread-collapsible') as Element
    const clicked: Element[] = []
    for (const button of d.querySelectorAll('button')) {
      button.addEventListener('click', (event) => {
        event.preventDefault()
        clicked.push(event.currentTarget as Element)
      })
    }

    expect(unresolveThread(rowOver(el, { thread: { resolved: true } }))).toBe('clicked')
    expect(clicked).toHaveLength(1)
    expect(clicked[0]?.textContent).toContain('Unresolve conversation')
  })

  /**
   * The trap the leading slash exists for. `action$="resolve"` would match an
   * unresolve action too, and `resolveThread` would then silently unresolve the
   * thread the reader asked it to resolve. `$="/resolve"` cannot, because the
   * last eight characters of `.../unresolve` are `nresolve`.
   */
  it('is the only one of the two selectors that matches an unresolve form', () => {
    const d = doc(unresolvableThread())
    const el = d.querySelector('review-thread-collapsible') as Element

    expect(el.querySelector('form[action$="/unresolve"]')).not.toBeNull()
    expect(el.querySelector('form[action$="/resolve"]')).toBeNull()
    expect(resolveThread(rowOver(el, { thread: { resolved: true } }))).toBe(false)
  })

  // Two other submit buttons sit ahead of it in document order, `Hide comment`
  // and the reply form's `Comment`, so anchoring on the action rather than on
  // the thread is what keeps an unresolve from minimising the comment instead.
  it('never touches the minimise or the reply button', () => {
    const d = doc(unresolvableThread())
    const el = d.querySelector('review-thread-collapsible') as Element
    const others = [...d.querySelectorAll('button')].filter(
      (b) => !b.textContent?.includes('Unresolve'),
    )
    const seen = vi.fn((event: Event) => event.preventDefault())
    for (const button of others) button.addEventListener('click', seen)

    unresolveThread(rowOver(el, { thread: { resolved: true } }))

    expect(seen).not.toHaveBeenCalled()
  })

  it('goes through the form s submit event rather than around it', () => {
    const d = doc(unresolvableThread())
    const el = d.querySelector('review-thread-collapsible') as Element
    const form = d.querySelector('.js-resolvable-timeline-thread-form') as HTMLFormElement
    const submitters: unknown[] = []
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      submitters.push((event as SubmitEvent).submitter)
    })

    unresolveThread(rowOver(el, { thread: { resolved: true } }))

    expect(submitters).toHaveLength(1)
    expect((submitters[0] as Element).textContent).toContain('Unresolve conversation')
  })

  /**
   * The step's own verify-first answer: there is no unresolve form on a
   * collapsed thread, so the first press expands and says so rather than
   * reporting a click that never happened.
   */
  it('expands a collapsed thread instead, because it has no form yet', () => {
    const d = doc(collapsedResolvedThread())
    const el = d.querySelector('review-thread-collapsible') as Element
    const toggled: Element[] = []
    for (const button of d.querySelectorAll('button')) {
      button.addEventListener('click', (event) => toggled.push(event.currentTarget as Element))
    }

    expect(el.querySelectorAll('form')).toHaveLength(0)
    expect(unresolveThread(rowOver(el, { thread: { resolved: true, collapsed: true } }))).toBe(
      'expanding',
    )
    expect(toggled).toHaveLength(1)
  })

  // An expanded thread with no button is the ordinary no-write-access case, and
  // it must not be reported as something a second press could fix.
  it('reports unavailable on an expanded thread with no button', () => {
    const d = doc(
      '<review-thread-collapsible id="thread-1" data-resolved="true">' +
        '<button data-action="click:review-thread-collapsible#toggle" aria-expanded="true" type="button"></button>' +
        '</review-thread-collapsible>',
    )
    const el = d.querySelector('review-thread-collapsible') as Element

    expect(unresolveThread(rowOver(el, { thread: { resolved: true } }))).toBe('unavailable')
  })

  it('reports unavailable when there is no toggle and no form at all', () => {
    const d = doc('<review-thread-collapsible id="thread-1" data-resolved="true"></review-thread-collapsible>')
    const el = d.querySelector('review-thread-collapsible') as Element

    expect(unresolveThread(rowOver(el, { thread: { resolved: true } }))).toBe('unavailable')
  })

  it('is not fooled by a form whose action merely contains unresolve', () => {
    const d = doc(unresolvableThread('/owner/repo/pull/1/unresolve/something-else'))
    const el = d.querySelector('review-thread-collapsible') as Element

    // The toggle says expanded, so there is nothing left to try.
    expect(unresolveThread(rowOver(el, { thread: { resolved: true } }))).toBe('unavailable')
  })

  /**
   * The cache is a record of what a thread said before it was resolved here,
   * and an unresolve that GitHub has not confirmed must not take it away: the
   * row would fall back to unreadable and drop out of the list, which is the
   * one failure the cache exists to prevent.
   */
  it('leaves the session cache alone, because the click is not a done state', () => {
    const resolvable = doc(resolvableThread())
    resolveThread(rowOver(resolvable.querySelector('review-thread-collapsible') as Element))
    expect(sessionFinding('thread-1')).toEqual(FINDING)

    const d = doc(unresolvableThread())
    unresolveThread(rowOver(d.querySelector('review-thread-collapsible') as Element, {
      thread: { resolved: true },
    }))

    expect(sessionFinding('thread-1')).toEqual(FINDING)
  })

  describe('against GitHub s real markup', () => {
    it('finds the unresolve form on the expanded resolved thread of the fixture', () => {
      const threads = scanThreads(loadFixture('resolvable'))
      const resolved = threads.filter((thread) => thread.resolved)
      const expanded = resolved.filter((thread) => !thread.collapsed)

      expect(resolved).toHaveLength(2)
      expect(expanded).toHaveLength(1)

      const button = expanded[0]!.el.querySelector('form[action$="/unresolve"] button')
      expect(button?.textContent?.trim()).toBe('Unresolve conversation')
      expect(unresolveThread(rowOver(expanded[0]!.el, { thread: { resolved: true } }))).toBe(
        'clicked',
      )
    })

    /**
     * The verify-first answer, read off a repository the reader can write to so
     * that permission is not the explanation. The collapsed thread has the
     * deferred URL and no form; the expanded one has the form and no deferred
     * URL. Expanding is what swaps them.
     */
    it('finds no form at all on the collapsed resolved thread of the fixture', () => {
      const threads = scanThreads(loadFixture('resolvable'))
      const collapsed = threads.filter((thread) => thread.resolved && thread.collapsed)

      expect(collapsed).toHaveLength(1)
      expect(collapsed[0]!.deferredUrl).not.toBeNull()
      expect(collapsed[0]!.el.querySelectorAll('form')).toHaveLength(0)
      expect(unresolveThread(rowOver(collapsed[0]!.el, { thread: { resolved: true, collapsed: true } }))).toBe(
        'expanding',
      )
    })

    it('carries exactly one unresolve form, and it is not counted as a resolve form', () => {
      const d = loadFixture('resolvable')

      expect(d.querySelectorAll('form[action$="/unresolve"]')).toHaveLength(1)
      expect(d.querySelectorAll('form[action$="/resolve"]')).toHaveLength(8)
    })
  })
})

describe('the session done list', () => {
  it('remembers what the thread said before it was resolved', () => {
    const d = doc(resolvableThread())
    const el = d.querySelector('review-thread-collapsible') as Element

    expect(sessionFinding('thread-1')).toBeUndefined()
    resolveThread(rowOver(el))
    expect(sessionFinding('thread-1')).toEqual(FINDING)
  })

  it('remembers nothing when the click never happened', () => {
    const d = doc('<review-thread-collapsible id="thread-1"></review-thread-collapsible>')

    resolveThread(rowOver(d.querySelector('review-thread-collapsible') as Element))

    expect(sessionFinding('thread-1')).toBeUndefined()
  })

  /**
   * The failure the list exists to prevent. A resolved thread collapses and
   * loses its comments, so the next pass reads it as unreadable: without the
   * cache the row the reader just finished would drop out of the list and the
   * checklist would count its own progress away.
   */
  it('keeps the row listed after the thread collapses, drawn from the cache', () => {
    const d = doc(resolvableThread())
    const el = d.querySelector('review-thread-collapsible') as Element
    const before = rowOver(el)

    const after: TriageRow = {
      thread: { ...before.thread, resolved: true, collapsed: true },
      finding: null,
      verdict: { hide: false, reason: 'collapsed' },
    }
    const state = { rows: [after], kind: 'classic' } as never

    expect(listedRows(state)).toEqual([])
    expect(unreadCount(state)).toBe(1)

    resolveThread(before)

    expect(listedRows(state)).toHaveLength(1)
    expect(listedRows(state)[0]?.finding).toEqual(FINDING)
    expect(listedRows(state)[0]?.thread.resolved).toBe(true)
    expect(unreadCount(state)).toBe(0)
  })
})

describe('copyPrompt', () => {
  it('puts the agent prompt on the clipboard, newlines and all', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const d = doc(resolvableThread())

    const copied = await copyPrompt(rowOver(d.querySelector('review-thread-collapsible') as Element))

    expect(copied).toBe(true)
    expect(write).toHaveBeenCalledWith(FINDING.aiPrompt)
  })

  it('returns false when the comment carries no prompt', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const d = doc(resolvableThread())
    const el = d.querySelector('review-thread-collapsible') as Element

    expect(await copyPrompt(rowOver(el, { finding: { ...FINDING, aiPrompt: null } }))).toBe(false)
    expect(await copyPrompt(rowOver(el, { finding: null }))).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  // The clipboard refuses on an unfocused document and outside a user gesture,
  // both of which happen on a page the reader is also clicking around in.
  it('returns false when the clipboard refuses', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('not allowed'))
    const d = doc(resolvableThread())

    expect(await copyPrompt(rowOver(d.querySelector('review-thread-collapsible') as Element))).toBe(
      false,
    )
  })
})

describe('toggleInTimeline', () => {
  const HIDEABLE = `
    <div class="js-timeline-item">
      <div class="TimelineItem">
        <review-thread-collapsible id="thread-1">
          <div class="timeline-comment-group">one</div>
        </review-thread-collapsible>
      </div>
      <div class="TimelineItem">
        <review-thread-collapsible id="thread-2">
          <div class="timeline-comment-group">two</div>
        </review-thread-collapsible>
      </div>
    </div>`

  it('puts a hidden thread back on the page and scrolls to it', () => {
    const d = doc(HIDEABLE)
    const [first, second] = [...d.querySelectorAll('review-thread-collapsible')]
    applyHiding([first, second], d)
    const scroll = vi.spyOn(first, 'scrollIntoView')

    expect(d.querySelectorAll(HIDDEN)).toHaveLength(1)

    expect(toggleInTimeline(rowOver(first))).toBe('shown')

    expect(first.closest(HIDDEN)).toBeNull()
    expect(scroll).toHaveBeenCalled()
  })

  // The whole review collapsed into one hidden element, so revealing one thread
  // must not take its siblings out of hiding with it.
  it('leaves the rest of the review hidden', () => {
    const d = doc(HIDEABLE)
    const [first, second] = [...d.querySelectorAll('review-thread-collapsible')]
    applyHiding([first, second], d)

    toggleInTimeline(rowOver(first))

    expect(second.closest(HIDDEN)).not.toBeNull()
  })

  // The second press, which is the whole point of the title being a toggle: a
  // reader who looked at the thread on the page puts it back rather than
  // leaving the timeline a little more cluttered with every row they check.
  it('takes it back out on the next press', () => {
    const d = doc(HIDEABLE)
    const [first, second] = [...d.querySelectorAll('review-thread-collapsible')]
    applyHiding([first, second], d)
    const row = rowOver(first)

    toggleInTimeline(row)
    expect(toggleInTimeline(row)).toBe('hidden')

    expect(first.closest(HIDDEN)).not.toBeNull()
  })

  // Back to the state the pass left, which for a review whose threads all went
  // is the one hidden `.js-timeline-item` rather than two hidden threads.
  it('collapses the review back into one hidden element', () => {
    const d = doc(HIDEABLE)
    const targets = [...d.querySelectorAll('review-thread-collapsible')]
    applyHiding(targets, d)
    const before = [...d.querySelectorAll(HIDDEN)].map((el) => el.className)

    toggleInTimeline(rowOver(targets[0]))
    toggleInTimeline(rowOver(targets[0]))

    expect([...d.querySelectorAll(HIDDEN)].map((el) => el.className)).toEqual(before)
  })

  // Invariants 1 and 2 in the panel: the policy kept this thread in the
  // timeline, and no press on a title may take it out. Both presses are a
  // scroll, and neither is a hide.
  it('never hides a thread the policy left in the timeline', () => {
    const d = doc(HIDEABLE)
    const first = d.querySelector('review-thread-collapsible') as Element
    const scroll = vi.spyOn(first, 'scrollIntoView')
    const row = rowOver(first)

    expect(toggleInTimeline(row)).toBe('scrolled')
    expect(toggleInTimeline(row)).toBe('scrolled')

    expect(d.querySelectorAll(HIDDEN)).toHaveLength(0)
    expect(scroll).toHaveBeenCalledTimes(2)
  })

  // A later pass may not undo a reveal, which is A7, and the toggle does not
  // change that: only the reader's own second press does.
  it('survives the passes that follow it', () => {
    const d = doc(HIDEABLE)
    const targets = [...d.querySelectorAll('review-thread-collapsible')]
    applyHiding(targets, d)

    const row = rowOver(targets[0])
    toggleInTimeline(row)
    applyHiding(targets, d)

    expect(showsInTimeline(row)).toBe(true)
  })
})

describe('showsInTimeline', () => {
  it('reads the page rather than the verdict', () => {
    const d = doc('<review-thread-collapsible id="thread-1">one</review-thread-collapsible>')
    const el = d.querySelector('review-thread-collapsible') as Element

    expect(showsInTimeline(rowOver(el))).toBe(true)

    applyHiding([el], d)
    expect(showsInTimeline(rowOver(el))).toBe(false)
  })

  // The class is on the item, not on the thread, so anything asking the element
  // alone would call a hidden review visible.
  it('sees a thread hidden by an ancestor', () => {
    const d = doc(`
      <div class="js-timeline-item">
        <review-thread-collapsible id="thread-1">
          <div class="timeline-comment-group">one</div>
        </review-thread-collapsible>
      </div>`)
    const el = d.querySelector('review-thread-collapsible') as Element

    applyHiding([el], d)

    expect(el.classList.contains('crt-hidden')).toBe(false)
    expect(showsInTimeline(rowOver(el))).toBe(false)
  })
})
