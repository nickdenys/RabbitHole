import { describe, expect, it } from 'vitest'
import { hideVerdict, type HideMode } from '../src/hide/policy'
import type { ParseProblem, Thread, ThreadAuthors } from '../src/types'

const MODES: HideMode[] = ['safe', 'aggressive']

/**
 * A thread record built by hand rather than parsed, because this module never
 * looks at a page. `el` is the one field it cannot avoid carrying, and nothing
 * here reads it.
 *
 * The defaults describe the case the panel exists for: a readable, expanded,
 * fully CodeRabbit thread that both modes hide. Every case below is that thread
 * with one thing changed, so what a case is testing is the override.
 */
function thread(over: Partial<Thread> = {}, authors: Partial<ThreadAuthors> = {}): Thread {
  return {
    el: null as unknown as Element,
    timelineItem: null,
    id: '1',
    file: 'src/app.ts',
    resolved: false,
    outdated: false,
    collapsed: false,
    deferredUrl: null,
    authors: {
      comments: 1,
      fromCodeRabbit: 1,
      fromHumans: 0,
      pending: 0,
      allFromCodeRabbit: true,
      rootIsCodeRabbit: true,
      ...authors,
    },
    problems: [],
    ...over,
  }
}

/** The same thread with a human reply on it: two comments, one CodeRabbit's. */
const withHumanReply = { comments: 2, fromCodeRabbit: 1, fromHumans: 1, allFromCodeRabbit: false }

