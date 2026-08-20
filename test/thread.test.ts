import { describe, expect, it } from 'vitest'
import { scanThreads } from '../src/parse/thread'
import { loadFixture } from './support/fixture'

/**
 * Hand counted off the fixtures on 20 August 2026 and cross checked against the
 * table in test/fixtures/README.md, which was written from the live pages.
 * A change here means either GitHub's markup moved or the scanner lost threads,
 * and both are worth stopping for.
 */
const COUNTS = {
  'unresolved-and-resolved': { threads: 13, resolved: 10, outdated: 3, collapsed: 10, deferred: 10, resolveForms: 0 },
  'human-replies': { threads: 103, resolved: 76, outdated: 57, collapsed: 76, deferred: 76, resolveForms: 0 },
  'pending-in-batch': { threads: 19, resolved: 10, outdated: 11, collapsed: 10, deferred: 10, resolveForms: 0 },
  'no-coderabbit': { threads: 3, resolved: 1, outdated: 2, collapsed: 1, deferred: 1, resolveForms: 0 },
  'resolvable': { threads: 10, resolved: 0, outdated: 0, collapsed: 0, deferred: 0, resolveForms: 10 },
} as const

const NAMES = Object.keys(COUNTS) as (keyof typeof COUNTS)[]

// Parsed once and shared. Every case below only reads; the ones that mutate
// load their own copy, which is what loadFixture returns a fresh document for.
// human-replies.html is 8.7 MB and costs about 700 ms, so re-parsing it per
// case is what exhausts the test worker.
const scans = Object.fromEntries(NAMES.map((name) => [name, scanThreads(loadFixture(name))])) as Record<
  keyof typeof COUNTS,
  ReturnType<typeof scanThreads>
>

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument()
  d.body.innerHTML = html
  return d
}

const THREAD = (attrs: string, inner = '') => `
  <div class="js-timeline-item">
    <turbo-frame id="review-thread-or-comment-id-111">
      <review-thread-collapsible ${attrs}>
        <div><span class="flex-auto"><a href="/o/r/pull/1/files#diff-abc"
          class="text-mono text-small Link--primary wb-break-all mr-2">src/app.ts</a></span></div>
        ${inner}
      </review-thread-collapsible>
    </turbo-frame>
  </div>`

describe('scanThreads, counts', () => {
  it.each(NAMES)('%s finds every thread', (name) => {
    expect(scans[name]).toHaveLength(COUNTS[name].threads)
  })

  it.each(NAMES)('%s counts the same threads the document does', (name) => {
    // The scan must not drop or duplicate rows relative to the raw markup.
    const raw = loadFixture(name).querySelectorAll('review-thread-collapsible').length
    expect(scans[name].length).toBe(raw)
  })

  it.each(NAMES)('%s reads resolved, outdated and collapsed', (name) => {
    const scan = scans[name]
    const expected = COUNTS[name]

    expect({
      resolved: scan.filter((t) => t.resolved).length,
      outdated: scan.filter((t) => t.outdated).length,
      collapsed: scan.filter((t) => t.collapsed).length,
      deferred: scan.filter((t) => t.deferredUrl !== null).length,
    }).toEqual({
      resolved: expected.resolved,
      outdated: expected.outdated,
      collapsed: expected.collapsed,
      deferred: expected.deferred,
    })
  })
})

