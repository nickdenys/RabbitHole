import { describe, expect, it } from 'vitest'
import { readAuthors } from '../src/parse/authors'
import { scanThreads } from '../src/parse/thread'
import { loadFixture } from './support/fixture'

/**
 * Hand counted off the fixtures on 20 August 2026 by walking every
 * `review-thread-collapsible` and every `.review-comment` inside it, without
 * going through `readAuthors`. So these are an independent count, and a change
 * here means either GitHub's markup moved or attribution broke.
 *
 * `attributed` is the number of threads `readAuthors` answers for, which is the
 * expanded ones. `allCodeRabbit` is what safe mode may hide, `rootCodeRabbit`
 * what aggressive mode may hide, and the gap between them is the reason the two
 * modes exist: 17 against 27 on `human-replies.html`.
 */
const COUNTS = {
  'unresolved-and-resolved': {
    threads: 13, attributed: 3, comments: 3, fromCodeRabbit: 2,
    allCodeRabbit: 2, rootCodeRabbit: 2, withPending: 0,
  },
  'human-replies': {
    threads: 103, attributed: 27, comments: 47, fromCodeRabbit: 37,
    allCodeRabbit: 17, rootCodeRabbit: 27, withPending: 0,
  },
  'pending-in-batch': {
    threads: 19, attributed: 9, comments: 10, fromCodeRabbit: 8,
    allCodeRabbit: 7, rootCodeRabbit: 8, withPending: 2,
  },
  'no-coderabbit': {
    threads: 3, attributed: 2, comments: 6, fromCodeRabbit: 0,
    allCodeRabbit: 0, rootCodeRabbit: 0, withPending: 0,
  },
  'resolvable': {
    threads: 10, attributed: 10, comments: 10, fromCodeRabbit: 10,
    allCodeRabbit: 10, rootCodeRabbit: 10, withPending: 0,
  },
} as const

const NAMES = Object.keys(COUNTS) as (keyof typeof COUNTS)[]

// Parsed once and shared, like thread.test.ts: human-replies.html is 8.7 MB and
// re-parsing it per case is what exhausts the test worker. Nothing below mutates
// a shared document; the cases that mutate load their own.
const scans = Object.fromEntries(NAMES.map((name) => [name, scanThreads(loadFixture(name))])) as Record<
  keyof typeof COUNTS,
  ReturnType<typeof scanThreads>
>

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument()
  d.body.innerHTML = html
  return d
}

const COMMENT = (href: string | null, attrs = '') =>
  `<div class="review-comment ${attrs}">
     ${href === null ? '<span>ghost</span>' : `<a class="author Link--primary" href="${href}">someone</a>`}
     <div class="comment-body"><p>text</p></div>
   </div>`

const CODERABBIT = COMMENT('/apps/coderabbitai')
const HUMAN = COMMENT('/nickdenys')
const PENDING = COMMENT('/nickdenys', 'js-pending-review-comment')

const THREAD = (inner: string) => `<review-thread-collapsible>${inner}</review-thread-collapsible>`

function thread(inner: string): Element {
  return doc(THREAD(inner)).querySelector('review-thread-collapsible')!
}

describe('readAuthors, proving CodeRabbit', () => {
  it('reports a thread CodeRabbit wrote alone', () => {
    expect(readAuthors(thread(CODERABBIT))).toEqual({
      comments: 1,
      fromCodeRabbit: 1,
      fromHumans: 0,
      pending: 0,
      allFromCodeRabbit: true,
      rootIsCodeRabbit: true,
    })
  })

  it('lets one human reply keep the thread', () => {
    const authors = readAuthors(thread(CODERABBIT + HUMAN))!

    // Safe mode's whole rule: the root is still CodeRabbit's, and that is not
    // enough, because someone has been talking in here.
    expect(authors.allFromCodeRabbit).toBe(false)
    expect(authors.rootIsCodeRabbit).toBe(true)
    expect(authors.fromHumans).toBe(1)
  })

  it('reads a human rooted thread as nobody-s but the human-s', () => {
    const authors = readAuthors(thread(HUMAN + CODERABBIT))!

    expect(authors.rootIsCodeRabbit).toBe(false)
    expect(authors.allFromCodeRabbit).toBe(false)
    expect(authors.fromCodeRabbit).toBe(1)
  })

  it('matches the account path exactly, never the name', () => {
    // `/coderabbitai` is a free account anyone can register, the trailing slash
    // and the absolute URL are not what GitHub renders, and the display name is
    // the string Houdini matched on. None of them are proof.
    const impostors = [
      '/coderabbitai',
      '/apps/coderabbitai-clone',
      '/apps/coderabbitai/',
      'https://github.com/apps/coderabbitai',
      '/orgs/apps/coderabbitai',
    ]

    for (const href of impostors) {
      expect(readAuthors(thread(COMMENT(href)))!.fromCodeRabbit).toBe(0)
    }
  })

  it('ignores the display name entirely', () => {
    const disguised = thread(
      `<div class="review-comment">
         <a class="author" href="/impostor">coderabbitai[bot]</a>
         <div class="comment-body">CodeRabbit</div>
       </div>`,
    )

    expect(readAuthors(disguised)!.allFromCodeRabbit).toBe(false)
  })

  it('keeps the counts adding up', () => {
    const authors = readAuthors(thread(CODERABBIT + HUMAN + CODERABBIT + PENDING))!

    expect(authors.fromCodeRabbit + authors.fromHumans).toBe(authors.comments)
    expect(authors).toMatchObject({ comments: 4, fromCodeRabbit: 2, fromHumans: 2, pending: 1 })
  })
})

