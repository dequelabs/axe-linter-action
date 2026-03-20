import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as sinon from 'sinon'
import { stringify } from 'yaml'
import run, { getOnlyFiles } from './run'
import * as gitModule from './git'
import * as linterModule from './linter'
import { Core } from './types'

describe('run', () => {
  let sandbox: sinon.SinonSandbox
  let mockCore: Core
  let readFileStub: sinon.SinonStub
  let globSyncStub: sinon.SinonStub
  let getChangedFilesStub: sinon.SinonStub
  let lintFilesStub: sinon.SinonStub

  beforeEach(() => {
    sandbox = sinon.createSandbox()

    // Create mock Core implementation
    mockCore = {
      getInput: sandbox.stub(),
      setFailed: sandbox.stub(),
      info: sandbox.stub(),
      debug: sandbox.stub(),
      setOutput: sandbox.stub()
    }

    // Stub file system
    readFileStub = sandbox.stub()
    globSyncStub = sandbox.stub()
    sandbox.replace(require('fs'), 'readFileSync', readFileStub)
    sandbox.replace(require('fs'), 'globSync', globSyncStub)
    sandbox.replace(
      require('fs'),
      'statSync',
      sandbox.stub().returns({ isFile: () => true })
    )

    // Stub git and linter functions
    getChangedFilesStub = sandbox.stub(gitModule, 'getChangedFiles')
    lintFilesStub = sandbox.stub(linterModule, 'lintFiles')

    // Clear env var by default
    delete process.env.AXE_LINTER_ONLY
  })

  afterEach(() => {
    delete process.env.AXE_LINTER_ONLY
    sandbox.restore()
  })

  it('should process files successfully with no errors', async () => {
    // Setup inputs
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('github_token', { required: true })
      .returns('test-token')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('api_key', { required: true })
      .returns('test-api-key')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('axe_linter_url')
      .returns('https://test-linter.com/')

    // Setup changed files
    getChangedFilesStub.resolves(['test.js', 'test.html'])

    // Setup config file
    const mockConfig = { rules: { 'test-rule': 'error' } }
    readFileStub
      .withArgs('axe-linter.yml', 'utf8')
      .returns(stringify(mockConfig))

    // Setup linter response
    lintFilesStub.resolves(0)

    await run(mockCore)

    // Verify inputs were processed correctly
    assert.strictEqual(
      (mockCore.getInput as sinon.SinonStub).calledWith('github_token', {
        required: true
      }),
      true
    )
    assert.strictEqual(
      (mockCore.getInput as sinon.SinonStub).calledWith('api_key', {
        required: true
      }),
      true
    )
    // Verify files were processed
    assert.strictEqual(getChangedFilesStub.calledWith('test-token'), true)

    assert.strictEqual(
      lintFilesStub.calledWith(
        ['test.js', 'test.html'],
        'test-api-key',
        'https://test-linter.com',
        mockConfig
      ),
      true
    )

    // Verify no errors were reported
    assert.strictEqual((mockCore.setFailed as sinon.SinonStub).called, false)
  })

  it('should handle no changed files', async () => {
    // Setup inputs
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('github_token', { required: true })
      .returns('test-token')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('api_key', { required: true })
      .returns('test-api-key')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('axe_linter_url')
      .returns('https://test-linter.com')

    // Return empty file list
    getChangedFilesStub.resolves([])

    await run(mockCore)

    assert.strictEqual(
      (mockCore.debug as sinon.SinonStub).calledWith('No files to lint'),
      true,
      'Should log debug message for no files'
    )
    assert.strictEqual(
      lintFilesStub.called,
      false,
      'Linter should not be called with no files'
    )
    assert.strictEqual(
      (mockCore.setFailed as sinon.SinonStub).called,
      false,
      'Should not set failed status'
    )

    // Verify readFileSync was not called
    assert.strictEqual(
      readFileStub.called,
      false,
      'Should not attempt to read any files'
    )
  })

  it('should handle missing config file', async () => {
    // Setup inputs
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('github_token', { required: true })
      .returns('test-token')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('api_key', { required: true })
      .returns('test-api-key')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('axe_linter_url')
      .returns('') // This will use the default URL

    getChangedFilesStub.resolves(['test.js'])

    readFileStub.withArgs('axe-linter.yml', 'utf8').throws(new Error('ENOENT'))

    lintFilesStub.resolves(0)

    await run(mockCore)

    // Verify debug message for missing config
    assert.strictEqual(
      (mockCore.debug as sinon.SinonStub).calledWith(
        'Error loading axe-linter.yml no config found or invalid config: ENOENT'
      ),
      true,
      'Should log correct debug message for missing config'
    )

    // Verify linter was called with correct parameters
    assert.strictEqual(
      lintFilesStub.calledWith(['test.js'], 'test-api-key', '', {}),
      true,
      'Should call linter with default config'
    )

    // Verify readFileSync was called correctly
    assert.strictEqual(
      readFileStub.calledWith('axe-linter.yml', 'utf8'),
      true,
      'Should attempt to read config file'
    )

    // Verify setFailed was not called since linter returned 0 errors
    assert.strictEqual(
      (mockCore.setFailed as sinon.SinonStub).called,
      false,
      'Should not set failed status'
    )
  })

  it('should handle linter errors', async () => {
    // Setup inputs
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('github_token', { required: true })
      .returns('test-token')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('api_key', { required: true })
      .returns('test-api-key')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('axe_linter_url')
      .returns('https://test-linter.com')

    getChangedFilesStub.resolves(['test.js'])

    readFileStub
      .withArgs('axe-linter.yml', 'utf8')
      .returns('rules:\n  test-rule: error')

    lintFilesStub.resolves(2)

    await run(mockCore)

    assert.strictEqual(
      (mockCore.setFailed as sinon.SinonStub).calledWith(
        'Found 2 accessibility issues'
      ),
      true
    )
  })

  it('should handle single linter error', async () => {
    // Setup inputs
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('github_token', { required: true })
      .returns('test-token')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('api_key', { required: true })
      .returns('test-api-key')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('axe_linter_url')
      .returns('https://test-linter.com')

    getChangedFilesStub.resolves(['test.js'])

    readFileStub
      .withArgs('axe-linter.yml', 'utf8')
      .returns('rules:\n  test-rule: error')

    lintFilesStub.resolves(1)

    await run(mockCore)

    assert.strictEqual(
      (mockCore.setFailed as sinon.SinonStub).calledWith(
        'Found 1 accessibility issue'
      ),
      true
    )
  })

  it('should handle missing required inputs', async () => {
    // Simulate missing required input
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('github_token', { required: true })
      .throws(new Error('Input required and not supplied: github_token'))

    await run(mockCore)

    assert.strictEqual(
      (mockCore.setFailed as sinon.SinonStub).calledWith(
        'Input required and not supplied: github_token'
      ),
      true
    )
  })

  it('should handle git error', async () => {
    // Setup inputs
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('github_token', { required: true })
      .returns('test-token')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('api_key', { required: true })
      .returns('test-api-key')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('axe_linter_url')
      .returns('https://test-linter.com')

    // Simulate git error
    const error = new Error('Git error')
    getChangedFilesStub.rejects(error)

    await run(mockCore)

    assert.strictEqual(
      (mockCore.setFailed as sinon.SinonStub).calledWith('Git error'),
      true
    )
  })

  it('should handle non-Error exceptions', async () => {
    // Setup inputs
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('github_token', { required: true })
      .returns('test-token')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('api_key', { required: true })
      .returns('test-api-key')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('axe_linter_url')
      .returns('')

    // Simulate a non-Error object being thrown
    getChangedFilesStub.rejects({ foo: 'bar' })

    await run(mockCore)

    // Verify setFailed was called with the correct message
    assert.strictEqual(
      (mockCore.setFailed as sinon.SinonStub).getCall(0).args[0],
      'An unexpected error occurred: {"foo":"bar"}'
    )
  })

  describe('AXE_LINTER_ONLY', () => {
    it('should lint only the specified files, ignoring changed files', async () => {
      process.env.AXE_LINTER_ONLY = 'fixtures/**'
      ;(mockCore.getInput as sinon.SinonStub)
        .withArgs('github_token', { required: true })
        .returns('test-token')
      ;(mockCore.getInput as sinon.SinonStub)
        .withArgs('api_key', { required: true })
        .returns('test-api-key')
      ;(mockCore.getInput as sinon.SinonStub)
        .withArgs('axe_linter_url')
        .returns('https://test-linter.com')

      globSyncStub.withArgs('fixtures/**').returns(['fixtures/accessible.html'])
      readFileStub
        .withArgs('axe-linter.yml', 'utf8')
        .throws(new Error('ENOENT'))
      lintFilesStub.resolves(0)

      await run(mockCore)

      assert.strictEqual(
        getChangedFilesStub.called,
        false,
        'getChangedFiles should not be called when AXE_LINTER_ONLY is set'
      )
      assert.deepEqual(lintFilesStub.getCall(0).args[0], [
        'fixtures/accessible.html'
      ])
    })

    it('should lint only files even when glob resolves multiple', async () => {
      process.env.AXE_LINTER_ONLY = 'fixtures/**'
      ;(mockCore.getInput as sinon.SinonStub)
        .withArgs('github_token', { required: true })
        .returns('test-token')
      ;(mockCore.getInput as sinon.SinonStub)
        .withArgs('api_key', { required: true })
        .returns('test-api-key')
      ;(mockCore.getInput as sinon.SinonStub)
        .withArgs('axe_linter_url')
        .returns('https://test-linter.com')

      globSyncStub
        .withArgs('fixtures/**')
        .returns(['fixtures/accessible.html', 'fixtures/accessible.vue'])
      readFileStub
        .withArgs('axe-linter.yml', 'utf8')
        .throws(new Error('ENOENT'))
      lintFilesStub.resolves(0)

      await run(mockCore)

      assert.strictEqual(getChangedFilesStub.called, false)
      assert.deepEqual(lintFilesStub.getCall(0).args[0], [
        'fixtures/accessible.html',
        'fixtures/accessible.vue'
      ])
    })

    it('should fall back to getChangedFiles when env var is not set', async () => {
      ;(mockCore.getInput as sinon.SinonStub)
        .withArgs('github_token', { required: true })
        .returns('test-token')
      ;(mockCore.getInput as sinon.SinonStub)
        .withArgs('api_key', { required: true })
        .returns('test-api-key')
      ;(mockCore.getInput as sinon.SinonStub)
        .withArgs('axe_linter_url')
        .returns('https://test-linter.com')

      getChangedFilesStub.resolves(['test.js'])
      readFileStub
        .withArgs('axe-linter.yml', 'utf8')
        .throws(new Error('ENOENT'))
      lintFilesStub.resolves(0)

      await run(mockCore)

      assert.strictEqual(getChangedFilesStub.called, true)
      assert.strictEqual(globSyncStub.called, false)
    })

    it('should handle multiple glob patterns separated by newlines', async () => {
      process.env.AXE_LINTER_ONLY = 'fixtures/*.html\nfixtures/*.vue'
      ;(mockCore.getInput as sinon.SinonStub)
        .withArgs('github_token', { required: true })
        .returns('test-token')
      ;(mockCore.getInput as sinon.SinonStub)
        .withArgs('api_key', { required: true })
        .returns('test-api-key')
      ;(mockCore.getInput as sinon.SinonStub)
        .withArgs('axe_linter_url')
        .returns('https://test-linter.com')

      globSyncStub
        .withArgs('fixtures/*.html')
        .returns(['fixtures/accessible.html', 'fixtures/accessible.htm'])
      globSyncStub
        .withArgs('fixtures/*.vue')
        .returns(['fixtures/accessible.vue'])
      readFileStub
        .withArgs('axe-linter.yml', 'utf8')
        .throws(new Error('ENOENT'))
      lintFilesStub.resolves(0)

      await run(mockCore)

      assert.strictEqual(getChangedFilesStub.called, false)
      assert.deepEqual(lintFilesStub.getCall(0).args[0], [
        'fixtures/accessible.html',
        'fixtures/accessible.htm',
        'fixtures/accessible.vue'
      ])
    })
  })
})

