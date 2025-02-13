import type core from '@actions/core'

export type Core = Pick<
  typeof core,
  'getInput' | 'setOutput' | 'info' | 'setFailed' | 'debug'
>

export interface ErrorDetail {
  line: number
  message: string
  column: number
  endColumn: number
  ruleId: string
  description: string
}

export interface LinterError {
  ruleId: string
  lineNumber: number
  column: number
  endColumn: number
  description: string
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
