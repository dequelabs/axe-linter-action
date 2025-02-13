import * as core from '@actions/core'
import { readFileSync } from 'fs'
import type { LinterResponse, ErrorDetail } from './types'
import fetch from 'node-fetch'
import { pluralize } from './utils'

export async function lintFiles(
  files: string[],
  apiKey: string,
  axeLinterUrl: string,
  linterConfig: Record<string, unknown>
): Promise<number> {
  let totalErrors = 0
  const fileErrors: Record<string, ErrorDetail[]> = {}

  for (const file of files) {
    const fileContents = readFileSync(file, 'utf8')

    // Skip empty files
    if (!fileContents.trim()) {
      core.debug(`Skipping empty file ${file}`)
      continue
    }

    const response = await fetch(`${axeLinterUrl}/lint-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey
      },
      body: JSON.stringify({
        source: fileContents,
        filename: file,
        config: linterConfig
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const contentType = response.headers.get('content-type')

    if (!contentType?.includes('application/json')) {
      throw new Error('Invalid content type')
    }

    const result = (await response.json()) as LinterResponse

    if (result.error) {
      throw new Error(result.error)
    }

    const errors = result.report.errors
    totalErrors += errors.length
    if (errors.length > 0) {
      fileErrors[file] = errors.map((error) => ({
        line: error.lineNumber,
        column: error.column,
        endColumn: error.endColumn,
        message: `${error.ruleId} - ${error.description}`,
        ruleId: error.ruleId,
        description: error.description
      }))
    }
  }

  // Create summary of all errors
  core.summary.addHeading('Accessibility Linting Results').addBreak()

  for (const [file, errors] of Object.entries(fileErrors)) {
    if (errors.length > 0) {
      // Add file heading
      core.summary
        .addHeading(`Errors in ${file}:`, 3)
        .addList(
          errors.map(
            (error) =>
              `Line ${error.line}: ${error.ruleId} - ${error.description}`
          )
        )
        .addBreak()

      // Create GitHub annotations
      for (const error of errors) {
        core.error(`${error.ruleId} - ${error.description}`, {
          file,
          startLine: error.line,
          startColumn: error.column,
          endColumn: error.endColumn,
          title: 'Axe Linter'
        })
      }
    }
  }

  // Add summary footer
  await core.summary
    .addBreak()
    .addRaw(`Found ${totalErrors} accessibility issue${pluralize(totalErrors)}`)
    .write()

  core.debug(`Found ${totalErrors} error${pluralize(totalErrors)}`)
  return totalErrors
}
