import { readFileSync, globSync, statSync } from 'fs'
import { parse } from 'yaml'
import { lintFiles } from './linter.ts'
import { getChangedFiles } from './git.ts'
import { buildSummaryMarkdown, buildErrorSummaryMarkdown } from './summary.ts'
import type { Core, ActionInputs, LintSummary } from './types.ts'
import { pluralize } from './utils.ts'

/**
 * Write markdown to the GitHub step summary. Failures (e.g. running outside
 * Actions, where `$GITHUB_STEP_SUMMARY` is unset) are swallowed so reporting
 * can never change the action's pass/fail outcome or mask the real error.
 */
async function writeStepSummary(core: Core, markdown: string): Promise<void> {
  try {
    core.summary.addRaw(markdown, true)
    await core.summary.write()
  } catch (error) {
    core.debug(
      `Unable to write step summary: ${
        error instanceof Error ? error.message : error
      }`
    )
  }
}

export function getOnlyFiles(): string[] {
  /**
   * @WARNING
   *
   * If you come across this, do be aware it is internal only
   * and *NOT* supported as a public API. Its behavior may
   * change at any point without warning. Do not rely
   * on this in your own code. Use the supported `inputs`
   * mechanism only to provide configuration to the action.
   */
  const patterns = process.env.AXE_LINTER_ONLY
  if (!patterns) {
    return []
  }

  return patterns
    .split(/\r?\n/)
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .flatMap((pattern) => globSync(pattern))
    .filter((file) => statSync(file).isFile())
}

async function run(core: Core): Promise<void> {
  try {
    const inputs: ActionInputs = {
      githubToken: core.getInput('github_token', { required: true }),
      apiKey: core.getInput('api_key', { required: true }),
      axeLinterUrl: core.getInput('axe_linter_url')
    }

    // Remove trailing slash if present
    inputs.axeLinterUrl = inputs.axeLinterUrl.replace(/\/$/, '')

    const onlyFiles = getOnlyFiles()
    const filesToLint =
      onlyFiles.length > 0
        ? onlyFiles
        : await getChangedFiles(inputs.githubToken)

    if (filesToLint.length === 0) {
      core.debug('No files to lint')
      await writeStepSummary(
        core,
        buildSummaryMarkdown({ results: [], totalErrors: 0 })
      )
      return
    }

    // Load linter config if exists
    let linterConfig = {}
    try {
      const configFile = readFileSync('axe-linter.yml', 'utf8')
      const parsedConfig = parse(configFile)
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
    const summary: LintSummary = await lintFiles(
      filesToLint,
      inputs.apiKey,
      inputs.axeLinterUrl,
      linterConfig
    )

    await writeStepSummary(core, buildSummaryMarkdown(summary))

    if (summary.totalErrors > 0) {
      core.setFailed(
        `Found ${summary.totalErrors} accessibility issue${pluralize(
          summary.totalErrors
        )}`
      )
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'An unexpected error occurred: ' + JSON.stringify(error)

    await writeStepSummary(core, buildErrorSummaryMarkdown(message))
    core.setFailed(message)
  }
}

export default run
