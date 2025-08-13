import 'mocha'
import { assert } from 'chai'
import * as sinon from 'sinon'
import * as core from '@actions/core'
import nock from 'nock'
import { lintFiles } from './linter'
import type { LinterResponse } from './types'

type MockResponses = Record<string, LinterResponse>

describe('linter', () => {
  let sandbox: sinon.SinonSandbox
  let errorStub: sinon.SinonStub
  let debugStub: sinon.SinonStub
  let summaryStub: any
  let readFileStub: sinon.SinonStub
  let fetchStub: sinon.SinonStub

  beforeEach(() => {
    sandbox = sinon.createSandbox()

    // Stub core functions
    errorStub = sandbox.stub(core, 'error')
    debugStub = sandbox.stub(core, 'debug')

    // Create summary stub with chainable methods
    summaryStub = {
      addHeading: sandbox.stub().returnsThis(),
      addBreak: sandbox.stub().returnsThis(),
      addList: sandbox.stub().returnsThis(),
      addRaw: sandbox.stub().returnsThis(),
      write: sandbox.stub().resolves()
    }
    sandbox.stub(core, 'summary').value(summaryStub)

    // Stub file system
    readFileStub = sandbox.stub()
    sandbox.replace(require('fs'), 'readFileSync', readFileStub)

    // Stub fetch
    fetchStub = sandbox.stub()

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
        readFileStub.withArgs(file, 'utf8').returns(fileContents[file])
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
        errorStub.calledWith('test.js:1 - test-rule-1 - Test error 1', {
          file: 'test.js',
          startLine: 1,
          startColumn: 1,
          endColumn: 10,
          title: 'Axe Linter'
        }),
        'should report first error correctly'
      )

      assert.isTrue(
        errorStub.calledWith('test.html:1 - test-rule-2 - Test error 2', {
          file: 'test.html',
          startLine: 1,
          startColumn: 1,
          endColumn: 15,
          title: 'Axe Linter'
        }),
        'should report second error correctly'
      )
    })

    it('should handle a single file', async () => {
      const files = ['test.js']
      const fileContents = { 'test.js': '<div>test</div>' }

      readFileStub.withArgs('test.js', 'utf8').returns(fileContents['test.js'])

      const scope = nock(axeLinterUrl)
        .post('/lint-source')
        .reply(200, {
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
        })

      const errorCount = await lintFiles(
        files,
        apiKey,
        axeLinterUrl,
        linterConfig
      )

      assert.equal(errorCount, 1, 'should return one error for single file')
      assert.isTrue(scope.isDone(), 'API request should be made')
    })

    it('should skip empty files', async () => {
      const files = ['empty.js']
      readFileStub.withArgs('empty.js', 'utf8').returns('   ')

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
      readFileStub
        .withArgs('error.js', 'utf8')
        .returns('<div><h1>hello world</h1></div>')

      const scope = nock(axeLinterUrl).post('/lint-source').reply(200, {
        error: 'API Error'
      })

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.instanceOf(error, Error)
        assert.equal(error.message, 'API Error')
        assert.isTrue(scope.isDone(), 'API request should be made')
      }
    })

    it('should handle file read errors', async () => {
      const files = ['nonexistent.js']
      const fileError = new Error('ENOENT')
      readFileStub.throws(fileError)

      const scope = nock(axeLinterUrl).post('/lint-source').reply(200)

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.instanceOf(error, Error)
        assert.equal(error.message, 'ENOENT')
        assert.isFalse(scope.isDone(), 'no HTTP requests should be made')
      }
    })

    it('should handle network errors', async () => {
      const files = ['test.js']
      readFileStub
        .withArgs('test.js', 'utf8')
        .returns('<div><h1>hello world</h1></div>')

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
      readFileStub
        .withArgs('test.js', 'utf8')
        .returns('<div><h1>hello world</h1></div>')

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
      readFileStub
        .withArgs('test.js', 'utf8')
        .returns('<div><h1>hello world</h1></div>')

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

    it('should rethrow non-Error objects', async () => {
      const files = ['test.js']

      readFileStub
        .withArgs('test.js', 'utf8')
        .returns('<div><h1>hello world</h1></div>')
      sandbox.replace(require('node-fetch'), 'default', fetchStub)

      // Make fetch throw a non-Error object
      const nonErrorObject = {
        type: 'CustomError',
        details: 'Something went wrong',
        statusCode: 500
      }

      fetchStub.rejects(nonErrorObject)

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('Should have thrown an error')
      } catch (error) {
        // Verify that the caught error is our non-Error object
        assert.isFalse(
          error instanceof Error,
          'Error should not be an Error instance'
        )
        assert.deepEqual(
          error,
          nonErrorObject,
          'Should be the original non-Error object'
        )
        assert.equal(
          (error as any).type,
          'CustomError',
          'Should preserve custom properties'
        )
        assert.equal(
          (error as any).details,
          'Something went wrong',
          'Should preserve error details'
        )
        assert.equal(
          (error as any).statusCode,
          500,
          'Should preserve status code'
        )
      }
    })

    it('should handle invalid linter config errors from server', async () => {
      const files = ['test.js']
      const invalidLinterConfig = {
        rules: {
          'invalid-rule': 'invalid-value'
        }
      }

      // Setup file read
      readFileStub.withArgs('test.js', 'utf8').returns('const x = 1;')

      // Setup Nock to simulate 400 response with config validation error
      const scope = nock(axeLinterUrl)
        .post('/lint-source', {
          source: 'const x = 1;',
          filename: 'test.js',
          config: invalidLinterConfig
        })
        .matchHeader('content-type', 'application/json')
        .matchHeader('authorization', apiKey)
        .replyWithError('Invalid config')

      try {
        await lintFiles(files, apiKey, axeLinterUrl, invalidLinterConfig)
        assert.fail('Should have thrown an error')
      } catch (error) {
        assert.instanceOf(error, Error)
        assert.include(error.message, 'Invalid config')
        assert.isTrue(scope.isDone(), 'API request should be made')
      }
    })

    it('should create summary with grouped errors', async () => {
      const files = ['app.js', 'index.html']
      const apiKey = 'test-key'
      const axeLinterUrl = 'https://test-linter.com'
      const linterConfig = {}

      // Setup file reads
      readFileStub.withArgs('app.js', 'utf8').returns('const x = 1;')
      readFileStub.withArgs('index.html', 'utf8').returns('<div>test</div>')

      // Mock API responses
      nock(axeLinterUrl)
        .post('/lint-source', {
          source: 'const x = 1;',
          filename: 'app.js',
          config: linterConfig
        })
        .reply(200, {
          report: {
            errors: [
              {
                ruleId: 'click-handler',
                lineNumber: 1,
                column: 1,
                endColumn: 10,
                description: 'Click handler should have keyboard equivalent'
              }
            ]
          }
        })

      nock(axeLinterUrl)
        .post('/lint-source', {
          source: '<div>test</div>',
          filename: 'index.html',
          config: linterConfig
        })
        .reply(200, {
          report: {
            errors: [
              {
                ruleId: 'color-contrast',
                lineNumber: 1,
                column: 1,
                endColumn: 15,
                description: 'Element has insufficient color contrast'
              },
              {
                ruleId: 'aria-label',
                lineNumber: 1,
                column: 1,
                endColumn: 15,
                description: 'Element should have aria-label'
              }
            ]
          }
        })

      const errorCount = await lintFiles(
        files,
        apiKey,
        axeLinterUrl,
        linterConfig
      )

      // Verify error count
      assert.equal(errorCount, 3, 'Should return correct total error count')

      // Verify summary creation
      assert.isTrue(
        summaryStub.addHeading.calledWith('Accessibility Linting Results'),
        'Should add main heading'
      )

      // Verify file sections
      assert.isTrue(
        summaryStub.addHeading.calledWith('❌ Error in app.js:', 2),
        'Should add app.js section'
      )

      assert.isTrue(
        summaryStub.addHeading.calledWith('❌ Errors in index.html:', 2),
        'Should add index.html section'
      )

      // Verify error lists
      const appJsErrors = [
        '🔴 Line 1: click-handler - Click handler should have keyboard equivalent'
      ]
      const indexHtmlErrors = [
        '🔴 Line 1: color-contrast - Element has insufficient color contrast',
        '🔴 Line 1: aria-label - Element should have aria-label'
      ]

      assert.isTrue(
        summaryStub.addList.calledWith(appJsErrors),
        'Should add app.js errors to list'
      )
      assert.isTrue(
        summaryStub.addList.calledWith(indexHtmlErrors),
        'Should add index.html errors to list'
      )

      // Verify footer
      assert.isTrue(
        summaryStub.addRaw.calledWith('Found 3 accessibility issues'),
        'Should add correct error count to summary'
      )

      // Verify GitHub annotations
      assert.equal(
        errorStub.callCount,
        3,
        'Should create three error annotations'
      )
      assert.isTrue(
        errorStub.calledWith(
          'app.js:1 - click-handler - Click handler should have keyboard equivalent',
          {
            file: 'app.js',
            startLine: 1,
            startColumn: 1,
            endColumn: 10,
            title: 'Axe Linter'
          }
        ),
        'Should create correct annotation for app.js'
      )
    })

    it('should handle no errors in summary', async () => {
      const files = ['clean.js']
      const apiKey = 'test-key'
      const axeLinterUrl = 'https://test-linter.com'
      const linterConfig = {}

      readFileStub.withArgs('clean.js', 'utf8').returns('const x = 1;')

      nock(axeLinterUrl)
        .post('/lint-source')
        .reply(200, {
          report: {
            errors: []
          }
        })

      const errorCount = await lintFiles(
        files,
        apiKey,
        axeLinterUrl,
        linterConfig
      )

      assert.equal(errorCount, 0, 'Should return zero errors')
      assert.isTrue(
        summaryStub.addHeading.calledWith('Accessibility Linting Results'),
        'Should still create summary heading'
      )
      assert.isTrue(
        summaryStub.addRaw.calledWith('Found 0 accessibility issues'),
        'Should show zero issues in summary'
      )
      assert.isFalse(
        errorStub.called,
        'Should not create any error annotations'
      )
    })
  })
})
