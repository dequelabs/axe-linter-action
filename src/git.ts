import * as github from '@actions/github'
import * as core from '@actions/core'
import { minimatch } from 'minimatch'

const FILE_PATTERNS = [
  '**/*.js',
  '**/*.jsx',
  '**/*.tsx',
  '**/*.esm',
  '**/*.html',
  '**/*.htm',
  '**/*.vue',
  '**/*.md',
  '**/*.markdown'
] as const

export async function getChangedFiles(token: string): Promise<string[]> {
  const octokit = github.getOctokit(token)
  const { context } = github

  if (!context.payload.pull_request) {
    core.debug('Not a pull request, checking push diff')
    const base = context.payload.before
    const head = context.payload.after

    const response = await octokit.rest.repos.compareCommits({
      owner: context.repo.owner,
      repo: context.repo.repo,
      base,
      head
    })

    return (
      response.data.files
        ?.filter((file) =>
          FILE_PATTERNS.some((pattern) => minimatch(file.filename, pattern))
        )
        .map((file) => file.filename) || []
    )
  }

  const response = await octokit.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request.number
  })

  return response.data
    .filter((file) =>
      FILE_PATTERNS.some((pattern) => minimatch(file.filename, pattern))
    )
    .map((file) => file.filename)
}
