import type core from '@actions/core'

export type Core = Pick<
  typeof core,
  'getInput' | 'setOutput' | 'info' | 'setFailed' | 'debug'
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
