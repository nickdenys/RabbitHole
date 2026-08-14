import type { Severity } from '../types'

export interface Triple {
  category: string
  severity: Severity
  effort: string
}

const SEVERITIES: Record<string, Severity> = {
  critical: 'critical',
  major: 'major',
  minor: 'minor',
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