describe('readAuthors, pending comments', () => {
  it('counts a pending reply as human', () => {
    const authors = readAuthors(thread(CODERABBIT + PENDING))!

    expect(authors.pending).toBe(1)
    expect(authors.allFromCodeRabbit).toBe(false)
    expect(authors.fromHumans).toBe(1)
  })

  it('lets the pending state outrank the author link', () => {
    // Not reachable today, since only you can hold an unsubmitted comment. The
    // rule is written down anyway, because a draft of yours is the one thing
    // that must never vanish out of the timeline.
    const authors = readAuthors(thread(COMMENT('/apps/coderabbitai', 'js-pending-review-comment')))!

    expect(authors).toMatchObject({ pending: 1, fromCodeRabbit: 0, allFromCodeRabbit: false })
  })

  it('never reads pending out of a "Pending in batch" label', () => {
    // resolvable.html carries four of these, all d-none, on a PR with nothing
    // pending at all. They are the template for the batched suggestion control.
    const trap = thread(
      `<div class="review-comment">
         <a class="author" href="/apps/coderabbitai">coderabbitai</a>
         <span class="Label d-none js-pending-batched-suggestion-label">Pending in batch</span>
         <div class="comment-body">text</div>
       </div>`,
    )

    expect(readAuthors(trap)).toMatchObject({ pending: 0, allFromCodeRabbit: true })
  })
})

describe('readAuthors, refusing to answer', () => {
  it('returns null when one comment has no author link', () => {
    // The other comment is readable and it does not help: "every comment is
    // CodeRabbit's" is not a claim you can make about a thread you half read.
    expect(readAuthors(thread(CODERABBIT + COMMENT(null)))).toBeNull()
  })

  it('returns null when a comment has two authors', () => {
    const ambiguous = thread(
      `<div class="review-comment">
         <a class="author" href="/apps/coderabbitai">coderabbitai</a>
         <a class="author" href="/nickdenys">nick</a>
       </div>`,
    )

    expect(readAuthors(ambiguous)).toBeNull()
  })

  it('returns null when the author link has no usable href', () => {
    expect(readAuthors(thread(COMMENT('')))).toBeNull()
    expect(readAuthors(thread(COMMENT('   ')))).toBeNull()
  })

  it('returns null for a collapsed thread, with no special case for it', () => {
    const collapsed = thread(
      '<span class="Label">Outdated</span><span class="Label">Resolved</span>',
    )

    expect(readAuthors(collapsed)).toBeNull()
  })

  it('reads only the comments inside its own thread', () => {
    // human-replies.html has 74 .review-comment elements and only 47 of them are
    // in a thread; the other 27 sit in minimized review bodies. A read scoped to
    // the document instead of the thread would attribute a thread to a stranger.
    const d = doc(`${THREAD(CODERABBIT)}${COMMENT('/nickdenys')}`)

    expect(readAuthors(d.querySelector('review-thread-collapsible')!)).toMatchObject({
      comments: 1,
      allFromCodeRabbit: true,
    })
  })
})

