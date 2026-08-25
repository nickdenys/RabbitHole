import { countCheck, NO_CHECK, type CountCheck } from './count'
import { detectPage, pullRequestKey } from './detect'
import { parseThreadFragment, type FetchedThread } from './fetch/parse'
import { fetchThreadHtml } from './fetch/threads'
import { applyHiding, revealAll } from './hide/apply'
import { hideVerdict, type HideVerdict } from './hide/policy'
import { clickLoadMore } from './loadmore'
import { forgetSessionFindings } from './panel/actions'
import { readFinding } from './parse/finding'
import { scanNotes, type CodeRabbitNote } from './parse/notes'
import { scanThreads } from './parse/thread'
import { DEFAULT_PREFS, savePrefs, type Prefs } from './prefs'
import type { Finding, PageKind, Thread } from './types'

/**
 * One thread, with everything the drawer needs to draw a line about it.
 *
 * The verdict travels with the row because a row that stayed in the timeline
 * has to say why, and the reason is the policy's answer rather than something
 * the panel can re-derive: the mode that produced it lives here, not there.
 * `finding` is null exactly when the thread has no body the extension has read:
 * none in the page, and none fetched back off the deferred endpoint either.
 */
export interface TriageRow {
  thread: Thread
  finding: Finding | null
  verdict: HideVerdict
}

/**
 * Everything one pass learned about the page, and the only thing the panel is
 * given.
 *
 * `hidden` carries thread ids rather than elements so the drawer can ask about
 * a row it is already holding without keeping a second reference to the DOM.
 * A thread with no id is never hidden (invariant 1), so the empty id can never
 * end up in the set.
 */
export interface TriageState {
  kind: PageKind
  threads: Thread[]
  /**
   * The same threads, in the same order, carrying their finding and their
   * verdict. `threads` stays because it is the scan's own output and half the
   * suite reads it; `rows` is that plus the two things only the panel wants,
   * holding the same `Thread` objects rather than copies of them.
   */
  rows: TriageRow[]
  notes: CodeRabbitNote[]
  hidden: Set<string>
  counts: { total: number; unresolved: number; hidden: number; unparsed: number }
  /**
   * CodeRabbit's own total against the threads in the page, which is the one
   * number in this state that is about GitHub rather than about the review.
   *
   * It lives beside `counts` rather than in it because it is not a count of
   * anything the extension found: `counts` describes what was read, and this
   * describes what was not. See `countCheck`.
   */
  check: CountCheck
  /**
   * Ask for the resolved threads to be read back off GitHub, which is the
   * deferred fetch and the only network this extension does.
   *
   * The panel calls it while the drawer is open and nothing calls it otherwise,
   * which is the whole of "lazy, on panel open": a reader who never opens the
   * drawer costs GitHub nothing, and the worklist is never behind a request.
   *
   * Idempotent, cheap, and safe to call on every render. It starts a request
   * only for a collapsed thread that has no answer and none in flight, so the
   * second call after the last fragment lands does nothing at all. Results
   * arrive as further published states rather than through a promise, because a
   * pass is the only thing that may decide what the page looks like.
   */
  readResolved: () => void
  /**
   * The reader's four choices, as of this pass. `hideMode` is the one the
   * engine acts on; the rest are here because the panel is only ever given a
   * state, and a second channel into it would be a second thing to keep in step
   * with Turbo.
   */
  prefs: Prefs
  /**
   * Change one or more of them, saving them and, for `hideMode`, re-deciding
   * the page.
   *
   * The mode change is a pass rather than a scheduled one: it is a click, the
   * reader is looking at the timeline, and A7's rule that a pass owns the whole
   * hidden set is what makes it an ordinary recompute rather than an undo.
   * Nothing else here touches the DOM, so the sort axis, the theme and the
   * drawer's state are saved and no pass is run for them.
   */
  setPrefs: (prefs: Partial<Prefs>) => void
}

/** Long enough to coalesce a Turbo render, short enough to feel immediate. */
const SETTLE_MS = 150

/** The two elements the extension puts in the light DOM. See `isOurs`. */
const OUR_IDS = new Set(['coderabbit-triage-root', 'coderabbit-triage-style'])

/**
 * Run detect, scan, decide and apply, now and on every change, and hand the
 * result to `onState`.
 *
 * This is the only place the modules are composed. Everything upstream is pure
 * or reads the page; `hide/apply.ts` is the only thing that writes to it.
 *
 * **One engine outlives every navigation.** GitHub moves with Turbo, so the
 * content script is injected once and the page changes underneath it: a pass
 * therefore has to ask where it is, not assume it is where the last one was.
 * Arriving at a different pull request is a reset and never a merge, and
 * leaving pull requests altogether is the same reset with nothing after it.
 *
 * The returned function is a full teardown: the observer stops, the listener
 * goes, a pending pass is cancelled, and the page is restored to the state it
 * would have been in without the extension.
 */
