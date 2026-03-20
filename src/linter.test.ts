import assert from 'node:assert/strict'
import sinon from 'sinon'
import esmock from 'esmock'
import { MockAgent, setGlobalDispatcher, type Interceptable } from 'undici'
import type { LinterResponse } from './types.ts'

type MockResponses = Record<string, LinterResponse>

describe('linter', () => {
  let sandbox: sinon.SinonSandbox
  let errorStub: sinon.SinonStub
  let debugStub: sinon.SinonStub
  let readFileStub: sinon.SinonStub
  let lintFiles: typeof import('./linter.ts').lintFiles

  describe('lintFiles', () => {
    const apiKey = 'test-api-key'
    const axeLinterUrl = 'https://test-linter.com'
    const linterConfig = { rules: { 'test-rule': 'error' } }

    let mockAgent: MockAgent
    let mockPool: Interceptable

    beforeEach(async () => {
      sandbox = sinon.createSandbox()

      // Stub core functions
      errorStub = sandbox.stub()
      debugStub = sandbox.stub()

      // Stub file system
      readFileStub = sandbox.stub()

      const linterModule = await esmock('./linter.ts', {
        '@actions/core': {
          error: errorStub,
          debug: debugStub,
          info: sandbox.stub(),
          startGroup: sandbox.stub(),
          endGroup: sandbox.stub()
        },
        fs: { readFileSync: readFileStub }
      })
      lintFiles = linterModule.lintFiles

      // Enable mock agent
      mockAgent = new MockAgent()
      setGlobalDispatcher(mockAgent)
      mockAgent.disableNetConnect()
      mockPool = mockAgent.get(axeLinterUrl)
    })

    afterEach(async () => {
      sandbox.restore()
      await mockAgent.close()
    })

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
                description: 'Test error 1',
                helpURL: 'https://test-help-url-1.com'
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
                description: 'Test error 2',
                helpURL: 'https://test-help-url-2.com'
              }
            ]
          }
        }
      }

      // Setup interceptors for each file
      files.forEach((file) => {
        mockPool
          .intercept({
            path: '/lint-source',
            method: 'POST',
            body: JSON.stringify({
              source: fileContents[file],
              filename: file,
              config: linterConfig
            }),
            headers: {
              authorization: apiKey,
              'content-type': 'application/json'
            }
          })
          .reply(200, mockResponses[file], {
            headers: { 'content-type': 'application/json' }
          })
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
      assert.strictEqual(
        errorStub.calledWith(
          'test.js:1 - test-rule-1 - Test error 1\nhttps://test-help-url-1.com',
          {
            file: 'test.js',
            startLine: 1,
            startColumn: 1,
            endColumn: 10,
            title: 'Axe Linter'
          }
        ),
        true,
        'should report first error correctly'
      )

      assert.strictEqual(
        errorStub.calledWith(
          'test.html:1 - test-rule-2 - Test error 2\nhttps://test-help-url-2.com',
          {
            file: 'test.html',
            startLine: 1,
            startColumn: 1,
            endColumn: 15,
            title: 'Axe Linter'
          }
        ),
        true,
        'should report second error correctly'
      )
    })

    it('should handle a single file', async () => {
      const files = ['test.js']
      const fileContents = { 'test.js': '<div>test</div>' }

      readFileStub.withArgs('test.js', 'utf8').returns(fileContents['test.js'])

      mockPool.intercept({ path: '/lint-source', method: 'POST' }).reply(
        200,
        {
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
        { headers: { 'content-type': 'application/json' } }
      )

      const errorCount = await lintFiles(
        files,
        apiKey,
        axeLinterUrl,
        linterConfig
      )

      assert.equal(errorCount, 1, 'should return one error for single file')
      mockAgent.assertNoPendingInterceptors()
    })

    it('should skip empty files', async () => {
      const files = ['empty.js']
      readFileStub.withArgs('empty.js', 'utf8').returns('   ')

      mockPool
        .intercept({ path: '/lint-source', method: 'POST' })
        .reply(200, {})

      const errorCount = await lintFiles(
        files,
        apiKey,
        axeLinterUrl,
        linterConfig
      )

      assert.equal(errorCount, 0, 'should return zero errors for empty files')
      assert.strictEqual(
        debugStub.calledWith('Skipping empty file empty.js'),
        true,
        'should log debug message'
      )
      assert.ok(
        mockAgent.pendingInterceptors().length > 0,
        'no HTTP requests should be made'
      )
    })

    it('should handle linter API errors', async () => {
      const files = ['error.js']
      readFileStub
        .withArgs('error.js', 'utf8')
        .returns('<div><h1>hello world</h1></div>')

      mockPool.intercept({ path: '/lint-source', method: 'POST' }).reply(
        200,
        { error: 'API Error' },
        {
          headers: { 'content-type': 'application/json' }
        }
      )

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.ok(error instanceof Error)
        assert.equal(error.message, 'API Error')
        mockAgent.assertNoPendingInterceptors()
      }
    })

    it('should handle file read errors', async () => {
      const files = ['nonexistent.js']
      const fileError = new Error('ENOENT')
      readFileStub.throws(fileError)

      mockPool
        .intercept({ path: '/lint-source', method: 'POST' })
        .reply(200, {})

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.ok(error instanceof Error)
        assert.equal(error.message, 'ENOENT')
        assert.ok(
          mockAgent.pendingInterceptors().length > 0,
          'no HTTP requests should be made'
        )
      }
    })

    it('should handle network errors', async () => {
      const files = ['test.js']
      readFileStub
        .withArgs('test.js', 'utf8')
        .returns('<div><h1>hello world</h1></div>')

      mockPool
        .intercept({ path: '/lint-source', method: 'POST' })
        .replyWithError(new Error('Network Error'))

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.ok(error instanceof TypeError)
        assert.equal(error.message, 'fetch failed')
        const cause = (error as any).cause
        assert.ok(cause instanceof Error)
        assert.equal(cause.message, 'Network Error')
      }
    })

    it('should handle HTTP errors', async () => {
      const files = ['test.js']
      readFileStub
        .withArgs('test.js', 'utf8')
        .returns('<div><h1>hello world</h1></div>')

      mockPool
        .intercept({ path: '/lint-source', method: 'POST' })
        .reply(500, 'Internal Server Error')

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.ok(error instanceof Error)
        mockAgent.assertNoPendingInterceptors()
      }
    })

    it('should handle malformed API responses', async () => {
      const files = ['test.js']
      readFileStub
        .withArgs('test.js', 'utf8')
        .returns('<div><h1>hello world</h1></div>')

      mockPool.intercept({ path: '/lint-source', method: 'POST' }).reply(
        200,
        { report: 'invalid-format' },
        {
          headers: { 'content-type': 'application/json' }
        }
      )

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.ok(error instanceof Error)
        mockAgent.assertNoPendingInterceptors()
      }
    })

    it('should rethrow non-Error objects', async () => {
      const files = ['test.js']

      readFileStub
        .withArgs('test.js', 'utf8')
        .returns('<div><h1>hello world</h1></div>')

      // Make fetch throw a non-Error object
      const nonErrorObject = {
        type: 'CustomError',
        details: 'Something went wrong',
        statusCode: 500
      }

      const fetchStub = sandbox.stub(globalThis, 'fetch')
      fetchStub.rejects(nonErrorObject)

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('Should have thrown an error')
      } catch (error) {
        // Verify that the caught error is our non-Error object
        assert.strictEqual(
          error instanceof Error,
          false,
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

      // Setup interceptor to simulate connection error
      mockPool
        .intercept({
          path: '/lint-source',
          method: 'POST',
          body: JSON.stringify({
            source: 'const x = 1;',
            filename: 'test.js',
            config: invalidLinterConfig
          }),
          headers: {
            'content-type': 'application/json',
            authorization: apiKey
          }
        })
        .replyWithError(new Error('Invalid config'))

      try {
        await lintFiles(files, apiKey, axeLinterUrl, invalidLinterConfig)
        assert.fail('Should have thrown an error')
      } catch (error) {
        assert.ok(error instanceof TypeError)
        assert.equal(error.message, 'fetch failed')
        const cause = (error as any).cause
        assert.ok(cause instanceof Error)
        assert.equal(cause.message, 'Invalid config')
      }
    })
  })
})