describe('readAuthors, against the fixtures', () => {
  it.each(NAMES)('%s attributes every expanded thread and no collapsed one', (name) => {
    const scan = scans[name]

    expect(scan.filter((t) => t.authors !== null)).toHaveLength(COUNTS[name].attributed)
    // The two are the same set, not just the same size: a collapsed thread has
    // nothing to read and an expanded one has never yet failed to be read.
    for (const t of scan) expect(t.authors === null).toBe(t.collapsed)
  })

  it.each(NAMES)('%s counts comments and CodeRabbit the way a hand count does', (name) => {
    const attributed = scans[name].flatMap((t) => (t.authors === null ? [] : [t.authors]))

    expect({
      comments: attributed.reduce((n, a) => n + a.comments, 0),
      fromCodeRabbit: attributed.reduce((n, a) => n + a.fromCodeRabbit, 0),
    }).toEqual({ comments: COUNTS[name].comments, fromCodeRabbit: COUNTS[name].fromCodeRabbit })
  })

  it.each(NAMES)('%s finds the threads each mode may hide', (name) => {
    const attributed = scans[name].flatMap((t) => (t.authors === null ? [] : [t.authors]))

    expect({
      all: attributed.filter((a) => a.allFromCodeRabbit).length,
      root: attributed.filter((a) => a.rootIsCodeRabbit).length,
      pending: attributed.filter((a) => a.pending > 0).length,
    }).toEqual({
      all: COUNTS[name].allCodeRabbit,
      root: COUNTS[name].rootCodeRabbit,
      pending: COUNTS[name].withPending,
    })
  })

  it('finds the ten human replies that safe mode protects', () => {
    // 27 expanded threads, every one rooted by CodeRabbit, and 10 of them with
    // a human in the conversation. This fixture is the number that decided that
    // aggressive mode is a toggle rather than the default.
    const attributed = scans['human-replies'].flatMap((t) => (t.authors === null ? [] : [t.authors]))
    const withHumans = attributed.filter((a) => a.rootIsCodeRabbit && !a.allFromCodeRabbit)

    expect(withHumans).toHaveLength(10)
    expect(withHumans.every((a) => a.fromHumans > 0)).toBe(true)
  })

  it('finds the two real pending comments and no others', () => {
    // One is an unsubmitted reply to a CodeRabbit thread, the other is an
    // unsubmitted comment that roots a thread of its own. Both keep their thread
    // visible, and the second is also the fixture's only human rooted thread.
    const attributed = scans['pending-in-batch'].flatMap((t) => (t.authors === null ? [] : [t.authors]))
    const pending = attributed.filter((a) => a.pending > 0)

    expect(pending.reduce((n, a) => n + a.pending, 0)).toBe(2)
    expect(pending.filter((a) => a.rootIsCodeRabbit)).toHaveLength(1)
    expect(pending.every((a) => !a.allFromCodeRabbit)).toBe(true)
  })

  it('attributes nothing on a PR CodeRabbit never touched', () => {
    const attributed = scans['no-coderabbit'].flatMap((t) => (t.authors === null ? [] : [t.authors]))

    expect(attributed).toHaveLength(2)
    expect(attributed.every((a) => a.fromCodeRabbit === 0 && a.fromHumans === a.comments)).toBe(true)
  })
})

describe('scanThreads, attribution on the row', () => {
  it.each(NAMES)('%s has either authors or unknown-author, never neither', (name) => {
    // Invariant 2, stated as the one thing that must hold on every row: a thread
    // is either attributed or flagged as unattributable, and the hide policy
    // reads the flag.
    for (const t of scans[name]) {
      expect(t.authors === null).toBe(t.problems.includes('unknown-author'))
    }
  })

  it.each(NAMES)('%s never reports no-body on a real thread', (name) => {
    expect(scans[name].some((t) => t.problems.includes('no-body'))).toBe(false)
  })

  it('reports no-body when an expanded thread has no comments at all', () => {
    const d = doc(
      '<div class="js-timeline-item"><turbo-frame id="review-thread-or-comment-id-1">' +
        '<review-thread-collapsible data-resolved="false"><div class="comment-body">orphan</div>' +
        '</review-thread-collapsible></turbo-frame></div>',
    )

    const [row] = scanThreads(d)

    expect(row.collapsed).toBe(false)
    expect(row.problems).toContain('no-body')
    expect(row.problems).toContain('unknown-author')
    expect(row.authors).toBeNull()
  })

  it('does not report no-body on a collapsed thread', () => {
    // 97 of the 148 threads look like this and none of them are broken. They are
    // unattributable, which is a different word.
    const d = doc(
      '<div class="js-timeline-item"><turbo-frame id="review-thread-or-comment-id-1">' +
        '<review-thread-collapsible data-resolved="true" data-deferred-content-url="/o/r/pull/1/threads/9">' +
        '</review-thread-collapsible></turbo-frame></div>',
    )

    const [row] = scanThreads(d)

    expect(row.collapsed).toBe(true)
    expect(row.problems).toContain('unknown-author')
    expect(row.problems).not.toContain('no-body')
  })
})