export function startEngine(
  doc: Document,
  onState: (state: TriageState) => void,
  initial: Prefs = DEFAULT_PREFS,
): () => void {
  let scheduled: ReturnType<typeof setTimeout> | undefined

  /**
   * The prefs every pass reads, which the caller has already loaded.
   *
   * Loaded before the engine starts rather than inside it, so the first pass
   * hides with the mode the reader chose. Reading them here would mean hiding
   * in safe mode and then hiding again in aggressive one tick later, which is
   * a reader watching their comments disappear twice.
   */
  let prefs = initial

  /**
   * The pull request the last pass read, `null` for a page that is not one, and
   * `undefined` before the first pass has run. The third value is not the same
   * as the second: starting on a page is not arriving at it, and there is
   * nothing of ours to throw away yet.
   */
  let page: string | null | undefined

  /**
   * What the deferred endpoint said about each collapsed thread, keyed by the
   * thread's page id, `null` for one it could not answer for.
   *
   * Keyed rather than held on the `Thread`, because a pass throws every `Thread`
   * away and scans fresh ones: this is the one thing that has to survive that,
   * and an id is the only handle that survives with it.
   *
   * `null` is a real answer and stays in the map, so a dead thread is asked
   * about once per page rather than on every pass, and the row that says
   * "could not be fetched" keeps saying it.
   */
  const fetched = new Map<string, FetchedThread | null>()

  /** Thread ids with a request in flight, so no pass asks for one twice. */
  const inFlight = new Set<string>()

  /** The engine's, per [[Build plan|B2]]: tripped on navigation and on teardown. */
  let fetches: AbortController | null = null

  /** The threads of the last published pass, which is what `readResolved` reads. */
  let published: Thread[] = []

  function pass(): void {
    const url = pageUrl(doc)
    const current = pullRequestKey(url)

    // Order matters. The reset has to happen before the scan, so the pass that
    // reads the new page is also the pass that publishes it: reset afterwards
    // and the panel would draw the old pull request's findings for one frame,
    // over a page they are not on.
    if (page !== undefined && current !== page) forget()
    page = current

    const state = runPass(doc, url, fetched, prefs, readResolved, setPrefs)
    published = state.threads
    onState(state)
  }

  /**
   * Remember a choice, and redecide the page if it was the one that changes
   * what may be hidden.
   *
   * The save is not awaited, and the pass does not wait for it either: the
   * timeline should change on the click, and a write that fails is a preference
   * that reverts next visit rather than a hide that did not happen.
   */
  function setPrefs(next: Partial<Prefs>): void {
    const before = prefs
    prefs = { ...prefs, ...next }
    void savePrefs(next)

    if (prefs.hideMode !== before.hideMode) pass()
  }

  function schedule(records: MutationRecord[]): void {
    if (records.every(isOurs)) return
    schedulePass()
  }

  /**
   * A pass, soon, and at most one. Shared by the mutation observer and by every
   * fragment that lands, so a burst of either coalesces into one recompute
   * instead of one per event. On a 97 thread pull request that is the whole
   * difference between a fetch that fills the drawer and a fetch that reparses
   * an 8 MB page 97 times.
   */
  function schedulePass(): void {
    if (scheduled !== undefined) return

    scheduled = setTimeout(() => {
      scheduled = undefined
      pass()
    }, SETTLE_MS)
  }

  /**
   * Start reading whatever collapsed threads still have no answer.
   *
   * Called by the panel while its drawer is open, on every render, which is why
   * it does nothing at all in the common case: a thread already answered for or
   * already in flight is skipped, so the second call is a walk over a list and
   * no request. It also means a thread resolved after the drawer was opened is
   * picked up by the next render rather than needing the drawer closed and
   * reopened.
   */
  function readResolved(): void {
    const wanted = new Map<string, string>()

    for (const thread of published) {
      if (!thread.collapsed || thread.deferredUrl === null || thread.id === '') continue
      if (fetched.has(thread.id) || inFlight.has(thread.id)) continue

      wanted.set(thread.deferredUrl, thread.id)
      inFlight.add(thread.id)
    }

    if (wanted.size === 0) return

    fetches ??= new AbortController()
    void read(wanted, fetches.signal)
  }

  /**
   * Consume one batch of fragments, publishing as they arrive.
   *
   * Never throws and never rejects: `fetchThreadHtml` flattens every failure to
   * a null body, and a fragment that will not parse is the same fact one step
   * later, so both land in the map as `null` and become a row that says so.
   */
  async function read(wanted: Map<string, string>, signal: AbortSignal): Promise<void> {
    for await (const { url, html } of fetchThreadHtml([...wanted.keys()], { signal })) {
      const id = wanted.get(url)
      if (id === undefined) continue

      wanted.delete(url)
      inFlight.delete(id)
      fetched.set(id, html === null ? null : parseThreadFragment(html))
      schedulePass()
    }

    // An abort ends the iteration with requests unanswered. They are not in
    // flight any more and they are not answers either, so the ids go back to
    // being askable: on this page nothing will ask again, because an abort only
    // happens on the way off it, and `forget` is about to clear the map anyway.
    for (const id of wanted.values()) inFlight.delete(id)
  }

  /**
   * The per page reset, which is the deferred fetch's as well as the page's.
   *
   * Aborting matters more here than anywhere else: a request started on the
   * pull request being left would otherwise land in the map for the pull
   * request being arrived at, keyed by an id that may well exist there too, and
   * put one review's finding on another review's row.
   */
  function forget(): void {
    fetches?.abort()
    fetches = null
    fetched.clear()
    inFlight.clear()
    published = []
    forgetPage(doc)
  }

  const observer = new MutationObserver(schedule)
  observer.observe(doc.documentElement, { childList: true, subtree: true })

  // GitHub navigates with Turbo, so the content script survives page changes
  // without reinjection. A soft navigation is a new page and gets an immediate
  // pass rather than a debounced one.
  doc.addEventListener('turbo:load', pass)

  pass()

  return () => {
    observer.disconnect()
    doc.removeEventListener('turbo:load', pass)
    clearTimeout(scheduled)
    forget()
  }
}

