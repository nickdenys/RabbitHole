import type { TriageRow } from '../engine'
import type { Severity } from '../types'
import { badges, keptReason } from './rows'

interface RowProps {
  row: TriageRow
}

/**
 * One finding, as one line of the worklist.
 *
 * Everything here is text put in as text. Nothing from the page is ever
 * injected as markup, which is both the rule for this step and the shape B3
 * needs, since a fetched thread arrives as HTML from the network.
 */
export function Row({ row }: RowProps) {
  const { thread, finding } = row
  const severity = finding?.severity ?? null
  const reason = keptReason(row)

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
      </div>
    </li>
  )
}

/**
 * A missing severity is a gap in CodeRabbit's own comment, not a failure, so it
 * reads as one rather than as a blank.
 */
function severityLabel(severity: Severity | null): string {
  if (severity === null) return 'not stated'
  return severity
}
