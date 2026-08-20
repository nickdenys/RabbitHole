import type { Thread } from '../types'

export type HideMode = 'safe' | 'aggressive'

/**
 * The invariants this module exists to uphold:
 *
 *  1. Never hide a thread that could not be parsed.
 *  2. Never hide a thread you cannot positively attribute to CodeRabbit.
 *
 * Safe mode (default): hide only threads where every comment is CodeRabbit's.
 * A human reply, or a pending comment of your own, keeps the thread visible.
 * Aggressive mode (opt-in toggle): hide all CodeRabbit-rooted threads.
 */
export function shouldHide(_thread: Thread, _mode: HideMode): boolean {
  // TODO(v0.1): implement. Until then nothing is ever hidden.
  return false
}
