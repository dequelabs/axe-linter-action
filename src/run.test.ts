import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { stringify } from 'yaml'
import type { Core } from './types.ts'

// Shared mutable state
let readFileFn: (path: string, encoding: string) => string
let globSyncFn: (pattern: string) => string[]
let statSyncFn: (path: string) => { isFile: () => boolean }
let getChangedFilesFn: (token: string) => Promise<string[]>
let lintFilesFn: (
  files: string[],
  apiKey: string,
  url: string,
  config: Record<string, unknown>
) => Promise<number>

mock.module('fs', {
  namedExports: {
    readFileSync: (path: string, encoding: string) =>
      readFileFn(path, encoding),
    globSync: (pattern: string) => globSyncFn(pattern),
    statSync: (path: string) => statSyncFn(path)
  }
})

mock.module('./git.ts', {
  namedExports: {
    getChangedFiles: (token: string) => getChangedFilesFn(token)
  }
})

mock.module('./linter.ts', {
  namedExports: {
    lintFiles: (
      files: string[],
      apiKey: string,
      url: string,
      config: Record<string, unknown>
    ) => lintFilesFn(files, apiKey, url, config)
  }
})

const { default: run, getOnlyFiles } = await import('./run.ts')

describe('run', () => {
  let mockCore: Core

  beforeEach(() => {
    readFileFn = () => {
      throw new Error('Unexpected readFileSync call')
    }
    globSyncFn = () => []
    statSyncFn = () => ({ isFile: () => true })
    getChangedFilesFn = async () => []
    lintFilesFn = async () => 0

    const inputs: Record<string, string> = {}
    mockCore = {
      getInput: mock.fn((name: string, opts?: { required?: boolean }) => {
        if (inputs[name] !== undefined) return inputs[name]
        if (opts?.required)
          throw new Error(`Input required and not supplied: ${name}`)
        return ''
      }),
      setFailed: mock.fn(),
      info: mock.fn(),
      debug: mock.fn(),
      setOutput: mock.fn()
    } as unknown as Core

    // Clear env var by default
    delete process.env.AXE_LINTER_ONLY
  })

  afterEach(() => {
    delete process.env.AXE_LINTER_ONLY
  })

  function setupInputs(values: Record<string, string>) {
    ;(mockCore.getInput as any).mock.resetCalls()
    const inputMock = mock.fn((name: string, opts?: { required?: boolean }) => {
      if (values[name] !== undefined) return values[name]
      if (opts?.required)
        throw new Error(`Input required and not supplied: ${name}`)
      return ''
    })
    mockCore.getInput = inputMock as any
  }

  it('should process files successfully with no errors', async () => {
    setupInputs({
      github_token: 'test-token',
      api_key: 'test-api-key',
      axe_linter_url: 'https://test-linter.com/'
    })

    getChangedFilesFn = async () => ['test.js', 'test.html']

    const mockConfig = { rules: { 'test-rule': 'error' } }
    readFileFn = (path: string) => {
      if (path === 'axe-linter.yml') return stringify(mockConfig)
      throw new Error(`Unexpected file: ${path}`)
    }

    lintFilesFn = async () => 0

    await run(mockCore)

    // Verify files were processed
    assert.strictEqual((mockCore.setFailed as any).mock.callCount(), 0)
  })

  it('should handle no changed files', async () => {
    setupInputs({
      github_token: 'test-token',
      api_key: 'test-api-key',
      axe_linter_url: 'https://test-linter.com'
    })

    getChangedFilesFn = async () => []

    await run(mockCore)

    assert.ok(
      (mockCore.debug as any).mock.calls.some(
        (c: any) => c.arguments[0] === 'No files to lint'
      )
    )
    assert.strictEqual((mockCore.setFailed as any).mock.callCount(), 0)
  })

  it('should handle missing config file', async () => {
    setupInputs({
      github_token: 'test-token',
      api_key: 'test-api-key',
      axe_linter_url: ''
    })

    getChangedFilesFn = async () => ['test.js']

    readFileFn = (path: string) => {
      if (path === 'axe-linter.yml') throw new Error('ENOENT')
      throw new Error(`Unexpected file: ${path}`)
    }

    let lintCalledWith: any[] = []
    lintFilesFn = async (...args) => {
      lintCalledWith = args
      return 0
    }

    await run(mockCore)

    assert.ok(
      (mockCore.debug as any).mock.calls.some(
        (c: any) =>
          c.arguments[0] ===
          'Error loading axe-linter.yml no config found or invalid config: ENOENT'
      )
    )

    // Verify linter was called with default config
    assert.deepStrictEqual(lintCalledWith[0], ['test.js'])
    assert.strictEqual(lintCalledWith[1], 'test-api-key')
    assert.strictEqual(lintCalledWith[2], '')
    assert.deepStrictEqual(lintCalledWith[3], {})

    assert.strictEqual((mockCore.setFailed as any).mock.callCount(), 0)
  })

  it('should handle linter errors', async () => {
    setupInputs({
      github_token: 'test-token',
      api_key: 'test-api-key',
      axe_linter_url: 'https://test-linter.com'
    })

    getChangedFilesFn = async () => ['test.js']

    readFileFn = (path: string) => {
      if (path === 'axe-linter.yml') return 'rules:\n  test-rule: error'
      throw new Error(`Unexpected file: ${path}`)
    }

    lintFilesFn = async () => 2

    await run(mockCore)

    assert.strictEqual(
      (mockCore.setFailed as any).mock.calls[0].arguments[0],
      'Found 2 accessibility issues'
    )
  })

  it('should handle single linter error', async () => {
    setupInputs({
      github_token: 'test-token',
      api_key: 'test-api-key',
      axe_linter_url: 'https://test-linter.com'
    })

    getChangedFilesFn = async () => ['test.js']

    readFileFn = (path: string) => {
      if (path === 'axe-linter.yml') return 'rules:\n  test-rule: error'
      throw new Error(`Unexpected file: ${path}`)
    }

    lintFilesFn = async () => 1

    await run(mockCore)

    assert.strictEqual(
      (mockCore.setFailed as any).mock.calls[0].arguments[0],
      'Found 1 accessibility issue'
    )
  })

  it('should handle missing required inputs', async () => {
    // Default mock throws for required inputs not in the map
    setupInputs({})

    await run(mockCore)

    assert.strictEqual(
      (mockCore.setFailed as any).mock.calls[0].arguments[0],
      'Input required and not supplied: github_token'
    )
  })

  it('should handle git error', async () => {
    setupInputs({
      github_token: 'test-token',
      api_key: 'test-api-key',
      axe_linter_url: 'https://test-linter.com'
    })

    getChangedFilesFn = async () => {
      throw new Error('Git error')
    }

    await run(mockCore)

    assert.strictEqual(
      (mockCore.setFailed as any).mock.calls[0].arguments[0],
      'Git error'
    )
  })

  it('should handle non-Error exceptions', async () => {
    setupInputs({
      github_token: 'test-token',
      api_key: 'test-api-key',
      axe_linter_url: ''
    })

    getChangedFilesFn = async () => {
      throw { foo: 'bar' }
    }

    await run(mockCore)

    assert.strictEqual(
      (mockCore.setFailed as any).mock.calls[0].arguments[0],
      'An unexpected error occurred: {"foo":"bar"}'
    )
  })

  describe('AXE_LINTER_ONLY', () => {
    it('should lint only the specified files, ignoring changed files', async () => {
      process.env.AXE_LINTER_ONLY = 'fixtures/**'
      setupInputs({
        github_token: 'test-token',
        api_key: 'test-api-key',
        axe_linter_url: 'https://test-linter.com'
      })

      globSyncFn = (pattern: string) => {
        if (pattern === 'fixtures/**') return ['fixtures/accessible.html']
        return []
      }
      readFileFn = () => {
        throw new Error('ENOENT')
      }

      let lintCalledWith: any[] = []
      lintFilesFn = async (...args) => {
        lintCalledWith = args
        return 0
      }
      let getChangedFilesCalled = false
      getChangedFilesFn = async () => {
        getChangedFilesCalled = true
        return []
      }

      await run(mockCore)

      assert.strictEqual(getChangedFilesCalled, false)
      assert.deepStrictEqual(lintCalledWith[0], ['fixtures/accessible.html'])
    })

    it('should lint only files even when glob resolves multiple', async () => {
      process.env.AXE_LINTER_ONLY = 'fixtures/**'
      setupInputs({
        github_token: 'test-token',
        api_key: 'test-api-key',
        axe_linter_url: 'https://test-linter.com'
      })

      globSyncFn = (pattern: string) => {
        if (pattern === 'fixtures/**')
          return ['fixtures/accessible.html', 'fixtures/accessible.vue']
        return []
      }
      readFileFn = () => {
        throw new Error('ENOENT')
      }

      let lintCalledWith: any[] = []
      lintFilesFn = async (...args) => {
        lintCalledWith = args
        return 0
      }
      let getChangedFilesCalled = false
      getChangedFilesFn = async () => {
        getChangedFilesCalled = true
        return []
      }

      await run(mockCore)

      assert.strictEqual(getChangedFilesCalled, false)
      assert.deepStrictEqual(lintCalledWith[0], [
        'fixtures/accessible.html',
        'fixtures/accessible.vue'
      ])
    })

    it('should fall back to getChangedFiles when env var is not set', async () => {
      setupInputs({
        github_token: 'test-token',
        api_key: 'test-api-key',
        axe_linter_url: 'https://test-linter.com'
      })

      let getChangedFilesCalled = false
      getChangedFilesFn = async () => {
        getChangedFilesCalled = true
        return ['test.js']
      }
      readFileFn = () => {
        throw new Error('ENOENT')
      }
      let globSyncCalled = false
      globSyncFn = () => {
        globSyncCalled = true
        return []
      }

      lintFilesFn = async () => 0

      await run(mockCore)

      assert.strictEqual(getChangedFilesCalled, true)
      assert.strictEqual(globSyncCalled, false)
    })

    it('should handle multiple glob patterns separated by newlines', async () => {
      process.env.AXE_LINTER_ONLY = 'fixtures/*.html\nfixtures/*.vue'
      setupInputs({
        github_token: 'test-token',
        api_key: 'test-api-key',
        axe_linter_url: 'https://test-linter.com'
      })

      globSyncFn = (pattern: string) => {
        if (pattern === 'fixtures/*.html')
          return ['fixtures/accessible.html', 'fixtures/accessible.htm']
        if (pattern === 'fixtures/*.vue') return ['fixtures/accessible.vue']
        return []
      }
      readFileFn = () => {
        throw new Error('ENOENT')
      }

      let lintCalledWith: any[] = []
      lintFilesFn = async (...args) => {
        lintCalledWith = args
        return 0
      }
      let getChangedFilesCalled = false
      getChangedFilesFn = async () => {
        getChangedFilesCalled = true
        return []
      }

      await run(mockCore)

      assert.strictEqual(getChangedFilesCalled, false)
      assert.deepStrictEqual(lintCalledWith[0], [
        'fixtures/accessible.html',
        'fixtures/accessible.htm',
        'fixtures/accessible.vue'
      ])
    })
  })
})

