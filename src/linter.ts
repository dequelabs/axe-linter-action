import * as core from '@actions/core'
import { readFileSync } from 'fs'
import type { LinterResponse } from './types'
import fetch from 'node-fetch'
import { pluralize } from './utils'

export async function lintFiles(
  files: string[],
  apiKey: string,
  axeLinterUrl: string,
  linterConfig: Record<string, unknown>
): Promise<number> {
  let totalErrors = 0

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

    // Report errors using GitHub annotations
    for (const error of errors) {
      core.error(
        `${file}:${error.lineNumber} - [${error.ruleId}](${error.helpURL}) ${error.description}`,
        {
          file,
          startLine: error.lineNumber,
          startColumn: error.column,
          endColumn: error.endColumn,
          title: 'Axe Linter'
        }
      )
    }
  }

  core.debug(`Found ${totalErrors} error${pluralize(totalErrors)}`)
  return totalErrors
}