/**
 * Drop everything the extension is holding about the page it was on.
 *
 * Two things outlive a pass, and both are per page rather than per session:
 * `hide/apply` holds the reveal set and the last applied targets, and `actions`
 * holds the findings of threads resolved here. Carried into a different pull
 * request they are not stale so much as wrong: the session cache would put
 * another pull request's finding in this one's checklist, which is a data
 * correctness bug rather than a cosmetic one.
 *
 * A full recompute means the threads themselves need no clearing; only the
 * state deliberately kept between passes does. Nothing else is remembered, so
 * this is the whole of it.
 *
 * The panel is not unmounted here. It is drawn from the published state and
 * takes itself down when that state says `not-pr`, so a teardown that reached
 * into it would be a second, disagreeing path to the same thing.
 */
function forgetPage(doc: Document): void {
  revealAll(doc)
  forgetSessionFindings()
}

/**
 * One full recompute, never a diff.
 *
 * Threads arrive late, Turbo swaps the body and GitHub rerenders, so any state
 * carried between passes is state that can drift out of step with the page.
 * Rescanning costs a few milliseconds on the largest fixture, which is less
 * than the bug of hiding a thread that is no longer there.
 */
function runPass(
  doc: Document,
  url: string,
  fetched: ReadonlyMap<string, FetchedThread | null>,
  prefs: Prefs,
  readResolved: () => void,
  setPrefs: (prefs: Partial<Prefs>) => void,
): TriageState {
  const kind = detectPage(doc, url)

  // Invariant 3 in code. An unrecognised build is not an empty page, and the
  // difference is the whole reason this returns `kind` rather than a boolean:
  // the panel says "this build cannot be read", and nothing is hidden. The
  // reveal matters because Turbo can navigate from a page we did read.
  if (kind !== 'classic') {
    revealAll(doc)
    return {
      kind,
      threads: [],
      rows: [],
      notes: [],
      hidden: new Set(),
      counts: NO_COUNTS,
      check: NO_CHECK,
      readResolved,
      prefs,
      setPrefs,
    }
  }

  const notes = scanNotes(doc)

  // Read once per pass, not once per render: the panel redraws on its own
  // state (opening, sorting from A10) and re-reading the page on every one of
  // those would put the parsers back in the render path.
  //
  // The page is read first and the fetch second, always. A thread GitHub has
  // rendered is described by what is on the screen, and a fragment is only ever
  // consulted for a thread whose comments are not there at all.
  const threads: Thread[] = []
  const rows: TriageRow[] = []

  for (const scanned of scanThreads(doc)) {
    const entry = scanned.collapsed ? fetched.get(scanned.id) : undefined
    const thread = merge(scanned, entry)

    threads.push(thread)
    rows.push({
      thread,
      finding: readFinding(thread.el) ?? entry?.finding ?? null,
      verdict: hideVerdict(thread, prefs.hideMode),
    })
  }

  const verdicts = new Map<Thread, HideVerdict>(rows.map((row) => [row.thread, row.verdict]))
  const hideable = threads.filter((thread) => verdicts.get(thread)?.hide)

  applyHiding([...hideable.map((thread) => thread.el), ...notes.map((note) => note.el)], doc)

  const check = countCheck(notes, rows, doc)

  // Click GitHub's own "Load more" for the reader, never ours to fetch. The
  // click is itself a DOM mutation, so it needs no scheduling of its own: it
  // reaches the observer already watching this document and comes back around
  // as the next pass, which checks `missing` again against whatever GitHub
  // just rendered. A page with nothing missing, or nothing left to click,
  // leaves this a no-op every time it runs: `check.more` is the second of
  // those, already read by the check itself.
  if (prefs.autoLoadMore && check.missing > 0 && check.more) clickLoadMore(doc)

  return {
    kind,
    threads,
    rows,
    notes,
    hidden: new Set(hideable.map((thread) => thread.id)),
    check,
    counts: {
      total: threads.length,
      unresolved: threads.filter((thread) => !thread.resolved).length,
      hidden: hideable.length,
      unparsed: threads.filter((thread) => isUnparsed(verdicts.get(thread))).length,
    },
    readResolved,
    prefs,
    setPrefs,
  }
}