describe('getOnlyFiles', () => {
  beforeEach(() => {
    globSyncFn = () => []
    statSyncFn = () => ({ isFile: () => true })
    delete process.env.AXE_LINTER_ONLY
  })

  afterEach(() => {
    delete process.env.AXE_LINTER_ONLY
  })

  it('should return empty array when env var is not set', () => {
    let globSyncCalled = false
    globSyncFn = () => {
      globSyncCalled = true
      return []
    }

    const result = getOnlyFiles()
    assert.deepStrictEqual(result, [])
    assert.strictEqual(globSyncCalled, false)
  })

  it('should resolve glob patterns from env var', () => {
    process.env.AXE_LINTER_ONLY = 'fixtures/**'
    globSyncFn = (pattern: string) => {
      if (pattern === 'fixtures/**') return ['fixtures/a.html', 'fixtures/b.js']
      return []
    }

    const result = getOnlyFiles()
    assert.deepStrictEqual(result, ['fixtures/a.html', 'fixtures/b.js'])
  })

  it('should skip empty lines', () => {
    process.env.AXE_LINTER_ONLY = 'fixtures/*.html\n\nfixtures/*.js\n'
    globSyncFn = (pattern: string) => {
      if (pattern === 'fixtures/*.html') return ['fixtures/a.html']
      if (pattern === 'fixtures/*.js') return ['fixtures/b.js']
      return []
    }

    const result = getOnlyFiles()
    assert.deepStrictEqual(result, ['fixtures/a.html', 'fixtures/b.js'])
  })
})
