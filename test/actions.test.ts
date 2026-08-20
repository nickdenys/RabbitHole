import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TriageRow } from '../src/engine'
import { applyHiding, revealAll } from '../src/hide/apply'
import {
  copyPrompt,
  forgetSessionFindings,
  resolveThread,
  revealThread,
  sessionFinding,
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

  it('finds the button in GitHub s real markup, on every thread of the fixture', () => {
    const d = loadFixture('resolvable')
    const threads = scanThreads(d)

    expect(threads).toHaveLength(10)
    for (const thread of threads) {
      const button = thread.el.querySelector('form[action$="/resolve"] button')
      expect(button?.textContent?.trim(), thread.id).toBe('Resolve conversation')
    }
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

describe('revealThread', () => {
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

    revealThread(rowOver(first))

    expect(first.closest(HIDDEN)).toBeNull()
    expect(scroll).toHaveBeenCalled()
  })

  // The whole review collapsed into one hidden element, so revealing one thread
  // must not take its siblings out of hiding with it.
  it('leaves the rest of the review hidden', () => {
    const d = doc(HIDEABLE)
    const [first, second] = [...d.querySelectorAll('review-thread-collapsible')]
    applyHiding([first, second], d)

    revealThread(rowOver(first))

    expect(second.closest(HIDDEN)).not.toBeNull()
  })

  it('is only a scroll on a thread that was never hidden', () => {
    const d = doc(HIDEABLE)
    const first = d.querySelector('review-thread-collapsible') as Element
    const scroll = vi.spyOn(first, 'scrollIntoView')

    revealThread(rowOver(first))

    expect(d.querySelectorAll(HIDDEN)).toHaveLength(0)
    expect(scroll).toHaveBeenCalled()
  })
})
