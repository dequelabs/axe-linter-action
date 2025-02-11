import { readFileSync } from 'fs'
import { load } from 'js-yaml'
import { lintFiles } from './linter'
import { getChangedFiles } from './git'
import type { Core, ActionInputs } from './types'
import { pluralize } from './utils'

async function run(core: Core): Promise<void> {
  try {
    const inputs: ActionInputs = {
      githubToken: core.getInput('github_token', { required: true }),
      apiKey: core.getInput('api_key', { required: true }),
      axeLinterUrl: core.getInput('axe_linter_url')
    }

    // Remove trailing slash if present
    inputs.axeLinterUrl = inputs.axeLinterUrl.replace(/\/$/, '')

    const changedFiles = await getChangedFiles(inputs.githubToken)

    if (changedFiles.length === 0) {
      core.debug('No files to lint')
      return
    }

    // Load linter config if exists
    let linterConfig = {}
    try {
      const configFile = readFileSync('axe-linter.yml', 'utf8')
      const parsedConfig = load(configFile)
      if (parsedConfig && typeof parsedConfig === 'object') {
        linterConfig = parsedConfig
      }
    } catch (error) {
      if (error instanceof Error) {
        core.debug(
          `Error loading axe-linter.yml no config found or invalid config: ${error.message}`
        )
      } else {
        core.debug(
          'Error loading axe-linter.yml no config found or invalid config: ' +
            error
        )
      }
    }

    // Run linter
    const errorCount = await lintFiles(
      changedFiles,
      inputs.apiKey,
      inputs.axeLinterUrl,
      linterConfig
    )

    if (errorCount > 0) {
      core.setFailed(
        `Found ${errorCount} accessibility issue${pluralize(errorCount)}`
      )
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred: ' + JSON.stringify(error))
    }
  }
}

export default run
