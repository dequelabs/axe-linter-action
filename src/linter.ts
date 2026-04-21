import * as core from '@actions/core'
import { readFileSync, statSync } from 'fs'
import type { LinterResponse } from './types'
import { pluralize } from './utils'

const MAX_FILE_SIZE_BYTES = 900 * 1024 * 1024

export async function lintFiles(
  files: string[],
  apiKey: string,
  axeLinterUrl: string,
  linterConfig: Record<string, unknown>
): Promise<number> {
  let totalErrors = 0

  for (const file of files) {
    const fileSize = statSync(file).size

    // Skip files exceeding the size limit
    if (fileSize > MAX_FILE_SIZE_BYTES) {
      const sizeMB = Math.round(fileSize / (1024 * 1024))
      core.warning(
        `Skipping ${file}: file size (${sizeMB} MB) exceeds 900MB limit`
      )
      continue
    }

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
    }).catch((error) => {
      core.startGroup('Linter API Request Failed')
      core.info(
        JSON.stringify(
          {
            url: `${axeLinterUrl}/lint-source`,
            body: {
              source: fileContents,
              filename: file,
              config: linterConfig
            }
          },
          null,
          2
        )
      )
      core.endGroup()
      throw error
    })

    if (!response.ok) {
      const data = {
        status: response.status,
        statusText: response.statusText,
        fileUnderLint: file,
        endpoint: response.url,
        totalFiles: files.length,
        files: files
      }
      core.startGroup('Linter API Details')
      core.info(JSON.stringify(data, null, 2))
      core.endGroup()

      throw new Error(`HTTP error ${response.status}: ${response.statusText}`)
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
        `${file}:${error.lineNumber} - ${error.ruleId} - ${error.description}\n${error.helpURL}`,
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
