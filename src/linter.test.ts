import { assert } from 'chai'
import * as sinon from 'sinon'
import * as core from '@actions/core'
import nock from 'nock'
import { lintFiles } from './linter'

interface LinterError {
  ruleId: string
  lineNumber: number
  column: number
  endColumn: number
  description: string
}

interface LinterResponse {
  report: {
    errors: LinterError[]
  }
}

type MockResponses = {
  [key: string]: LinterResponse
}

describe('linter', () => {
  let sandbox: sinon.SinonSandbox
  let errorStub: sinon.SinonStub
  let debugStub: sinon.SinonStub
  let readFileStub: sinon.SinonStub

  beforeEach(() => {
    sandbox = sinon.createSandbox()

    // Stub core functions
    errorStub = sandbox.stub(core, 'error')
    debugStub = sandbox.stub(core, 'debug')

    // Stub file system
    readFileStub = sandbox.stub()
    sandbox.replace(require('fs/promises'), 'readFile', readFileStub)

    // Enable Nock
    nock.disableNetConnect()
  })

  afterEach(() => {
    sandbox.restore()
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('lintFiles', () => {
    const apiKey = 'test-api-key'
    const axeLinterUrl = 'https://test-linter.com'
    const linterConfig = { rules: { 'test-rule': 'error' } }

    it('should process files and return total error count', async () => {
      const files = ['test.js', 'test.html']
      const fileContents: Record<string, string> = {
        'test.js': '<div>test</div>',
        'test.html': '<div>test</div>'
      }

      // Mock file reads
      for (const file of files) {
        readFileStub.withArgs(file, 'utf8').resolves(fileContents[file])
      }

      // Mock linter responses
      const mockResponses: MockResponses = {
        'test.js': {
          report: {
            errors: [
              {
                ruleId: 'test-rule-1',
                lineNumber: 1,
                column: 1,
                endColumn: 10,
                description: 'Test error 1'
              }
            ]
          }
        },
        'test.html': {
          report: {
            errors: [
              {
                ruleId: 'test-rule-2',
                lineNumber: 1,
                column: 1,
                endColumn: 15,
                description: 'Test error 2'
              }
            ]
          }
        }
      }

      // Setup Nock interceptors for each file
      files.forEach((file) => {
        nock(axeLinterUrl)
          .post('/lint-source', (body: any) => {
            return (
              body.filename === file &&
              body.source === fileContents[file] &&
              JSON.stringify(body.config) === JSON.stringify(linterConfig)
            )
          })
          .matchHeader('authorization', apiKey)
          .matchHeader('content-type', 'application/json')
          .reply(200, mockResponses[file])
      })

      const errorCount = await lintFiles(
        files,
        apiKey,
        axeLinterUrl,
        linterConfig
      )

      assert.equal(errorCount, 2, 'should return correct total error count')
      assert.equal(errorStub.callCount, 2, 'should report each error')

      // Verify error reporting
      assert.isTrue(
        errorStub.calledWith('test-rule-1 - Test error 1', {
          file: 'test.js',
          startLine: 1,
          startColumn: 1,
          endColumn: 10,
          title: 'Axe Linter'
        }),
        'should report first error correctly'
      )

      assert.isTrue(
        errorStub.calledWith('test-rule-2 - Test error 2', {
          file: 'test.html',
          startLine: 1,
          startColumn: 1,
          endColumn: 15,
          title: 'Axe Linter'
        }),
        'should report second error correctly'
      )
    })

    it('should skip empty files', async () => {
      const files = ['empty.js']
      readFileStub.withArgs('empty.js', 'utf8').resolves('   ')

      const scope = nock(axeLinterUrl).post('/lint-source').reply(200)

      const errorCount = await lintFiles(
        files,
        apiKey,
        axeLinterUrl,
        linterConfig
      )

      assert.equal(errorCount, 0, 'should return zero errors for empty files')
      assert.isTrue(
        debugStub.calledWith('Skipping empty file empty.js'),
        'should log debug message'
      )
      assert.isFalse(scope.isDone(), 'no HTTP requests should be made')
    })

    it('should handle linter API errors', async () => {
      const files = ['error.js']
      readFileStub.withArgs('error.js', 'utf8').resolves('const x = 1;')

      const scope = nock(axeLinterUrl).post('/lint-source').reply(200, {
        error: 'API Error'
      })

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.instanceOf(error, Error)
        assert.equal(error.message, 'Error processing error.js: API Error')
        assert.isTrue(scope.isDone(), 'API request should be made')
      }
    })

    it('should handle file read errors', async () => {
      const files = ['nonexistent.js']
      const fileError = new Error('ENOENT')
      readFileStub.rejects(fileError)

      const scope = nock(axeLinterUrl).post('/lint-source').reply(200)

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.instanceOf(error, Error)
        assert.equal(error.message, 'Error processing nonexistent.js: ENOENT')
        assert.isFalse(scope.isDone(), 'no HTTP requests should be made')
      }
    })

    it('should handle network errors', async () => {
      const files = ['test.js']
      readFileStub.withArgs('test.js', 'utf8').resolves('const x = 1;')

      const scope = nock(axeLinterUrl)
        .post('/lint-source')
        .replyWithError('Network Error')

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.instanceOf(error, Error)
        assert.include(error.message, 'Network Error')
        assert.isTrue(scope.isDone(), 'API request should be made')
      }
    })

    it('should handle HTTP errors', async () => {
      const files = ['test.js']
      readFileStub.withArgs('test.js', 'utf8').resolves('const x = 1;')

      const scope = nock(axeLinterUrl)
        .post('/lint-source')
        .reply(500, 'Internal Server Error')

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.instanceOf(error, Error)
        assert.isTrue(scope.isDone(), 'API request should be made')
      }
    })

    it('should handle malformed API responses', async () => {
      const files = ['test.js']
      readFileStub.withArgs('test.js', 'utf8').resolves('const x = 1;')

      const scope = nock(axeLinterUrl).post('/lint-source').reply(200, {
        report: 'invalid-format'
      })

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.instanceOf(error, Error)
        assert.isTrue(scope.isDone(), 'API request should be made')
      }
    })
  })
})
