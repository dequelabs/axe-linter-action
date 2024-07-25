import * as core from '@actions/core'
import { getOctokit, context } from '@actions/github'
import axios from 'axios'

const run = async () => {
  console.log('Starting axe Linter');
  
  const apiKey = core.getInput('api-key')
  const axeLinterUrl = core.getInput('axe-linter-url')
  const token = core.getInput('github-token', { required: true })
  core.setSecret(token)
  const results = []
  const octokit = getOctokit(token)
  const payload = context.payload
  const owner = payload.repository?.owner.login as string
  const repo = payload.repository?.name as string
  const sha = payload.pull_request?.head.sha
  const pr = payload.pull_request

  const { data: files } = await octokit.request(
    'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
    { owner, repo, pull_number: pr?.number as number }
  )
  console.log(JSON.stringify(files, null, 2))
  for (const file of files) {
    const res = await octokit.request(
      'GET /repos/{owner}/{repo}/contents/{path}',
      { owner, repo, path: file.filename, ref: sha }
    )

    const result = await axios.post(axeLinterUrl, {
      headers: { Authorization: apiKey },
      source: (res.data as any).content,
      filename: file.filename
    })
    results.push(result.data)
    console.log(JSON.stringify(result.data, null, 2))

    if (results.length) {
      for (const result of results) {
        for (const issue of result.report.errors) {
          core.error(`Accessibility issue found by axe Linter`, {
            file: file.filename,
            startLine: issue.lineNumber,
            endLine: issue.lineNumber,
            startColumn: issue.column,
            endColumn: issue.endColumn
          })
        }
      }
    }
  }
}

export default run