describe('scanThreads, identity', () => {
  it.each(NAMES)('%s gives every thread a unique id', (name) => {
    const ids = scans[name].map((t) => t.id)

    expect(ids.every((id) => /^\d+$/.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(NAMES)('%s places every thread in a timeline item', (name) => {
    expect(scans[name].every((t) => t.timelineItem !== null)).toBe(true)
  })

  it('reads one timeline item holding many threads', () => {
    // 25 threads under a single item in this fixture. The one-to-one reading of
    // PR 590 was wrong, and A7 hides the item only when it holds exactly one.
    const items = new Map<Element, number>()
    for (const thread of scans['human-replies']) {
      const item = thread.timelineItem!
      items.set(item, (items.get(item) ?? 0) + 1)
    }

    expect(Math.max(...items.values())).toBeGreaterThan(1)
  })

  it('falls back to the deferred URL when the frame is gone', () => {
    const d = loadFixture('unresolved-and-resolved')
    for (const frame of d.querySelectorAll('turbo-frame')) frame.removeAttribute('id')

    const withUrl = scanThreads(d).filter((t) => t.deferredUrl !== null)

    expect(withUrl).toHaveLength(COUNTS['unresolved-and-resolved'].deferred)
    for (const thread of withUrl) {
      expect(thread.problems).not.toContain('no-id')
      expect(thread.deferredUrl).toContain(`/threads/${thread.id}`)
    }
  })

  it('falls back to the resolve form action when nothing else is there', () => {
    const d = loadFixture('resolvable')
    for (const frame of d.querySelectorAll('turbo-frame')) frame.removeAttribute('id')

    const scan = scanThreads(d)
    const actions = [...d.querySelectorAll('form[action$="/resolve"]')].map((form) =>
      form.getAttribute('action')!.match(/\/threads\/(\d+)/)![1],
    )

    expect(actions).toHaveLength(COUNTS['resolvable'].resolveForms)
    expect(scan.map((t) => t.id).sort()).toEqual([...actions].sort())
  })

  it('reports no-id rather than throwing when every source is gone', () => {
    const d = doc(THREAD('data-resolved="false"'))
    d.querySelector('turbo-frame')!.removeAttribute('id')

    const [thread] = scanThreads(d)

    expect(thread.problems).toContain('no-id')
    expect(thread.id).toBe('')
    // Still a row: a thread you cannot identify is one the panel must show.
    expect(scanThreads(d)).toHaveLength(1)
  })

  // Pins a fact the plan did not know: `review-thread-or-comment-id-N` is
  // sometimes the thread's first comment id, so a thread id must never be
  // reconstructed from `id`. Measured 20 August 2026, 3 of 103 threads.
  it('knows the frame id is not always the thread id', () => {
    const mismatched = scans['human-replies'].filter(
      (t) => t.deferredUrl !== null && !t.deferredUrl.includes(`/threads/${t.id}`),
    )

    expect(mismatched.length).toBeGreaterThan(0)
    for (const thread of mismatched) {
      expect(thread.el.getAttribute('data-hidden-comment-ids')?.split(',')).toContain(thread.id)
    }
  })
})

describe('scanThreads, file paths', () => {
  it.each(NAMES)('%s reads a path for every thread', (name) => {
    const files = scans[name].map((t) => t.file)

    expect(files.every((file) => file !== null && file.length > 0)).toBe(true)
    expect(scans[name].some((t) => t.problems.includes('no-file'))).toBe(false)
  })

  it('reads the path from the link text, not the diff anchor', () => {
    // An outdated thread links to /files/<sha>#diff-<hash>, so the href carries
    // no path at all. Both shapes appear in this fixture.
    const files = scans['unresolved-and-resolved'].map((t) => t.file)

    expect(files).toContain('backend/src/services/note.service.js')
    expect(files.every((file) => !file!.includes('#diff-'))).toBe(true)
  })

  it('reports no-file as a gap, keeping the thread and its id', () => {
    const d = doc(THREAD('data-resolved="false"'))
    d.querySelector('a')!.remove()

    const [thread] = scanThreads(d)

    expect(thread.file).toBeNull()
    expect(thread.problems).toEqual(['no-file'])
    expect(thread.id).toBe('111')
  })
})

describe('scanThreads, state', () => {
  it('treats anything but exactly "true" as unresolved', () => {
    const scan = scanThreads(
      doc(THREAD('data-resolved="false"') + THREAD('data-resolved="TRUE"') + THREAD('')),
    )

    expect(scan.map((t) => t.resolved)).toEqual([false, false, false])
  })

  it('derives collapsed from the missing body, not from the resolved flag', () => {
    const scan = scanThreads(
      doc(
        // Resolved and expanded: GitHub renders this after "Show resolved".
        THREAD('data-resolved="true" data-deferred-content-url="/o/r/pull/1/threads/9"', '<div class="comment-body">hi</div>') +
          // Unresolved with no body and no URL: nothing to fetch, so not collapsed.
          THREAD('data-resolved="false"'),
      ),
    )

    expect(scan.map((t) => ({ resolved: t.resolved, collapsed: t.collapsed }))).toEqual([
      { resolved: true, collapsed: false },
      { resolved: false, collapsed: false },
    ])
  })

  it.each(NAMES)('%s has a deferred URL on exactly the collapsed threads', (name) => {
    // In real markup the two coincide, and the panel's v0.2 fetch depends on it:
    // a collapsed thread with no URL would be unreadable and unreportable.
    for (const thread of scans[name]) {
      expect(thread.collapsed).toBe(thread.deferredUrl !== null)
    }
  })

  it('does not read an Outdated label out of a comment body', () => {
    const scan = scanThreads(
      doc(THREAD('data-resolved="false"', '<div class="comment-body"><span>Outdated</span></div>')),
    )

    expect(scan[0].outdated).toBe(false)
  })
})

describe('scanThreads, safety', () => {
  it('returns an empty list for a document with no threads', () => {
    expect(scanThreads(doc('<div class="js-timeline-item"></div>'))).toEqual([])
  })

  it.each(NAMES)('%s parses without a single problem beyond gaps', (name) => {
    // 'no-id' is blocking: a thread it fires on can never be hidden. Nothing in
    // any real capture should reach it.
    expect(scans[name].some((t) => t.problems.includes('no-id'))).toBe(false)
  })

  it('reads a PR with no CodeRabbit exactly as cleanly', () => {
    // The scanner knows nothing about authors yet, so a human-only PR must come
    // back complete rather than empty.
    const scan = scans['no-coderabbit']

    expect(scan).toHaveLength(3)
    expect(scan.every((t) => t.problems.length === 0)).toBe(true)
  })
})
