import * as github from '@actions/github'
import * as core from '@actions/core'
import { extname } from 'path'

const FILE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.tsx',
  '.esm',
  '.html',
  '.htm',
  '.vue',
  '.md',
  '.markdown',
  '.liquid'
])

function isSupportedFile(filename: string): boolean {
  const hasDotSegment = filename.split('/').some((seg) => seg.startsWith('.'))
  return !hasDotSegment && FILE_EXTENSIONS.has(extname(filename).toLowerCase())
}

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

    const files = response.data.files

    if (files && files.length >= 300) {
      core.warning(
        'This push includes 300+ changed files. The GitHub API only returns the first 300 files for push events, so some files may not be linted.'
      )
    }

    return (
      files
        ?.filter(
          (file) => file.status !== 'removed' && isSupportedFile(file.filename)
        )
        .map((file) => file.filename) || []
    )
  }

  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request.number,
    per_page: 100
  })

  return files
    .filter(
      (file) => file.status !== 'removed' && isSupportedFile(file.filename)
    )
    .map((file) => file.filename)
}
