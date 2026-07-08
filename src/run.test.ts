import { describe, it, before, beforeEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { stringify } from 'yaml'
import type { Core, LintSummary, LinterError } from './types.ts'
import { wasCalledWith } from './test-utils.ts'

function emptySummary(): LintSummary {
  return { results: [], totalErrors: 0 }
}

function mkError(overrides: Partial<LinterError> = {}): LinterError {
  return {
    ruleId: 'test-rule',
    lineNumber: 1,
    column: 1,
    endColumn: 2,
    description: 'Test issue',
    helpURL: 'https://example.com/rule',
    ...overrides
  }
}

function lintSummary(files: string[], errorsPerFile: number): LintSummary {
  const results = files.map((file) => ({
    file,
    status: 'linted' as const,
    errors: Array.from({ length: errorsPerFile }, () => mkError())
  }))
  return { results, totalErrors: files.length * errorsPerFile }
}

describe('run', () => {
  let run: typeof import('./run.ts').default
  let getOnlyFiles: typeof import('./run.ts').getOnlyFiles
  let mockCore: Core
  let getInputMock: any
  let setFailedMock: any
  let infoMock: any
  let debugMock: any
  let setOutputMock: any
  let readFileMock: any
  let globSyncMock: any
  let statSyncMock: any
  let getChangedFilesMock: any
  let lintFilesMock: any
  let summaryAddRawMock: any
  let summaryWriteMock: any

  before(async () => {
    getInputMock = mock.fn(() => '')
    setFailedMock = mock.fn()
    infoMock = mock.fn()
    debugMock = mock.fn()
    setOutputMock = mock.fn()

    readFileMock = mock.fn(() => '')
    globSyncMock = mock.fn(() => [])
    statSyncMock = mock.fn(() => ({ isFile: () => true }))
    getChangedFilesMock = mock.fn(() => Promise.resolve([]))
    lintFilesMock = mock.fn(() => Promise.resolve(emptySummary()))
    summaryAddRawMock = mock.fn()
    summaryWriteMock = mock.fn(() => Promise.resolve())

    mock.module('fs', {
      namedExports: {
        readFileSync: readFileMock,
        globSync: globSyncMock,
        statSync: statSyncMock
      }
    })

    mock.module('./git.ts', {
      namedExports: { getChangedFiles: getChangedFilesMock }
    })
    mock.module('./linter.ts', {
      namedExports: { lintFiles: lintFilesMock }
    })

    const mod = await import('./run.ts')
    run = mod.default
    getOnlyFiles = mod.getOnlyFiles
  })

  beforeEach(() => {
    getInputMock.mock.resetCalls()
    getInputMock.mock.mockImplementation(() => '')
    setFailedMock.mock.resetCalls()
    infoMock.mock.resetCalls()
    debugMock.mock.resetCalls()
    setOutputMock.mock.resetCalls()
    readFileMock.mock.resetCalls()
    readFileMock.mock.mockImplementation(() => '')
    globSyncMock.mock.resetCalls()
    globSyncMock.mock.mockImplementation(() => [])
    statSyncMock.mock.resetCalls()
    statSyncMock.mock.mockImplementation(() => ({ isFile: () => true }))
    getChangedFilesMock.mock.resetCalls()
    getChangedFilesMock.mock.mockImplementation(() => Promise.resolve([]))
    lintFilesMock.mock.resetCalls()
    lintFilesMock.mock.mockImplementation(() => Promise.resolve(emptySummary()))
    summaryAddRawMock.mock.resetCalls()
    summaryWriteMock.mock.resetCalls()
    summaryWriteMock.mock.mockImplementation(() => Promise.resolve())

    mockCore = {
      getInput: getInputMock,
      setFailed: setFailedMock,
      info: infoMock,
      debug: debugMock,
      setOutput: setOutputMock,
      summary: { addRaw: summaryAddRawMock, write: summaryWriteMock }
    } as unknown as Core

    // addRaw is chainable in production (returns the summary singleton).
    summaryAddRawMock.mock.mockImplementation(() => mockCore.summary)

    delete process.env.AXE_LINTER_ONLY
  })

  after(() => {
    delete process.env.AXE_LINTER_ONLY
    mock.restoreAll()
  })

  function setupInputs(overrides: Record<string, string | Error> = {}) {
    const defaults: Record<string, string> = {
      github_token: 'test-token',
      api_key: 'test-api-key',
      axe_linter_url: ''
    }
    const inputs: Record<string, string | Error> = { ...defaults, ...overrides }

    getInputMock.mock.mockImplementation((name: string) => {
      const val = inputs[name]
      if (val instanceof Error) throw val
      return val ?? ''
    })
  }

  it('should process files successfully with no errors', async () => {
    setupInputs({ axe_linter_url: 'https://test-linter.com/' })

    getChangedFilesMock.mock.mockImplementation(() =>
      Promise.resolve(['test.js', 'test.html'])
    )

    const mockConfig = { rules: { 'test-rule': 'error' } }
    readFileMock.mock.mockImplementation((path: string) => {
      if (path === 'axe-linter.yml') return stringify(mockConfig)
      return ''
    })

    lintFilesMock.mock.mockImplementation(() =>
      Promise.resolve(lintSummary(['test.js', 'test.html'], 0))
    )

    await run(mockCore)

    assert.ok(wasCalledWith(getInputMock, 'github_token', { required: true }))
    assert.ok(wasCalledWith(getInputMock, 'api_key', { required: true }))
    assert.ok(wasCalledWith(getChangedFilesMock, 'test-token'))

    assert.ok(
      wasCalledWith(
        lintFilesMock,
        ['test.js', 'test.html'],
        'test-api-key',
        'https://test-linter.com',
        mockConfig
      )
    )

    assert.strictEqual(setFailedMock.mock.callCount(), 0)

    // A results summary is written even on a clean pass.
    assert.strictEqual(summaryWriteMock.mock.callCount(), 1)
    assert.match(
      summaryAddRawMock.mock.calls[0].arguments[0],
      /No accessibility issues found/
    )
  })

  it('should handle no changed files', async () => {
    setupInputs({ axe_linter_url: 'https://test-linter.com' })

    getChangedFilesMock.mock.mockImplementation(() => Promise.resolve([]))

    await run(mockCore)

    assert.ok(
      wasCalledWith(debugMock, 'No files to lint'),
      'Should log debug message for no files'
    )
    assert.strictEqual(
      lintFilesMock.mock.callCount(),
      0,
      'Linter should not be called with no files'
    )
    assert.strictEqual(
      setFailedMock.mock.callCount(),
      0,
      'Should not set failed status'
    )

    assert.strictEqual(
      readFileMock.mock.callCount(),
      0,
      'Should not attempt to read any files'
    )

    assert.ok(
      summaryAddRawMock.mock.calls.some((c: any) =>
        /No files to lint/.test(c.arguments[0])
      ),
      'Should write a "no files to lint" summary'
    )
  })

  it('should handle missing config file', async () => {
    setupInputs()

    getChangedFilesMock.mock.mockImplementation(() =>
      Promise.resolve(['test.js'])
    )

    readFileMock.mock.mockImplementation((path: string) => {
      if (path === 'axe-linter.yml') throw new Error('ENOENT')
      return ''
    })

    lintFilesMock.mock.mockImplementation(() => Promise.resolve(emptySummary()))

    await run(mockCore)

    assert.ok(
      wasCalledWith(
        debugMock,
        'Error loading axe-linter.yml no config found or invalid config: ENOENT'
      ),
      'Should log correct debug message for missing config'
    )

    assert.ok(
      wasCalledWith(lintFilesMock, ['test.js'], 'test-api-key', '', {}),
      'Should call linter with default config'
    )

    assert.ok(
      wasCalledWith(readFileMock, 'axe-linter.yml', 'utf8'),
      'Should attempt to read config file'
    )

    assert.strictEqual(
      setFailedMock.mock.callCount(),
      0,
      'Should not set failed status'
    )
  })

  it('should handle linter errors', async () => {
    setupInputs({ axe_linter_url: 'https://test-linter.com' })

    getChangedFilesMock.mock.mockImplementation(() =>
      Promise.resolve(['test.js'])
    )

    readFileMock.mock.mockImplementation((path: string) => {
      if (path === 'axe-linter.yml') return 'rules:\n  test-rule: error'
      return ''
    })

    lintFilesMock.mock.mockImplementation(() =>
      Promise.resolve(lintSummary(['test.js'], 2))
    )

    await run(mockCore)

    assert.ok(wasCalledWith(setFailedMock, 'Found 2 accessibility issues'))
  })

  it('should handle single linter error', async () => {
    setupInputs({ axe_linter_url: 'https://test-linter.com' })

    getChangedFilesMock.mock.mockImplementation(() =>
      Promise.resolve(['test.js'])
    )

    readFileMock.mock.mockImplementation((path: string) => {
      if (path === 'axe-linter.yml') return 'rules:\n  test-rule: error'
      return ''
    })

    lintFilesMock.mock.mockImplementation(() =>
      Promise.resolve(lintSummary(['test.js'], 1))
    )

    await run(mockCore)

    assert.ok(wasCalledWith(setFailedMock, 'Found 1 accessibility issue'))
  })

  it('should write a results summary listing findings', async () => {
    setupInputs({ axe_linter_url: 'https://test-linter.com' })

    getChangedFilesMock.mock.mockImplementation(() =>
      Promise.resolve(['test.js'])
    )
    readFileMock.mock.mockImplementation((path: string) => {
      if (path === 'axe-linter.yml') throw new Error('ENOENT')
      return ''
    })
    lintFilesMock.mock.mockImplementation(() =>
      Promise.resolve(lintSummary(['test.js'], 2))
    )

    await run(mockCore)

    assert.strictEqual(summaryWriteMock.mock.callCount(), 1)
    const markdown = summaryAddRawMock.mock.calls[0].arguments[0]
    assert.match(markdown, /Axe Linter results/)
    assert.match(markdown, /Found 2 accessibility issues/)
    // The findings themselves must reach a rendered table row, not just the count.
    assert.match(markdown, /#### <code>test\.js<\/code>/)
    assert.match(markdown, /\| Line \| Rule \| Issue \| Help \|/)
    assert.match(markdown, /<code>test-rule<\/code>/)
    assert.match(markdown, /Test issue/)
    assert.ok(wasCalledWith(setFailedMock, 'Found 2 accessibility issues'))
  })

  it('should write an error summary when the run aborts', async () => {
    setupInputs({ axe_linter_url: 'https://test-linter.com' })

    getChangedFilesMock.mock.mockImplementation(() =>
      Promise.reject(new Error('Git error'))
    )

    await run(mockCore)

    assert.ok(wasCalledWith(setFailedMock, 'Git error'))
    assert.strictEqual(summaryWriteMock.mock.callCount(), 1)
    const markdown = summaryAddRawMock.mock.calls[0].arguments[0]
    assert.match(markdown, /Axe Linter did not finish/)
    assert.match(markdown, /Git error/)
  })

  it('should not fail the action when the step summary cannot be written', async () => {
    setupInputs({ axe_linter_url: 'https://test-linter.com' })

    getChangedFilesMock.mock.mockImplementation(() =>
      Promise.resolve(['test.js'])
    )
    readFileMock.mock.mockImplementation((path: string) => {
      if (path === 'axe-linter.yml') throw new Error('ENOENT')
      return ''
    })
    lintFilesMock.mock.mockImplementation(() =>
      Promise.resolve(lintSummary(['test.js'], 2))
    )
    summaryWriteMock.mock.mockImplementation(() =>
      Promise.reject(new Error('no summary file'))
    )

    await run(mockCore)

    // The action still reports the real result; the write failure is swallowed.
    assert.ok(wasCalledWith(setFailedMock, 'Found 2 accessibility issues'))
    assert.ok(
      debugMock.mock.calls.some((c: any) =>
        /Unable to write step summary/.test(c.arguments[0])
      ),
      'Should log a debug message when the summary write fails'
    )
  })

  it('should handle missing required inputs', async () => {
    setupInputs({
      github_token: new Error('Input required and not supplied: github_token')
    })

    await run(mockCore)

    assert.ok(
      wasCalledWith(
        setFailedMock,
        'Input required and not supplied: github_token'
      )
    )
  })

  it('should handle git error', async () => {
    setupInputs({ axe_linter_url: 'https://test-linter.com' })

    const error = new Error('Git error')
    getChangedFilesMock.mock.mockImplementation(() => Promise.reject(error))

    await run(mockCore)

    assert.ok(wasCalledWith(setFailedMock, 'Git error'))
  })

  it('should handle non-Error exceptions', async () => {
    setupInputs()

    getChangedFilesMock.mock.mockImplementation(() =>
      Promise.reject({ foo: 'bar' })
    )

    await run(mockCore)

    assert.strictEqual(
      setFailedMock.mock.calls[0].arguments[0],
      'An unexpected error occurred: {"foo":"bar"}'
    )
  })

  describe('AXE_LINTER_ONLY', () => {
    it('should lint only the specified files, ignoring changed files', async () => {
      process.env.AXE_LINTER_ONLY = 'fixtures/**'
      setupInputs({ axe_linter_url: 'https://test-linter.com' })

      globSyncMock.mock.mockImplementation((pattern: string) => {
        if (pattern === 'fixtures/**') return ['fixtures/accessible.html']
        return []
      })
      readFileMock.mock.mockImplementation((path: string) => {
        if (path === 'axe-linter.yml') throw new Error('ENOENT')
        return ''
      })
      lintFilesMock.mock.mockImplementation(() =>
        Promise.resolve(emptySummary())
      )

      await run(mockCore)

      assert.strictEqual(
        getChangedFilesMock.mock.callCount(),
        0,
        'getChangedFiles should not be called when AXE_LINTER_ONLY is set'
      )
      assert.deepEqual(lintFilesMock.mock.calls[0].arguments[0], [
        'fixtures/accessible.html'
      ])
    })

    it('should lint only files even when glob resolves multiple', async () => {
      process.env.AXE_LINTER_ONLY = 'fixtures/**'
      setupInputs({ axe_linter_url: 'https://test-linter.com' })

      globSyncMock.mock.mockImplementation((pattern: string) => {
        if (pattern === 'fixtures/**')
          return ['fixtures/accessible.html', 'fixtures/accessible.vue']
        return []
      })
      readFileMock.mock.mockImplementation((path: string) => {
        if (path === 'axe-linter.yml') throw new Error('ENOENT')
        return ''
      })
      lintFilesMock.mock.mockImplementation(() =>
        Promise.resolve(emptySummary())
      )

      await run(mockCore)

      assert.strictEqual(getChangedFilesMock.mock.callCount(), 0)
      assert.deepEqual(lintFilesMock.mock.calls[0].arguments[0], [
        'fixtures/accessible.html',
        'fixtures/accessible.vue'
      ])
    })

    it('should fall back to getChangedFiles when env var is not set', async () => {
      setupInputs({ axe_linter_url: 'https://test-linter.com' })

      getChangedFilesMock.mock.mockImplementation(() =>
        Promise.resolve(['test.js'])
      )
      readFileMock.mock.mockImplementation((path: string) => {
        if (path === 'axe-linter.yml') throw new Error('ENOENT')
        return ''
      })
      lintFilesMock.mock.mockImplementation(() =>
        Promise.resolve(emptySummary())
      )

      await run(mockCore)

      assert.ok(getChangedFilesMock.mock.callCount() > 0)
      assert.strictEqual(globSyncMock.mock.callCount(), 0)
    })

    it('should handle multiple glob patterns separated by newlines', async () => {
      process.env.AXE_LINTER_ONLY = 'fixtures/*.html\nfixtures/*.vue'
      setupInputs({ axe_linter_url: 'https://test-linter.com' })

      globSyncMock.mock.mockImplementation((pattern: string) => {
        const results: Record<string, string[]> = {
          'fixtures/*.html': [
            'fixtures/accessible.html',
            'fixtures/accessible.htm'
          ],
          'fixtures/*.vue': ['fixtures/accessible.vue']
        }
        return results[pattern] ?? []
      })
      readFileMock.mock.mockImplementation((path: string) => {
        if (path === 'axe-linter.yml') throw new Error('ENOENT')
        return ''
      })
      lintFilesMock.mock.mockImplementation(() =>
        Promise.resolve(emptySummary())
      )

      await run(mockCore)

      assert.strictEqual(getChangedFilesMock.mock.callCount(), 0)
      assert.deepEqual(lintFilesMock.mock.calls[0].arguments[0], [
        'fixtures/accessible.html',
        'fixtures/accessible.htm',
        'fixtures/accessible.vue'
      ])
    })
  })

  describe('getOnlyFiles', () => {
    it('should return empty array when env var is not set', () => {
      const result = getOnlyFiles()
      assert.deepEqual(result, [])
      assert.strictEqual(globSyncMock.mock.callCount(), 0)
    })

    it('should resolve glob patterns from env var', () => {
      process.env.AXE_LINTER_ONLY = 'fixtures/**'
      globSyncMock.mock.mockImplementation((pattern: string) => {
        if (pattern === 'fixtures/**')
          return ['fixtures/a.html', 'fixtures/b.js']
        return []
      })

      const result = getOnlyFiles()
      assert.deepEqual(result, ['fixtures/a.html', 'fixtures/b.js'])
    })

    it('should skip empty lines', () => {
      process.env.AXE_LINTER_ONLY = 'fixtures/*.html\n\nfixtures/*.js\n'
      globSyncMock.mock.mockImplementation((pattern: string) => {
        const results: Record<string, string[]> = {
          'fixtures/*.html': ['fixtures/a.html'],
          'fixtures/*.js': ['fixtures/b.js']
        }
        return results[pattern] ?? []
      })

      const result = getOnlyFiles()
      assert.deepEqual(result, ['fixtures/a.html', 'fixtures/b.js'])
    })
  })
})
