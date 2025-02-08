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
    sandbox.replace(require('fs/promises'), 'readFile', readFileStub)

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
      .resolves(yaml.dump(mockConfig))

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

    // Return empty file list
    getChangedFilesStub.resolves([])

    await run(mockCore)

    assert.isTrue(
      (mockCore.info as sinon.SinonStub).calledWith('No files to lint')
    )
    assert.isFalse(lintFilesStub.called)
    assert.isFalse((mockCore.setFailed as sinon.SinonStub).called)
  })

  it('should handle missing config file', async () => {
    // Setup inputs
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('github_token', { required: true })
      .returns('test-token')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('api_key', { required: true })
      .returns('test-api-key')

    // Setup changed files
    getChangedFilesStub.resolves(['test.js'])

    // Simulate missing config file
    readFileStub.withArgs('axe-linter.yml', 'utf8').rejects(new Error('ENOENT'))

    // Setup linter response
    lintFilesStub.resolves(0)

    await run(mockCore)

    assert.isTrue(
      (mockCore.debug as sinon.SinonStub).calledWith(
        'No axe-linter.yml found or empty config'
      )
    )
    assert.isTrue(
      lintFilesStub.calledWith(
        ['test.js'],
        'test-api-key',
        'https://axe-linter.deque.com',
        {}
      )
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

    // Setup changed files
    getChangedFilesStub.resolves(['test.js'])

    // Setup linter response with errors
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

    // Setup changed files
    getChangedFilesStub.resolves(['test.js'])

    // Setup linter response with one error
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
      'An unexpected error occurred'
    )
  })

  it('should use default linter URL when not provided', async () => {
    // Setup inputs with no linter URL
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('github_token', { required: true })
      .returns('test-token')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('api_key', { required: true })
      .returns('test-api-key')
    ;(mockCore.getInput as sinon.SinonStub)
      .withArgs('axe_linter_url')
      .returns('')

    // Setup changed files
    getChangedFilesStub.resolves(['test.js'])

    // Setup linter response
    lintFilesStub.resolves(0)

    await run(mockCore)

    assert.isTrue(
      lintFilesStub.calledWith(
        ['test.js'],
        'test-api-key',
        'https://axe-linter.deque.com',
        {}
      )
    )
  })
})
