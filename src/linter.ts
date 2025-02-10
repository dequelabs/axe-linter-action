import * as core from '@actions/core'
import { readFile } from 'fs/promises'
import type { LinterResponse } from './types'
import fetch from 'node-fetch'

export async function lintFiles(
  files: string[],
  apiKey: string,
  axeLinterUrl: string,
  linterConfig: Record<string, unknown>
): Promise<number> {
  let totalErrors = 0

  for (const file of files) {
    try {
      const fileContents = await readFile(file, 'utf8')

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

      const result = (await response.json()) as LinterResponse

      if (result.error) {
        throw new Error(result.error)
      }

      const errors = result.report.errors
      totalErrors += errors.length

      // Report errors using GitHub annotations
      for (const error of errors) {
        core.error(`${error.ruleId} - ${error.description}`, {
          file,
          startLine: error.lineNumber,
          startColumn: error.column,
          endColumn: error.endColumn,
          title: 'Axe Linter'
        })
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Error processing ${file}: ${error.message}`)
      }
      throw error
    }
  }

  core.debug(`Found ${totalErrors} error${totalErrors === 1 ? '' : 's'}`)
  return totalErrors
}
