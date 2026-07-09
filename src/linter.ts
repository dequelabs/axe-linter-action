import * as core from '@actions/core'
import { readFileSync, statSync } from 'fs'
import { fetch } from 'undici'
import type { LinterResponse, FileResult, LintSummary } from './types.ts'
import { pluralize } from './utils.ts'

const MAX_FILE_SIZE_BYTES = 900_000

export async function lintFiles(
  files: string[],
  apiKey: string,
  axeLinterUrl: string,
  linterConfig: Record<string, unknown>
): Promise<LintSummary> {
  let totalErrors = 0
  const results: FileResult[] = []

  for (const file of files) {
    const fileSize = statSync(file).size

    // Skip files exceeding the size limit
    if (fileSize > MAX_FILE_SIZE_BYTES) {
      core.warning(
        `Skipping ${file}: file size (${fileSize} bytes) exceeds ${MAX_FILE_SIZE_BYTES} bytes limit`
      )
      results.push({
        file,
        status: 'skipped-oversized',
        errors: [],
        sizeBytes: fileSize
      })
      continue
    }

    const fileContents = readFileSync(file, 'utf8')

    // Skip empty files
    if (!fileContents.trim()) {
      core.debug(`Skipping empty file ${file}`)
      results.push({ file, status: 'skipped-empty', errors: [] })
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
      throw new Error(
        `Invalid content type: expected application/json but received "${contentType ?? 'none'}" (HTTP ${response.status}) from ${response.url}`
      )
    }

    const result = (await response.json()) as LinterResponse

    if (result.error) {
      throw new Error(result.error)
    }

    const errors = result.report.errors
    totalErrors += errors.length
    results.push({ file, status: 'linted', errors })

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
  return { results, totalErrors }
}
