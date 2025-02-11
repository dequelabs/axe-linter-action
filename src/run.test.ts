import 'mocha'
import { assert } from 'chai'
import * as sinon from 'sinon'
import * as yaml from 'js-yaml'
import run from './run'
import * as gitModule from './git'
import * as linterModule from './linter'
import { Core } from './types'

describe('run', () => {
  let sandbox: sinon.SinonSandbox
  let mockCore: Core
  let readFileStub: sinon.SinonStub
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
    sandbox.replace(require('fs'), 'readFileSync', readFileStub)

    // Stub git and linter functions
    getChangedFilesStub = sandbox.stub(gitModule, 'getChangedFiles')
    lintFilesStub = sandbox.stub(linterModule, 'lintFiles')
  })

  afterEach(() => {
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
      .returns(yaml.dump(mockConfig))

    // Setup linter response
    lintFilesStub.resolves(0)

    await run(mockCore)

    // Verify inputs were processed correctly
    assert.isTrue(
      (mockCore.getInput as sinon.SinonStub).calledWith('github_token', {
        required: true
      })
    )
    assert.isTrue(
      (mockCore.getInput as sinon.SinonStub).calledWith('api_key', {
        required: true
      })
    )
    // Verify files were processed
    assert.isTrue(getChangedFilesStub.calledWith('test-token'))

    assert.isTrue(
      lintFilesStub.calledWith(
        ['test.js', 'test.html'],
        'test-api-key',
        'https://test-linter.com',
        mockConfig
      )
    )

    // Verify no errors were reported
    assert.isFalse((mockCore.setFailed as sinon.SinonStub).called)
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

    assert.isTrue(
      (mockCore.debug as sinon.SinonStub).calledWith('No files to lint'),
      'Should log debug message for no files'
    )
    assert.isFalse(
      lintFilesStub.called,
      'Linter should not be called with no files'
    )
    assert.isFalse(
      (mockCore.setFailed as sinon.SinonStub).called,
      'Should not set failed status'
    )

    // Verify readFileSync was not called
    assert.isFalse(readFileStub.called, 'Should not attempt to read any files')
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
    assert.isTrue(
      (mockCore.debug as sinon.SinonStub).calledWith(
        'Error loading axe-linter.yml no config found or invalid config: ENOENT'
      ),
      'Should log correct debug message for missing config'
    )

    // Verify linter was called with correct parameters
    assert.isTrue(
      lintFilesStub.calledWith(['test.js'], 'test-api-key', '', {}),
      'Should call linter with default config'
    )

    // Verify readFileSync was called correctly
    assert.isTrue(
      readFileStub.calledWith('axe-linter.yml', 'utf8'),
      'Should attempt to read config file'
    )

    // Verify setFailed was not called since linter returned 0 errors
    assert.isFalse(
      (mockCore.setFailed as sinon.SinonStub).called,
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

    assert.isTrue(
      (mockCore.setFailed as sinon.SinonStub).calledWith(
        'Found 2 accessibility issues'
      )
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

    assert.isTrue(
      (mockCore.setFailed as sinon.SinonStub).calledWith(
        'Found 1 accessibility issue'
      )
    )
  })

  it('should handle missing required inputs', async () => {
    // Simulate missing required input
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('github_token', { required: true })
      .throws(new Error('Input required and not supplied: github_token'))

    await run(mockCore)

    assert.isTrue(
      (mockCore.setFailed as sinon.SinonStub).calledWith(
        'Input required and not supplied: github_token'
      )
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

    assert.isTrue(
      (mockCore.setFailed as sinon.SinonStub).calledWith('Git error')
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
})
