import { detectPage } from './detect'
import { applyHiding, revealAll } from './hide/apply'
import { hideVerdict, type HideMode, type HideVerdict } from './hide/policy'
import { readFinding } from './parse/finding'
import { scanNotes, type CodeRabbitNote } from './parse/notes'
import { scanThreads } from './parse/thread'
import type { Finding, PageKind, Thread } from './types'

/**
 * One thread, with everything the drawer needs to draw a line about it.
 *
 * The verdict travels with the row because a row that stayed in the timeline
 * has to say why, and the reason is the policy's answer rather than something
 * the panel can re-derive: the mode that produced it lives here, not there.
 * `finding` is null exactly when the thread has no body in the page, which is
 * every collapsed thread until the B2 fetch.
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
}

/** Long enough to coalesce a Turbo render, short enough to feel immediate. */
const SETTLE_MS = 150

/**
 * Safe until B7 puts the toggle behind a preference. A7 established that a pass
 * owns the whole hidden set, so switching this later needs no undo path: the
 * next pass simply names fewer elements and the rest come back.
 */
const MODE: HideMode = 'safe'

/** The two elements the extension puts in the light DOM. See `isOurs`. */
const OUR_IDS = new Set(['coderabbit-triage-root', 'coderabbit-triage-style'])

/**
 * Run detect, scan, decide and apply, now and on every change, and hand the
 * result to `onState`.
 *
 * This is the only place the modules are composed. Everything upstream is pure
 * or reads the page; `hide/apply.ts` is the only thing that writes to it.
 *
 * The returned function is a full teardown: the observer stops, the listener
 * goes, a pending pass is cancelled, and the page is restored to the state it
 * would have been in without the extension.
 */
export function startEngine(doc: Document, onState: (state: TriageState) => void): () => void {
  let scheduled: ReturnType<typeof setTimeout> | undefined

  function pass(): void {
    onState(runPass(doc))
  }

  function schedule(records: MutationRecord[]): void {
    if (records.every(isOurs)) return
    if (scheduled !== undefined) return

    scheduled = setTimeout(() => {
      scheduled = undefined
      pass()
    }, SETTLE_MS)
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
    revealAll(doc)
  }
}

/**
 * One full recompute, never a diff.
 *
 * Threads arrive late, Turbo swaps the body and GitHub rerenders, so any state
 * carried between passes is state that can drift out of step with the page.
 * Rescanning costs a few milliseconds on the largest fixture, which is less
 * than the bug of hiding a thread that is no longer there.
 */
function runPass(doc: Document): TriageState {
  const kind = detectPage(doc, pageUrl(doc))

  // Invariant 3 in code. An unrecognised build is not an empty page, and the
  // difference is the whole reason this returns `kind` rather than a boolean:
  // the panel says "this build cannot be read", and nothing is hidden. The
  // reveal matters because Turbo can navigate from a page we did read.
  if (kind !== 'classic') {
    revealAll(doc)
    return { kind, threads: [], rows: [], notes: [], hidden: new Set(), counts: NO_COUNTS }
  }

  const threads = scanThreads(doc)
  const notes = scanNotes(doc)

  // Read once per pass, not once per render: the panel redraws on its own
  // state (opening, sorting from A10) and re-reading the page on every one of
  // those would put the parsers back in the render path.
  const rows: TriageRow[] = threads.map((thread) => ({
    thread,
    finding: readFinding(thread.el),
    verdict: hideVerdict(thread, MODE),
  }))

  const verdicts = new Map<Thread, HideVerdict>(rows.map((row) => [row.thread, row.verdict]))
  const hideable = threads.filter((thread) => verdicts.get(thread)?.hide)

  applyHiding([...hideable.map((thread) => thread.el), ...notes.map((note) => note.el)], doc)

  return {
    kind,
    threads,
    rows,
    notes,
    hidden: new Set(hideable.map((thread) => thread.id)),
    counts: {
      total: threads.length,
      unresolved: threads.filter((thread) => !thread.resolved).length,
      hidden: hideable.length,
      unparsed: threads.filter((thread) => isUnparsed(verdicts.get(thread))).length,
    },
  }
}

const NO_COUNTS = { total: 0, unresolved: 0, hidden: 0, unparsed: 0 }

/**
 * Threads the panel should warn about, which is not the same as threads with a
 * problem.
 *
 * A collapsed thread also has no authors and also carries a blocking problem,
 * but that is the expected state of every resolved thread until B2 fetches it,
 * and counting those here would light the warning on almost every pull request
 * and teach the reader to ignore it. The policy already separates the two, so
 * this reads its answer instead of re-deriving one.
 */
function isUnparsed(verdict: HideVerdict | undefined): boolean {
  return verdict !== undefined && !verdict.hide && verdict.reason === 'unparsed'
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
