import type { Severity } from '../types'

export interface Triple {
  category: string
  severity: Severity
  effort: string
}

/**
 * Matched on the word alone, lowercased, never on the emoji. The emoji only has
 * to be there, which is what separates a triple from prose.
 *
 * `trivial` was added 20 August 2026, after step A4 measured 8 root comments
 * across the fixtures stating `🔵 Trivial`. Every one of them had been failing
 * the whole triple over the one unknown word and losing its category and effort
 * with it, so the panel called 8 real findings unparsed. See [[Decision log]].
 */
const SEVERITIES: Record<string, Severity> = {
  critical: 'critical',
  major: 'major',
  minor: 'minor',
  trivial: 'trivial',
}

/**
 * CodeRabbit's first line is a pipe-separated triple rendered as the first
 * three <em> elements of the comment body, each prefixed with an emoji:
 *
 *   em[0] → 🗄️ Data Integrity & Integration   (category)
 *   em[1] → 🟠 Major                           (severity)
 *   em[2] → ⚡ Quick win                        (effort)
 *
 * All three parts carry an emoji prefix. Requiring it is what separates the
 * triple from prose that happens to emphasize a severity word, which is the
 * failure mode of Houdini's body-wide text search.
 *
 * Returns null when the shape doesn't match. Callers must treat null as
 * "unparsed": the thread stays visible (invariant 1) and is listed with an
 * unknown badge, never guessed at.
 */
export function parseTriple(commentBody: Element): Triple | null {
  const ems = commentBody.querySelectorAll('em')
  if (ems.length < 3) return null

  const parts = [ems[0], ems[1], ems[2]].map((em) => stripLeadingEmoji(em.textContent ?? ''))
  if (parts.some((part) => part === null)) return null

  const [category, severityRaw, effort] = parts as string[]
  const severity = SEVERITIES[severityRaw.toLowerCase()]
  if (!severity || !category || !effort) return null

  return { category, severity, effort }
}

function stripLeadingEmoji(text: string): string | null {
  const stripped = text.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  // No prefix stripped means no emoji marker, so this em is prose, not a triple part.
  if (stripped === text.trim()) return null
  return stripped
}
