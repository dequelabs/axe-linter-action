import { describe, it, before, beforeEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { stringify } from 'yaml'
import type { Core } from './types.ts'

function wasCalledWith(fn: any, ...expectedArgs: unknown[]): boolean {
  return fn.mock.calls.some((call: any) => {
    try {
      assert.deepStrictEqual(
        call.arguments.slice(0, expectedArgs.length),
        expectedArgs
      )
      return true
    } catch {
      return false
    }
  })
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
    lintFilesMock = mock.fn(() => Promise.resolve(0))

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
    lintFilesMock.mock.mockImplementation(() => Promise.resolve(0))

    mockCore = {
      getInput: getInputMock,
      setFailed: setFailedMock,
      info: infoMock,
      debug: debugMock,
      setOutput: setOutputMock
    } as unknown as Core

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

    lintFilesMock.mock.mockImplementation(() => Promise.resolve(0))

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

    lintFilesMock.mock.mockImplementation(() => Promise.resolve(0))

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

    lintFilesMock.mock.mockImplementation(() => Promise.resolve(2))

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

    lintFilesMock.mock.mockImplementation(() => Promise.resolve(1))

    await run(mockCore)

    assert.ok(wasCalledWith(setFailedMock, 'Found 1 accessibility issue'))
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
      lintFilesMock.mock.mockImplementation(() => Promise.resolve(0))

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
      lintFilesMock.mock.mockImplementation(() => Promise.resolve(0))

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
      lintFilesMock.mock.mockImplementation(() => Promise.resolve(0))

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
      lintFilesMock.mock.mockImplementation(() => Promise.resolve(0))

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