describe('hideVerdict', () => {
  it.each(MODES)('hides a fully CodeRabbit thread in %s mode', (mode) => {
    expect(hideVerdict(thread(), mode)).toEqual({ hide: true })
  })

  it('keeps a thread with a human reply in safe mode', () => {
    expect(hideVerdict(thread({}, withHumanReply), 'safe')).toEqual({ hide: false, reason: 'human-activity' })
  })

  it('hides a thread with a human reply in aggressive mode', () => {
    expect(hideVerdict(thread({}, withHumanReply), 'aggressive')).toEqual({ hide: true })
  })

  // The one rule the two modes differ by, stated as such: everything else in
  // this file has to answer the same in both.
  it('differs between the modes on human activity and nothing else', () => {
    const cases: Thread[] = [
      thread(),
      thread({ collapsed: true }),
      thread({ problems: ['no-id'] }),
      thread({ authors: null, problems: ['unknown-author'] }),
      thread({ collapsed: true, authors: null, problems: ['unknown-author', 'fetch-failed'] }),
      thread({}, { rootIsCodeRabbit: false }),
      thread({}, { pending: 1, comments: 1, fromCodeRabbit: 0, fromHumans: 1, allFromCodeRabbit: false }),
    ]

    for (const t of cases) {
      expect(hideVerdict(t, 'safe')).toEqual(hideVerdict(t, 'aggressive'))
    }
  })

  it.each(MODES)('keeps a thread with a pending comment in %s mode', (mode) => {
    const pending = { comments: 2, fromCodeRabbit: 1, fromHumans: 1, pending: 1, allFromCodeRabbit: false }
    expect(hideVerdict(thread({}, pending), mode)).toEqual({ hide: false, reason: 'pending' })
  })

  // Not a hypothetical: a CodeRabbit reply on a human's thread makes every
  // comment but the root CodeRabbit's, and aggressive mode still may not touch
  // it. This is invariant 2 rather than a mode preference.
  it.each(MODES)('keeps a thread CodeRabbit did not start in %s mode', (mode) => {
    const humanRoot = { comments: 2, fromCodeRabbit: 1, fromHumans: 1, allFromCodeRabbit: false, rootIsCodeRabbit: false }
    expect(hideVerdict(thread({}, humanRoot), mode)).toEqual({ hide: false, reason: 'not-coderabbit' })
  })

  const BLOCKING: ParseProblem[] = ['no-id', 'unknown-author', 'no-body']

  it.each(BLOCKING)('keeps a thread carrying the blocking problem %s', (problem) => {
    for (const mode of MODES) {
      expect(hideVerdict(thread({ problems: [problem] }), mode)).toEqual({ hide: false, reason: 'unparsed' })
    }
  })

  // 'fetch-failed' blocks as hard as the other three. It is listed apart
  // because it answers with its own reason rather than with 'unparsed', which
  // is what lets the drawer say the network failed rather than the markup did.
  it.each(MODES)('keeps a thread carrying the blocking problem fetch-failed in %s mode', (mode) => {
    expect(hideVerdict(thread({ problems: ['fetch-failed'] }), mode)).toEqual({
      hide: false,
      reason: 'fetch-failed',
    })
  })

  const GAPS: ParseProblem[] = ['no-file', 'no-triple']

  it.each(GAPS)('still hides a thread whose only problem is the gap %s', (problem) => {
    for (const mode of MODES) {
      expect(hideVerdict(thread({ problems: [problem], file: null }), mode)).toEqual({ hide: true })
    }
  })

  it('keeps a thread with no attribution at all', () => {
    const unattributed = thread({ authors: null, problems: ['unknown-author'] })
    expect(hideVerdict(unattributed, 'aggressive')).toEqual({ hide: false, reason: 'unparsed' })
  })

  it.each(MODES)('keeps a collapsed thread in %s mode', (mode) => {
    // As A2 produces them: no body in the page, so no attribution either.
    const collapsed = thread({
      collapsed: true,
      deferredUrl: '/owner/repo/pull/1/threads/1',
      authors: null,
      problems: ['unknown-author'],
    })
    expect(hideVerdict(collapsed, mode)).toEqual({ hide: false, reason: 'collapsed' })
  })

  // The departure from the build plan's rule order, pinned so it is a decision
  // rather than an accident. Both readings keep the thread visible; this one
  // reports the reason that has a fix.
  it('reports collapsed rather than unparsed when a thread is both', () => {
    const both = thread({ collapsed: true, authors: null, problems: ['unknown-author', 'no-id'], id: '' })
    expect(hideVerdict(both, 'safe')).toEqual({ hide: false, reason: 'collapsed' })
  })

  // B3. A thread whose comments came back off the deferred endpoint is
  // attributed, and 'collapsed' is a statement about the page rather than a
  // permanent veto: it stays true and stops mattering.
  it.each(MODES)('hides a collapsed thread the fetch read back, in %s mode', (mode) => {
    const fetched = thread({ collapsed: true, deferredUrl: '/owner/repo/pull/1/threads/1', resolved: true })
    expect(hideVerdict(fetched, mode)).toEqual({ hide: true })
  })

  it.each(MODES)('keeps a thread whose fetch failed, in %s mode', (mode) => {
    const failed = thread({
      collapsed: true,
      deferredUrl: '/owner/repo/pull/1/threads/1',
      authors: null,
      problems: ['unknown-author', 'fetch-failed'],
    })
    expect(hideVerdict(failed, mode)).toEqual({ hide: false, reason: 'fetch-failed' })
  })

  // The more specific of the two answers wins, for the same reason 'collapsed'
  // beats 'unparsed': the fetch that would have fixed 'collapsed' has already
  // run, so telling the reader to wait for it would be a lie.
  it('reports fetch-failed rather than collapsed when a thread is both', () => {
    const both = thread({ collapsed: true, authors: null, problems: ['unknown-author', 'fetch-failed'] })
    expect(hideVerdict(both, 'safe')).toEqual({ hide: false, reason: 'fetch-failed' })
  })

  // Resolved and outdated say nothing about authorship, so they say nothing
  // here. What to do with a resolved thread is the panel's decision, not this
  // module's.
  it.each(MODES)('ignores resolved and outdated in %s mode', (mode) => {
    expect(hideVerdict(thread({ resolved: true, outdated: true }), mode)).toEqual({ hide: true })
  })
})
