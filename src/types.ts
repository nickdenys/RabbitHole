export type Severity = 'critical' | 'major' | 'minor'

export type PageKind = 'not-pr' | 'classic' | 'react' | 'unknown'

export interface ParsedThread {
  threadId: string
  file: string
  resolved: boolean
  outdated: boolean
  pending: boolean
  /** True only when every comment in the thread is authored by CodeRabbit.
   *  Pending (unsubmitted) comments count as human comments. */
  allCommentsFromCodeRabbit: boolean
  category: string | null
  severity: Severity | null
  effort: string | null
}
