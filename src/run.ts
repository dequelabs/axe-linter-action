import { readFile } from 'fs/promises'
import { load } from 'js-yaml'
import { lintFiles } from './linter'
import { getChangedFiles } from './git'
import type { Core, ActionInputs } from './types'

async function run(core: Core): Promise<void> {
  try {
    const inputs: ActionInputs = {
      githubToken: core.getInput('github_token', { required: true }),
      apiKey: core.getInput('api_key', { required: true }),
      axeLinterUrl:
        core.getInput('axe_linter_url') || 'https://axe-linter.deque.com'
    }

    // Remove trailing slash if present
    inputs.axeLinterUrl = inputs.axeLinterUrl.replace(/\/$/, '')

    // Get changed files
    const changedFiles = await getChangedFiles(inputs.githubToken)

    if (changedFiles.length === 0) {
      core.info('No files to lint')
      return
    }

    // Load linter config if exists
    let linterConfig = {}
    try {
      const configFile = await readFile('axe-linter.yml', 'utf8')
      const parsedConfig = load(configFile)
      if (parsedConfig && typeof parsedConfig === 'object') {
        linterConfig = parsedConfig
      }
    } catch {
      core.debug('No axe-linter.yml found or empty config')
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
        `Found ${errorCount} accessibility issue${errorCount === 1 ? '' : 's'}`
      )
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}

export default run
