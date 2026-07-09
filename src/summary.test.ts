import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSummaryMarkdown,
  buildErrorSummaryMarkdown,
  escapeHtml,
  escapeCell,
  safeUrl
} from './summary.ts'
import type { FileResult, LinterError, LintSummary } from './types.ts'

function err(overrides: Partial<LinterError> = {}): LinterError {
  return {
    ruleId: 'image-alt',
    lineNumber: 12,
    column: 5,
    endColumn: 10,
    description: 'Images must have alternate text',
    helpURL: 'https://dequeuniversity.com/rules/axe/4.4/image-alt',
    ...overrides
  }
}

function linted(file: string, errors: LinterError[] = []): FileResult {
  return { file, status: 'linted', errors }
}

function oversized(file: string, sizeBytes?: number): FileResult {
  return { file, status: 'skipped-oversized', errors: [], sizeBytes }
}

function emptyFile(file: string): FileResult {
  return { file, status: 'skipped-empty', errors: [] }
}

function summary(results: FileResult[]): LintSummary {
  const totalErrors = results.reduce((n, r) => n + r.errors.length, 0)
  return { results, totalErrors }
}

describe('summary', () => {
  describe('escapeHtml', () => {
    it('escapes HTML metacharacters', () => {
      assert.equal(
        escapeHtml('<a href="x">&y</a>'),
        '&lt;a href=&quot;x&quot;&gt;&amp;y&lt;/a&gt;'
      )
    })
  })

  describe('escapeCell', () => {
    it('backslash-escapes pipes and converts newlines to <br>', () => {
      assert.equal(escapeCell('a | b\nc'), 'a \\| b<br>c')
      assert.equal(escapeCell('a | b\r\nc'), 'a \\| b<br>c')
    })

    it('converts a lone carriage return to <br>', () => {
      assert.equal(escapeCell('a\rb'), 'a<br>b')
    })

    it('backslash-escapes markdown metacharacters', () => {
      assert.equal(
        escapeCell('__tests__ *x* `y` [z] !img ~s~'),
        '\\_\\_tests\\_\\_ \\*x\\* \\`y\\` \\[z\\] \\!img \\~s\\~'
      )
    })

    it('escapes markup before inserting <br> so <br> survives', () => {
      const out = escapeCell('<b>\n')
      assert.equal(out, '&lt;b&gt;<br>')
    })
  })

  describe('safeUrl', () => {
    it('accepts http and https URLs', () => {
      assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a')
      assert.equal(safeUrl('http://example.com'), 'http://example.com')
    })

    it('rejects non-http(s) schemes, junk, and empty input', () => {
      assert.equal(safeUrl('javascript:alert(1)'), null)
      assert.equal(safeUrl('ftp://example.com'), null)
      assert.equal(safeUrl('not a url'), null)
      assert.equal(safeUrl('foo'), null) // no scheme/host: new URL() throws
      assert.equal(safeUrl('https://example.com/a b'), null)
      assert.equal(safeUrl(undefined), null)
      assert.equal(safeUrl(''), null)
      assert.equal(safeUrl(null), null)
    })
  })

  describe('buildSummaryMarkdown', () => {
    it('renders the "no files to lint" scenario for empty results', () => {
      const md = buildSummaryMarkdown({ results: [], totalErrors: 0 })
      assert.match(md, /## Axe Linter results/)
      assert.match(md, /### ℹ️ No files to lint/)
      assert.match(md, /nothing was linted/)
      assert.doesNotMatch(md, /<details>/)
    })

    it('renders a clean pass with a linted count and no details block', () => {
      const md = buildSummaryMarkdown(
        summary([linted('a.html'), linted('b.html')])
      )
      assert.match(md, /### ✅ No accessibility issues found/)
      assert.match(md, /Linted 2 files\./)
      assert.doesNotMatch(md, /<details>/)
    })

    it('reports skipped files on a clean pass', () => {
      const md = buildSummaryMarkdown(
        summary([linted('a.html'), oversized('big.js', 900001)])
      )
      assert.match(md, /Linted 1 file, skipped 1 file\./)
      assert.match(md, /<details>/)
      assert.match(md, /<summary>Skipped files \(1\)<\/summary>/)
      assert.match(md, /File exceeds the size limit \(900001 bytes\)/)
    })

    it('shows a neutral message when every file was skipped', () => {
      const md = buildSummaryMarkdown(
        summary([oversized('big.js', 900001), emptyFile('empty.js')])
      )
      assert.match(md, /### ℹ️ No files were linted/)
      assert.match(md, /Skipped 2 files; no files were sent to the linter\./)
      assert.doesNotMatch(md, /No accessibility issues found/)
      assert.match(md, /File exceeds the size limit \(900001 bytes\)/)
      assert.match(md, /Empty file/)
    })

    it('omits the size when an oversized skip has no recorded size', () => {
      const md = buildSummaryMarkdown(summary([oversized('big.js')]))
      assert.match(md, /File exceeds the size limit(?! \()/)
    })

    it('renders multi-file findings with an overview table', () => {
      const md = buildSummaryMarkdown(
        summary([
          linted('src/index.html', [
            err(),
            err({ ruleId: 'html-has-lang', description: 'needs lang' })
          ]),
          linted('src/about.html', [err({ ruleId: 'link-name' })])
        ])
      )
      assert.match(md, /### ❌ Found 3 accessibility issues in 2 files/)
      assert.match(md, /\| File \| Issues \|/)
      assert.match(md, /#### <code>src\/index\.html<\/code>/)
      assert.match(md, /#### <code>src\/about\.html<\/code>/)
      assert.match(md, /<code>image-alt<\/code>/)
      assert.match(
        md,
        /\[View rule\]\(<https:\/\/dequeuniversity\.com\/rules\/axe\/4\.4\/image-alt>\)/
      )
    })

    it('omits the overview table when only one file has findings', () => {
      const md = buildSummaryMarkdown(
        summary([linted('clean.html'), linted('bad.html', [err()])])
      )
      assert.match(md, /### ❌ Found 1 accessibility issue in 1 file/)
      assert.doesNotMatch(md, /\| File \| Issues \|/)
      assert.match(md, /#### <code>bad\.html<\/code>/)
      assert.doesNotMatch(md, /#### <code>clean\.html<\/code>/)
    })

    it('adds the >10 annotation note only past the cap', () => {
      const eleven = summary([
        linted(
          'a.html',
          Array.from({ length: 11 }, () => err())
        )
      ])
      assert.match(
        buildSummaryMarkdown(eleven),
        /only the first 10 issue annotations/
      )

      const ten = summary([
        linted(
          'a.html',
          Array.from({ length: 10 }, () => err())
        )
      ])
      assert.doesNotMatch(
        buildSummaryMarkdown(ten),
        /only the first 10 issue annotations/
      )
    })

    it('escapes HTML, pipes, and markdown metacharacters in cells', () => {
      const md = buildSummaryMarkdown(
        summary([
          linted('a.html', [
            err({
              description:
                '<img src=x onerror=alert(1)> | *no* [link](http://x) `c`\nnext'
            })
          ])
        ])
      )
      assert.match(md, /&lt;img src=x onerror=alert\(1\)&gt;/) // HTML neutralized
      assert.match(md, /\\\|/) // pipe escaped, not a new column
      assert.match(md, /\\\*no\\\*/) // emphasis neutralized
      assert.match(md, /\\\[link\\\]/) // link neutralized
      assert.match(md, /next/)
      assert.doesNotMatch(md, /<img src=x/)
    })

    it('escapes underscores in file paths so they render literally', () => {
      const md = buildSummaryMarkdown(
        summary([linted('src/__tests__/Button.tsx', [err()])])
      )
      assert.match(md, /#### <code>src\/\\_\\_tests\\_\\_\/Button\.tsx<\/code>/)
      assert.doesNotMatch(md, /__tests__/)
    })

    it('renders an em dash for an unsafe or missing help URL', () => {
      const md = buildSummaryMarkdown(
        summary([linted('a.html', [err({ helpURL: 'javascript:alert(1)' })])])
      )
      assert.doesNotMatch(md, /\[View rule\]/)
      assert.match(md, /\| — \|/)
    })

    it('renders line:column, line only, or an em dash for location', () => {
      const withColumn = buildSummaryMarkdown(
        summary([linted('a.html', [err()])])
      )
      assert.match(withColumn, /\| 12:5 \|/)

      const noColumn = buildSummaryMarkdown(
        summary([
          linted('a.html', [err({ column: undefined as unknown as number })])
        ])
      )
      assert.match(noColumn, /\| 12 \| <code>/)

      const noLine = buildSummaryMarkdown(
        summary([
          linted('a.html', [
            err({ lineNumber: undefined as unknown as number })
          ])
        ])
      )
      assert.match(noLine, /\| — \| <code>/)
    })
  })

  describe('buildErrorSummaryMarkdown', () => {
    it('renders the failure heading, escaped message and log hint', () => {
      const md = buildErrorSummaryMarkdown('HTTP error 500: <boom>')
      assert.match(md, /## Axe Linter results/)
      assert.match(md, /### ⚠️ Axe Linter did not finish/)
      assert.match(md, /<pre><code>HTTP error 500: &lt;boom&gt;<\/code><\/pre>/)
      assert.match(md, /Check the failed step in the workflow logs above/)
      assert.match(md, /request and response details are logged there too/)
    })
  })
})