/**
 * One scanned thread, plus whatever the deferred fetch made of it.
 *
 * A new object rather than a mutation, so the scan's own output is never
 * rewritten under a caller holding it, and `undefined` means the fetch has
 * nothing to say yet and the thread is returned exactly as scanned.
 *
 * What the fragment supplies is authorship, and only authorship. Identity,
 * `resolved`, `outdated`, the file and `collapsed` itself stay with the stub in
 * the page, which is the only place they exist: the fragment carries no
 * `data-resolved`, no id and no path. See [[DOM reference]].
 *
 * A fetch that failed adds a blocking problem instead of removing one, which is
 * the rule that keeps a dead thread on the screen. `unknown-author` goes only
 * when the answer arrived, because that problem is the claim that nobody has
 * read this thread, and now somebody has.
 */
function merge(thread: Thread, entry: FetchedThread | null | undefined): Thread {
  if (entry === undefined) return thread

  if (entry === null) return { ...thread, problems: [...thread.problems, 'fetch-failed'] }

  return {
    ...thread,
    authors: entry.authors,
    problems: thread.problems.filter((problem) => problem !== 'unknown-author'),
  }
}

const NO_COUNTS = { total: 0, unresolved: 0, hidden: 0, unparsed: 0 }

/**
 * Threads the panel should warn about, which is not the same as threads with a
 * problem.
 *
 * A collapsed thread also has no authors and also carries a blocking problem,
 * but that is the expected state of every resolved thread the fetch has not
 * answered for yet, and counting those here would light the warning on almost
 * every pull request and teach the reader to ignore it. The policy already
 * separates the two, so this reads its answer instead of re-deriving one.
 *
 * A fetch that came back empty is counted, because it is the opposite case: the
 * extension asked, GitHub did not answer, and there is nothing further coming
 * that would resolve it. That is exactly what the handle's warning is for.
 */
function isUnparsed(verdict: HideVerdict | undefined): boolean {
  if (verdict === undefined || verdict.hide) return false
  return verdict.reason === 'unparsed' || verdict.reason === 'fetch-failed'
}

/**
 * Ignore the mutations the engine itself causes, which are always insertions:
 * the stylesheet into the head and the panel host into the body. Left in, they
 * schedule a pass that inserts nothing new and schedules nothing further, so
 * the loop is finite rather than infinite. It is still work done for no reason
 * on every pass, on a page that is already churning.
 *
 * **Insertions only.** A record that removes one of our elements is GitHub
 * acting on us, not us acting on the page, and the pass it triggers is what
 * puts the stylesheet back. Ignoring those would swallow the one signal
 * `ensureStylesheet` exists to answer.
 *
 * The panel's own renders never reach here at all: it draws inside a shadow
 * root, which is a separate tree that a MutationObserver on this document does
 * not see. Only the host's insertion is visible, and only once.
 */
function isOurs(record: MutationRecord): boolean {
  if (record.removedNodes.length > 0) return false

  const added = [...record.addedNodes]
  return added.length > 0 && added.every(isOurNode)
}

function isOurNode(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && OUR_IDS.has((node as Element).id)
}

/**
 * The URL the document is being served at.
 *
 * In the extension `doc` is always `document` and this is `location.href`. It
 * is read off the document rather than the global so that the engine has one
 * input, which is also what lets a test point a parsed fixture at a pull
 * request URL. `baseURI` is the fallback for a document with no window at all,
 * where the honest verdict is `not-pr` and nothing is hidden either way.
 */
function pageUrl(doc: Document): string {
  return doc.defaultView?.location.href ?? doc.baseURI
}
