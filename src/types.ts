import type * as core from '@actions/core'

export type Core = Pick<
  typeof core,
  'getInput' | 'setOutput' | 'info' | 'setFailed' | 'debug' | 'summary'
>

export interface LinterError {
  ruleId: string
  lineNumber: number
  column: number
  endColumn: number
  description: string
  helpURL: string
}

export interface LinterReport {
  errors: LinterError[]
}

export interface LinterResponse {
  error?: string
  report: LinterReport
}

export interface ActionInputs {
  githubToken: string
  apiKey: string
  axeLinterUrl: string
}

/**
 * Outcome of processing a single file. Skipped files carry no errors; only
 * oversized skips record a size (used to explain the skip in the summary).
 */
export type FileStatus = 'linted' | 'skipped-oversized' | 'skipped-empty'

export interface FileResult {
  file: string
  status: FileStatus
  errors: LinterError[]
  sizeBytes?: number
}

/** Everything `lintFiles` collected, used to render the run's step summary. */
export interface LintSummary {
  results: FileResult[]
  totalErrors: number
}
