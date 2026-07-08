import type { LintSummary, FileResult, LinterError } from './types.ts'
import { pluralize } from './utils.ts'

const HEADING = '## Axe Linter results'

// GitHub renders at most this many issue annotations inline per step. Findings
// beyond it are invisible in the changed-files view, which is the whole reason
// the summary lists every finding.
const ANNOTATION_LIMIT = 10

/**
 * Entity-escape a value placed inside inline HTML (`<code>`/`<pre>`). The
 * `@actions/core` summary builder interpolates content raw, so escaping is our
 * responsibility — without it, a file path or rule description containing
 * markup would break the page or inject HTML.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Escape a value for a GFM pipe-table cell. Cell content is parsed as inline
 * markdown (and a raw `<code>` wrapper does NOT suppress that on GitHub), so on
 * top of HTML entities we must also backslash-escape the markdown metacharacters
 * — otherwise a path like `src/__tests__/x` renders with `tests` bolded, and a
 * rule description could inject a link or image. The pipe (would start a new
 * column) is escaped too, and every line ending — including a lone `\r`, which
 * cmark-gfm still treats as one — becomes a `<br>`. Order matters: entity- and
 * backslash-escaping run before the literal `<br>` we insert.
 */
export function escapeCell(value: string): string {
  return escapeHtml(value)
    .replace(/[\\`*_[\]~!|]/g, '\\$&')
    .replace(/\r\n?|\n/g, '<br>')
}

/**
 * Return the URL only when it is a clean http(s) URL, otherwise `null`. Blocks
 * `javascript:` and other schemes, plus any URL with characters that would
 * break the markdown link or the surrounding table cell.
 */
export function safeUrl(url: string | undefined | null): string | null {
  if (!url) {
    return null
  }

  if (/[\s<>|]/.test(url)) {
    return null
  }

  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function renderRow(error: LinterError): string {
  const { lineNumber, column } = error
  const location =
    lineNumber == null
      ? '—'
      : column == null
        ? String(lineNumber)
        : `${lineNumber}:${column}`
  const url = safeUrl(error.helpURL)
  const rule = `<code>${escapeCell(error.ruleId ?? '')}</code>`
  const description = escapeCell(error.description ?? '')
  const help = url ? `[View rule](<${url}>)` : '—'
  return `| ${location} | ${rule} | ${description} | ${help} |`
}

function reasonFor(file: FileResult): string {
  if (file.status === 'skipped-oversized') {
    return file.sizeBytes == null
      ? 'File exceeds the size limit'
      : `File exceeds the size limit (${file.sizeBytes} bytes)`
  }
  return 'Empty file'
}

function renderSkipped(skipped: FileResult[]): string[] {
  const lines = [
    '<details>',
    `<summary>Skipped files (${skipped.length})</summary>`,
    '',
    '| File | Reason |',
    '| --- | --- |'
  ]
  for (const file of skipped) {
    lines.push(
      `| <code>${escapeCell(file.file)}</code> | ${escapeCell(reasonFor(file))} |`
    )
  }
  lines.push('', '</details>')
  return lines
}

/**
 * Build the step-summary markdown for a completed run. Handles findings, a
 * clean pass, and the "nothing to lint" case; a skipped-files section is
 * appended whenever any file was skipped.
 */
export function buildSummaryMarkdown(summary: LintSummary): string {
  const { results, totalErrors } = summary
  const linted = results.filter((result) => result.status === 'linted')
  const skipped = results.filter((result) => result.status !== 'linted')
  const withErrors = linted.filter((result) => result.errors.length > 0)

  const lines: string[] = [HEADING, '']

  if (results.length === 0) {
    lines.push(
      '### ℹ️ No files to lint',
      '',
      'No supported changed files were found for this event, so nothing was linted.'
    )
    return lines.join('\n') + '\n'
  }

  if (totalErrors > 0) {
    lines.push(
      `### ❌ Found ${totalErrors} accessibility issue${pluralize(totalErrors)} in ${withErrors.length} file${pluralize(withErrors.length)}`,
      ''
    )
    if (totalErrors > ANNOTATION_LIMIT) {
      lines.push(
        `> **Note:** GitHub shows only the first ${ANNOTATION_LIMIT} issue annotations inline on the changed-files view. All ${totalErrors} findings are listed in full below.`,
        ''
      )
    }
    if (withErrors.length > 1) {
      lines.push('| File | Issues |', '| --- | --- |')
      for (const result of withErrors) {
        lines.push(
          `| <code>${escapeCell(result.file)}</code> | ${result.errors.length} |`
        )
      }
      lines.push('')
    }
    for (const result of withErrors) {
      lines.push(`#### <code>${escapeCell(result.file)}</code>`, '')
      lines.push('| Line | Rule | Issue | Help |', '| --- | --- | --- | --- |')
      for (const error of result.errors) {
        lines.push(renderRow(error))
      }
      lines.push('')
    }
  } else if (linted.length === 0) {
    // Only skipped files — nothing was actually checked, so avoid a green
    // "all clear" that would imply the changed files passed.
    lines.push('### ℹ️ No files were linted', '')
    lines.push(
      `Skipped ${skipped.length} file${pluralize(skipped.length)}; no files were sent to the linter.`,
      ''
    )
  } else {
    lines.push('### ✅ No accessibility issues found', '')
    let line = `Linted ${linted.length} file${pluralize(linted.length)}`
    if (skipped.length > 0) {
      line += `, skipped ${skipped.length} file${pluralize(skipped.length)}`
    }
    lines.push(line + '.', '')
  }

  if (skipped.length > 0) {
    lines.push(...renderSkipped(skipped))
  }

  return lines.join('\n') + '\n'
}

/** Build the step-summary markdown for a run that aborted with an error. */
export function buildErrorSummaryMarkdown(message: string): string {
  return (
    [
      HEADING,
      '',
      '### ⚠️ Axe Linter did not finish',
      '',
      'The action stopped before it could report results. The error was:',
      '',
      `<pre><code>${escapeHtml(message)}</code></pre>`,
      '',
      'Check the failed step in the workflow logs above for the full output. If the linter API responded with an error, the request and response details are logged there too.'
    ].join('\n') + '\n'
  )
}
