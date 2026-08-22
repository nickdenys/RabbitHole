import { useContext, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { TriageRow } from '../engine'
import type { Severity } from '../types'
import {
  copyPrompt,
  filesChangedUrl,
  openInFiles,
  resolveThread,
  showsInTimeline,
  toggleInTimeline,
  unresolveThread,
} from './actions'
import { categoryMark } from './category'
import { anchorTo, layerTop, PATH_TIP_DELAY_MS, Tips, useDismiss, type Anchor } from './overlay'
import { badges, keptReason } from './rows'

interface RowProps {
  row: TriageRow
  /**
   * Whether the row has to carry its own severity dot.
   *
   * False under the severity headings, where the heading is already the colour
   * and a dot on every row would be the same fact said twice. True on every
   * other axis, where the dot is the only place a severity appears at all.
   */
  showSeverity: boolean
  /** Whether this row's overflow menu is the one the drawer is showing. */
  menuOpen: boolean
  /** Ask the drawer to show this row's menu, or to show none. */
  onMenu: (open: boolean) => void
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
 * The menu's height, so it can decide to open upward before it is drawn.
 *
 * A constant rather than a measurement because the menu is a fixed list: three
 * items and two rules, or four items when the finding has a permalink. Erring
 * high costs an early flip on a row near the bottom, which is the harmless
 * direction.
 */
const MENU_HEIGHT = 190

/**
 * What the row is doing about a resolve or an unresolve, which is never the
 * same as whether the thread is resolved.
 *
 *   'idle'         nothing in flight; the box and the strikethrough are the page's
 *   'waiting'      the box was clicked and no pass has confirmed it yet
 *   'stalled'      the wait ran out, so the row offers the click again
 *   'expanding'    the thread was collapsed, so it is being expanded first
 *   'unavailable'  GitHub rendered no button, which needs write access
 *
 * `want` is the `data-resolved` the row is waiting for the page to report, so
 * one machine serves both directions. It is not a claim about the thread: it is
 * what the click asked for, and only a pass can say whether it happened.
 *
 * The tick box is one control on both sides of `thread.resolved`, so a single
 * machine can never be describing both at once.
 */
type ActionState =
  | { kind: 'idle' }
  | { kind: 'expanding' }
  | { kind: 'waiting' | 'stalled' | 'unavailable'; want: boolean }

const IDLE: ActionState = { kind: 'idle' }

/** The last thing a copy did, shown until the next one. */
type CopyState = 'idle' | 'copied' | 'no-prompt' | 'failed'

/**
 * One finding, as one line of the worklist, with the things you can do to it.
 *
 * The tick box resolves and reopens, the ⧉ copies the agent prompt, and the ⋯
 * holds the rest, which is where a fourth and fifth button would otherwise have
 * to fit across 404 pixels. Everything the row knows and the icons do not say
 * is still on the row: the badges, the reason a finding stayed in the timeline,
 * and the line that reports what the last click actually did.
 *
 * Everything here is text put in as text. Nothing from the page is ever
 * injected as markup, which is both the rule for A9 and the shape B3 needs,
 * since a fetched thread arrives as HTML from the network.
 */
export function Row({ row, showSeverity, menuOpen, onMenu }: RowProps) {
  const { thread, finding } = row
  const severity = finding?.severity ?? null
  const reason = keptReason(row)
  const marks = badges(row)

  // The pill prints less than CodeRabbit wrote for every category the panel has
  // a word for, so the words it dropped go on the tooltip. Null when it dropped
  // none, because a tooltip that repeats the label under it is a second account
  // of one thing rather than the rest of it.
  const category = finding?.category ?? null
  const mark = category === null ? null : categoryMark(category)
  const whole = mark !== null && mark.label !== category ? category : null

  const [actionState, setActionState] = useState<ActionState>(IDLE)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  // The panel's one tooltip, bound here and drawn at the root, because a
  // tooltip drawn inside the drawer is painted under the collapse tab it
  // reaches past. See `Tips` in `overlay.ts`.
  const tipFor = useContext(Tips)

  // Nothing publishes a new state when a thread goes back into the timeline:
  // the engine's observer watches insertions and removals, so the class the
  // reveal takes off an element schedules no pass. So the title reads the page
  // on every render, and the press bumps this to make a render happen at all.
  const [, redraw] = useState(0)

  const menuButton = useRef<HTMLButtonElement | null>(null)
  const menu = useRef<HTMLDivElement | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<Anchor | null>(null)

  useDismiss(menuOpen, () => onMenu(false), menu, menuButton)

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
    if (actionState.kind !== 'waiting') return
    if (thread.resolved === actionState.want) {
      setActionState(IDLE)
      return
    }

    const want = actionState.want
    const timer = setTimeout(() => setActionState({ kind: 'stalled', want }), RESOLVE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [actionState, thread.resolved])

  function onResolve(): void {
    // A new action supersedes whatever the last one said, and the two share one
    // line, so the copy outcome is dropped rather than left to argue with it.
    setCopyState('idle')
    setActionState({ kind: resolveThread(row) ? 'waiting' : 'unavailable', want: true })
  }

  /**
   * The mirror, with one extra outcome: a collapsed thread has no unresolve
   * button until GitHub has expanded it, so the first press expands and the
   * second unresolves. See `unresolveThread`.
   */
  function onUnresolve(): void {
    setCopyState('idle')

    const outcome = unresolveThread(row)
    setActionState(
      outcome === 'expanding'
        ? { kind: 'expanding' }
        : { kind: outcome === 'clicked' ? 'waiting' : 'unavailable', want: false },
    )
  }

  async function onCopy(): Promise<void> {
    if (!finding?.aiPrompt) {
      setCopyState('no-prompt')
      return
    }
    setCopyState((await copyPrompt(row)) ? 'copied' : 'failed')
  }

  /**
   * Put this finding in the timeline, or take it back out, and either way stop
   * the last action's line from describing a row that has just moved.
   */
  function onTimeline(): void {
    setCopyState('idle')
    toggleInTimeline(row)
    redraw((n) => n + 1)
  }

  /** Every menu item closes the menu, because none of them leaves it useful. */
  function fromMenu(act: () => void): () => void {
    return () => {
      onMenu(false)
      act()
    }
  }

  function toggleMenu(): void {
    if (menuOpen) {
      onMenu(false)
      return
    }
    if (menuButton.current !== null) setMenuAnchor(anchorTo(menuButton.current))
    onMenu(true)
  }

  const message = status(actionState, copyState)
  const busy = actionState.kind === 'waiting'
  const again = actionState.kind === 'stalled'
  const inFiles = filesChangedUrl(row)

  // Only a thread the policy wants hidden has two states to be in, so only that
  // row's title is a toggle. On a row invariant 1 or 2 kept in the timeline the
  // press can only scroll, and saying "pressed" about it would be offering a
  // switch that never flips.
  const toggles = row.verdict.hide
  const shown = showsInTimeline(row)

  return (
    <li class={thread.resolved ? 'row done' : 'row'}>
      <div class="row-main">
        <button
          class={`check action ${thread.resolved ? 'unresolve' : 'resolve'}`}
          type="button"
          role="checkbox"
          aria-checked={thread.resolved}
          aria-label={checkLabel(thread.resolved, again)}
          disabled={busy}
          onClick={thread.resolved ? onUnresolve : onResolve}
          {...tipFor(thread.resolved ? 'Reopen issue' : 'Resolve issue')}
        >
          <span class="check-tick" aria-hidden="true">
            ✓
          </span>
        </button>

        {showSeverity && (
          <span
            class={`dot ${severity ?? 'none'}`}
            role="img"
            aria-label={`Severity: ${severityLabel(severity)}`}
            {...tipFor(`Severity: ${severityLabel(severity)}`)}
          />
        )}

        <button
          class="row-title"
          type="button"
          aria-pressed={toggles ? shown : undefined}
          onClick={onTimeline}
          {...tipFor(timelineTip(toggles, shown), PATH_TIP_DELAY_MS)}
        >
          {finding?.title ?? 'This thread could not be read'}
        </button>

        <span class="row-tools">
          <button
            class="icon action copy"
            type="button"
            aria-label="Copy agent prompt"
            onClick={onCopy}
            {...tipFor('Copy agent prompt')}
          >
            <span aria-hidden="true">⧉</span>
          </button>
          <button
            class={menuOpen ? 'icon more on' : 'icon more'}
            type="button"
            ref={menuButton}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={toggleMenu}
          >
            <span aria-hidden="true">⋯</span>
          </button>
        </span>
      </div>

      <div class="row-meta">
        <span class="row-file" {...tipFor(thread.file ?? 'File unknown', PATH_TIP_DELAY_MS)}>
          {fileName(thread.file)}
        </span>
      </div>

      {(mark !== null || finding?.effort) && (
        <p class="row-pill">
          <span class="pill">
            {mark !== null && (
              <>
                <span class={mark.key === null ? 'pill-dot' : `pill-dot ${mark.key}`} />
                <span class="pill-cat" {...(whole === null ? {} : tipFor(whole))}>
                  {mark.label}
                </span>
              </>
            )}
            {mark !== null && finding?.effort && <span class="pill-rule" />}
            {finding?.effort && <span class="pill-effort">{finding.effort}</span>}
          </span>
        </p>
      )}

      {marks.length > 0 && (
        <p class="row-badges">
          {marks.map((badge) => (
            <span class={`badge ${badge.toLowerCase().replace(' ', '-')}`} key={badge}>
              {badge}
            </span>
          ))}
        </p>
      )}

      {reason !== null && <p class="row-reason">{reason}</p>}
      {message !== null && <p class="row-status">{message}</p>}

      {menuOpen && menuAnchor !== null && (
        <div
          class="menu"
          role="menu"
          ref={menu}
          style={{ top: `${layerTop(menuAnchor, MENU_HEIGHT)}px` }}
        >
          <button
            class="menu-item reveal"
            type="button"
            role="menuitem"
            onClick={fromMenu(onTimeline)}
          >
            <span class="menu-icon" aria-hidden="true">
              ↩
            </span>
            {timelineTip(toggles, shown)}
          </button>
          {inFiles !== null && (
            <button
              class="menu-item files"
              type="button"
              role="menuitem"
              onClick={fromMenu(() => openInFiles(row))}
            >
              <span class="menu-icon" aria-hidden="true">
                ↗
              </span>
              Open in Files changed
            </button>
          )}
          <span class="menu-rule" />
          <button class="menu-item copy" type="button" role="menuitem" onClick={fromMenu(onCopy)}>
            <span class="menu-icon" aria-hidden="true">
              ⧉
            </span>
            Copy agent prompt
          </button>
          <span class="menu-rule" />
          <button
            class={`menu-item done ${thread.resolved ? 'unresolve' : 'resolve'}`}
            type="button"
            role="menuitem"
            onClick={fromMenu(thread.resolved ? onUnresolve : onResolve)}
          >
            <span class="menu-icon tick" aria-hidden="true">
              ✓
            </span>
            {thread.resolved ? 'Reopen issue' : 'Resolve issue'}
          </button>
        </div>
      )}
    </li>
  )
}

/**
 * What pressing the title will do, which is the only place the title's action
 * is written down: the title itself is the finding's own words.
 *
 * One sentence for two places on purpose. The tooltip and the menu item are the
 * same action, and a menu that said "Show in timeline" while the tooltip said
 * "Hide" would be two accounts of one button.
 *
 * The tooltip is delayed like the file path's, and for the same reason: the
 * title is the widest thing on the row and sits under the pointer on the way to
 * everything else, so showing it instantly would flash a box across the list.
 */
function timelineTip(toggles: boolean, shown: boolean): string {
  if (!toggles) return 'Scroll to it in the timeline'
  return shown ? 'Hide it from the timeline' : 'Show it in the timeline'
}

/**
 * The tick box's name, which is the only place its action is written down: the
 * box itself is a tick and a tick alone.
 *
 * `again` is the stalled state, said out loud rather than left to the status
 * line, because a reader on a screen reader meets the control before the line
 * under it.
 */
function checkLabel(resolved: boolean, again: boolean): string {
  const verb = resolved ? 'Reopen' : 'Resolve'
  return again ? `${verb} this issue again` : `${verb} this issue`
}

/**
 * The file's own name, and none of the directories above it.
 *
 * A row is already scoped by its title, and the panel is 404 pixels wide with
 * an effort pill on the same line, so `…/Repositories/CachedDocsRepository.php`
 * spends the whole line on a prefix that is the same for everything near it.
 * The name is the part a reader recognises; the full path is a hover away on
 * the tooltip, which is why nothing here is truncated out of reach.
 */
function fileName(file: string | null): string {
  if (file === null) return 'File unknown'

  return file.slice(file.lastIndexOf('/') + 1)
}

/**
 * One line under the row, saying what the last action did.
 *
 * A click in flight outranks everything, because it is the only state where the
 * row is waiting on something. After that the newest outcome speaks, which the
 * two handlers arrange by clearing the copy state. `stalled`, `expanding` and
 * `unavailable` therefore survive a later copy on the tick box's name but not
 * on this line.
 *
 * Every wording here is about the click. None of them claims the thread is
 * resolved or open, which is `data-resolved`'s to say and arrives as the badge
 * and the strikethrough instead.
 */
function status(action: ActionState, copy: CopyState): string | null {
  if (action.kind === 'waiting') {
    return action.want ? 'Resolving, waiting for GitHub…' : 'Unresolving, waiting for GitHub…'
  }

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

  switch (action.kind) {
    case 'stalled':
      return 'GitHub did not confirm that. Nothing was changed here, try again.'
    case 'expanding':
      // Two presses rather than one, and said plainly, because GitHub renders
      // no unresolve button on a collapsed thread and the fetch that brings one
      // is not something this row can wait on honestly.
      return 'Expanding the thread, because GitHub only renders Unresolve on an open one. Press again once it appears.'
    case 'unavailable':
      return action.want
        ? 'No resolve button on this thread: it needs write access to the repository.'
        : 'No unresolve button on this thread: it needs write access to the repository.'
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