describe('getOnlyFiles', () => {
  let sandbox: sinon.SinonSandbox
  let globSyncStub: sinon.SinonStub

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    globSyncStub = sandbox.stub()
    sandbox.replace(require('fs'), 'globSync', globSyncStub)
    sandbox.replace(
      require('fs'),
      'statSync',
      sandbox.stub().returns({ isFile: () => true })
    )
    delete process.env.AXE_LINTER_ONLY
  })

  afterEach(() => {
    delete process.env.AXE_LINTER_ONLY
    sandbox.restore()
  })

  it('should return empty array when env var is not set', () => {
    const result = getOnlyFiles()
    assert.deepEqual(result, [])
    assert.strictEqual(globSyncStub.called, false)
  })

  it('should resolve glob patterns from env var', () => {
    process.env.AXE_LINTER_ONLY = 'fixtures/**'
    globSyncStub
      .withArgs('fixtures/**')
      .returns(['fixtures/a.html', 'fixtures/b.js'])

    const result = getOnlyFiles()
    assert.deepEqual(result, ['fixtures/a.html', 'fixtures/b.js'])
  })

  it('should skip empty lines', () => {
    process.env.AXE_LINTER_ONLY = 'fixtures/*.html\n\nfixtures/*.js\n'
    globSyncStub.withArgs('fixtures/*.html').returns(['fixtures/a.html'])
    globSyncStub.withArgs('fixtures/*.js').returns(['fixtures/b.js'])

    const result = getOnlyFiles()
    assert.deepEqual(result, ['fixtures/a.html', 'fixtures/b.js'])
  })
})
