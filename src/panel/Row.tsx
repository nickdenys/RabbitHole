import { useLayoutEffect, useState } from 'preact/hooks'
import type { TriageRow } from '../engine'
import type { Severity } from '../types'
import { copyPrompt, resolveThread, revealThread } from './actions'
import { badges, keptReason } from './rows'

interface RowProps {
  row: TriageRow
}

/**
 * How long a resolve may sit unconfirmed before the row stops waiting.
 *
 * GitHub's own handler posts the form and swaps the thread partial, and the
 * engine's pass is debounced 150ms behind that, so a healthy resolve lands well
 * inside this. Past it the honest report is that nothing came back, not a
 * spinner that never ends and not a done state nobody confirmed.
 */
const RESOLVE_TIMEOUT_MS = 5_000

/**
 * What the row is doing about a resolve, which is never the same as whether the
 * thread is resolved.
 *
 *   'idle'         nothing in flight; the badge and the strikethrough are the page's
 *   'waiting'      the button was clicked and no pass has confirmed it yet
 *   'stalled'      the wait ran out, so the row offers the click again
 *   'unavailable'  GitHub rendered no resolve button, which needs write access
 */
type ResolveState = 'idle' | 'waiting' | 'stalled' | 'unavailable'

/** The last thing a copy did, shown until the next one. */
type CopyState = 'idle' | 'copied' | 'no-prompt' | 'failed'

/**
 * One finding, as one line of the worklist, with the three things you can do to
 * it.
 *
 * Everything here is text put in as text. Nothing from the page is ever
 * injected as markup, which is both the rule for A9 and the shape B3 needs,
 * since a fetched thread arrives as HTML from the network.
 */
export function Row({ row }: RowProps) {
  const { thread, finding } = row
  const severity = finding?.severity ?? null
  const reason = keptReason(row)

  const [resolveState, setResolveState] = useState<ResolveState>('idle')
  const [copyState, setCopyState] = useState<CopyState>('idle')

  // The wait ends on GitHub's own attribute or on the clock, and on nothing
  // else. `thread.resolved` is a fresh read every pass, so the effect's deps
  // are the two facts that can end it rather than the row object, which is new
  // on every pass and would restart the timer forever.
  //
  // Layout rather than plain: preact defers `useEffect` to after paint, through
  // a `requestAnimationFrame` with a 100ms fallback, which would start the five
  // second clock somewhere the row does not control. This one is a timer and a
  // comparison, no measuring and no paint, so committing it synchronously is
  // both cheaper and the only way the wait means five seconds.
  useLayoutEffect(() => {
    if (resolveState !== 'waiting') return
    if (thread.resolved) {
      setResolveState('idle')
      return
    }

    const timer = setTimeout(() => setResolveState('stalled'), RESOLVE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [resolveState, thread.resolved])

  function onResolve(): void {
    // A new action supersedes whatever the last one said, and the two share one
    // line, so the copy outcome is dropped rather than left to argue with it.
    setCopyState('idle')
    setResolveState(resolveThread(row) ? 'waiting' : 'unavailable')
  }

  async function onCopy(): Promise<void> {
    if (!finding?.aiPrompt) {
      setCopyState('no-prompt')
      return
    }
    setCopyState((await copyPrompt(row)) ? 'copied' : 'failed')
  }

  const message = status(resolveState, copyState)

  return (
    <li class={thread.resolved ? 'row done' : 'row'}>
      <span
        class={`dot ${severity ?? 'none'}`}
        role="img"
        aria-label={`Severity: ${severityLabel(severity)}`}
        title={severityLabel(severity)}
      />
      <div class="row-body">
        <p class="row-title">{finding?.title ?? 'This thread could not be read'}</p>
        <p class="row-file">{thread.file ?? 'File unknown'}</p>
        {(finding?.category || finding?.effort) && (
          <p class="row-triple">
            {[finding.category, finding.effort].filter(Boolean).join(' · ')}
          </p>
        )}
        {badges(row).length > 0 && (
          <p class="row-badges">
            {badges(row).map((badge) => (
              <span class={`badge ${badge.toLowerCase().replace(' ', '-')}`} key={badge}>
                {badge}
              </span>
            ))}
          </p>
        )}
        {reason !== null && <p class="row-reason">{reason}</p>}

        <p class="row-actions">
          <button class="action reveal" type="button" onClick={() => revealThread(row)}>
            Show in timeline
          </button>
          <button class="action copy" type="button" onClick={onCopy}>
            Copy prompt
          </button>
          {!thread.resolved && (
            <button
              class="action resolve"
              type="button"
              onClick={onResolve}
              disabled={resolveState === 'waiting'}
            >
              {resolveState === 'stalled' ? 'Resolve again' : 'Resolve'}
            </button>
          )}
        </p>

        {message !== null && <p class="row-status">{message}</p>}
      </div>
    </li>
  )
}

/**
 * One line under the buttons, saying what the last action did.
 *
 * A resolve in flight outranks everything, because it is the only state where
 * the row is waiting on something. After that the newest outcome speaks, which
 * `onResolve` arranges by clearing the copy state. `stalled` and `unavailable`
 * therefore survive a later copy on the button's label but not on this line.
 *
 * Every wording here is about the click. None of them claims the thread is
 * resolved, which is `data-resolved`'s to say and arrives as the badge and the
 * strikethrough instead.
 */
function status(resolve: ResolveState, copy: CopyState): string | null {
  if (resolve === 'waiting') return 'Resolving, waiting for GitHub…'

  switch (copy) {
    case 'copied':
      return 'Prompt copied.'
    case 'no-prompt':
      return 'This comment carries no agent prompt.'
    case 'failed':
      return 'The clipboard refused. Click the page and try again.'
    case 'idle':
      break
  }

  switch (resolve) {
    case 'stalled':
      return 'GitHub did not confirm that. Nothing was changed here, try again.'
    case 'unavailable':
      return 'No resolve button on this thread: it needs write access to the repository.'
    default:
      return null
  }
}

/**
 * A missing severity is a gap in CodeRabbit's own comment, not a failure, so it
 * reads as one rather than as a blank.
 */
function severityLabel(severity: Severity | null): string {
  if (severity === null) return 'not stated'
  return severity
}
