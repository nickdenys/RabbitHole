import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { createContext, type RefObject } from 'preact'

/**
 * Where a layer that escaped the drawer's scroll box should draw itself.
 *
 * Viewport coordinates, because everything using them is positioned `fixed`.
 * The worklist scrolls inside `overflow-y: auto`, so a menu positioned against
 * its own row would be clipped by the row three above it; `fixed` leaves that
 * box entirely, at the price of having to measure. See `anchorTo`.
 */
export interface Anchor {
  left: number
  top: number
  bottom: number
}

/** How much room a layer needs below its anchor before it flips above it. */
const FLIP_MARGIN = 12

/**
 * The point to hang a layer from, measured off the control that opened it.
 *
 * `left` is the control's centre, so a tooltip can sit under a
 * `translate(-50%, …)` and a menu can be pushed to the right edge by CSS.
 */
export function anchorTo(el: Element): Anchor {
  const rect = el.getBoundingClientRect()
  return { left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom }
}

/**
 * Below the anchor, or above it when below would run off the bottom.
 *
 * The flip is a measurement rather than a guess, so a menu opened on the last
 * row of a long worklist opens upward instead of half off the screen. `height`
 * is the layer's own, which the caller knows because it is a fixed list of
 * items rather than something the page decides.
 */
export function layerTop(anchor: Anchor, height: number): number {
  if (anchor.bottom + height + FLIP_MARGIN <= window.innerHeight) return anchor.bottom + 4
  return Math.max(FLIP_MARGIN, anchor.top - height - 4)
}

/**
 * Escape, or a press anywhere that is not part of the layer, closes it.
 *
 * `composedPath` rather than `contains`, because the whole panel lives in a
 * shadow root and an ordinary `target` is retargeted to the host on the way
 * out: every press would look like a press outside and no menu would survive
 * being opened.
 *
 * The parts are the layer *and* the control that toggles it. Leaving the
 * control out would make a second press on it close the layer and reopen it in
 * the same tick, so the one gesture a reader expects to shut a menu would be
 * the one that does nothing.
 *
 * `pointerdown` in capture, so a press that is going to open some other layer
 * closes this one first, and so the reader never sees two menus at once. A
 * press *inside* the layer is left alone entirely, because closing on the
 * pointer down would unmount the item before its click ever fired.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  ...parts: RefObject<HTMLElement | null>[]
): void {
  // Read through refs so the listeners are bound once per opening rather than
  // rebound on every render, which for a panel that redraws on every mutation
  // of the page would be constantly.
  const held = useRef(parts)
  held.current = parts
  const dismiss = useRef(close)
  dismiss.current = close

  useLayoutEffect(() => {
    if (!open) return

    function inside(event: Event): boolean {
      const path = event.composedPath()
      return held.current.some((part) => part.current !== null && path.includes(part.current))
    }

    const onDown = (event: Event): void => {
      if (!inside(event)) dismiss.current()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss.current()
    }

    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)

    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])
}

/**
 * How far a tooltip sits from the control it names. `panel.css` carries the
 * same number in `.tip`'s two transforms; it is here as well because the
 * choice between them is made by measuring rather than by CSS.
 */
export const TIP_GAP = 6

/**
 * Whether a tooltip fits above the control it names.
 *
 * A tooltip is the one layer on the panel that prefers above, because below is
 * where the pointer already is; everything else hangs below and flips up, see
 * `layerTop`. The drawer's header is twelve pixels from the top of the
 * viewport, so for the two signal icons in it there is no above to prefer, and
 * a tooltip that could not flip was drawn off the screen entirely.
 *
 * The height is measured by the caller rather than assumed here, because a
 * tooltip is as tall as however many lines its sentence wrapped to.
 */
export function tipFitsAbove(anchor: Anchor, height: number): boolean {
  return anchor.top - height - TIP_GAP >= FLIP_MARGIN
}

/** A tooltip that is showing: its words, and where the control it describes is. */
export interface Tip {
  text: string
  anchor: Anchor
}

/**
 * How long the file path waits before it appears.
 *
 * The path is the one tooltip a reader does not ask for by hovering: it sits
 * under the pointer on the way to the buttons beside it, and showing it
 * instantly would flash a black box across the list on every pass of the mouse.
 * The two icon tooltips name a control and are wanted the moment it is under
 * the pointer, so they use no delay at all.
 */
export const PATH_TIP_DELAY_MS = 1_000

/**
 * The one tooltip the panel can be showing, and the handlers that show it.
 *
 * A hook rather than a wrapper component because the things it describes are
 * buttons and a span, and wrapping each in a positioned element would change
 * the row's layout to carry a tooltip that is usually not there.
 *
 * Held once at the root and shared through `Tips`, because a tooltip drawn
 * inside the drawer is painted under the collapse tab beside it; see the
 * context below.
 *
 * Focus counts as hover, so the tooltip is not a mouse-only affordance.
 */
export function useTip(): [Tip | null, TipBinder] {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useLayoutEffect(() => () => clearTimeout(timer.current), [])

  function show(target: Element, text: string, delay: number): void {
    clearTimeout(timer.current)
    if (delay === 0) {
      setTip({ text, anchor: anchorTo(target) })
      return
    }
    // Measured when it fires rather than now, so a list that scrolled during
    // the wait does not put the tooltip where the row used to be.
    timer.current = setTimeout(() => setTip({ text, anchor: anchorTo(target) }), delay)
  }

  function hide(): void {
    clearTimeout(timer.current)
    setTip(null)
  }

  function bind(text: string, delay = 0): TipHandlers {
    return {
      onMouseEnter: (event) => show(event.currentTarget as Element, text, delay),
      onMouseLeave: hide,
      onFocus: (event) => show(event.currentTarget as Element, text, 0),
      onBlur: hide,
    }
  }

  return [tip, bind]
}

export interface TipHandlers {
  onMouseEnter: (event: MouseEvent) => void
  onMouseLeave: () => void
  onFocus: (event: FocusEvent) => void
  onBlur: () => void
}

/** What a control asks for to get a tooltip: its words, and how long to wait. */
export type TipBinder = (text: string, delay?: number) => TipHandlers

/**
 * The panel's one tooltip, handed down from the root instead of kept by the row
 * that shows it.
 *
 * A tooltip on the leftmost control of a row is centred on that control, so
 * half of it hangs off the drawer's left edge, right where the collapse tab
 * sits. A tooltip rendered inside the drawer can never win that overlap however
 * large its `z-index` is: the drawer carries a `z-index` of its own, so it is a
 * stacking context, and everything inside it is painted as part of the drawer,
 * under the tab beside it. Rendered as the drawer's sibling instead, the
 * tooltip's `z-index` is read against the tab's and wins.
 *
 * The default is a binder that shows nothing, so a control rendered outside the
 * provider is silent rather than broken.
 */
export const Tips = createContext<TipBinder>(() => ({
  onMouseEnter: () => {},
  onMouseLeave: () => {},
  onFocus: () => {},
  onBlur: () => {},
}))
