import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher
} from 'undici'
import type { LinterResponse } from './types.ts'

// Shared mutable state
let errorCalls: any[][]
let debugCalls: any[][]
let readFileMock: (path: string, encoding: string) => string

mock.module('@actions/core', {
  namedExports: {
    error: (...args: any[]) => {
      errorCalls.push(args)
    },
    debug: (...args: any[]) => {
      debugCalls.push(args)
    },
    info: () => {},
    startGroup: () => {},
    endGroup: () => {}
  }
})

mock.module('fs', {
  namedExports: {
    readFileSync: (path: string, encoding: string) =>
      readFileMock(path, encoding)
  }
})

const { lintFiles } = await import('./linter.ts')

describe('linter', () => {
  let mockAgent: MockAgent
  let originalDispatcher: Dispatcher

  beforeEach(() => {
    errorCalls = []
    debugCalls = []
    readFileMock = () => {
      throw new Error('Unexpected readFileSync call')
    }

    originalDispatcher = getGlobalDispatcher()
    mockAgent = new MockAgent()
    mockAgent.disableNetConnect()
    setGlobalDispatcher(mockAgent)
  })

  afterEach(async () => {
    await mockAgent.close()
    setGlobalDispatcher(originalDispatcher)
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

      readFileMock = (path: string) => {
        if (fileContents[path]) return fileContents[path]
        throw new Error(`Unexpected file: ${path}`)
      }

      const mockResponses: Record<string, LinterResponse> = {
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

      const pool = mockAgent.get(axeLinterUrl)
      for (const file of files) {
        pool
          .intercept({
            path: '/lint-source',
            method: 'POST'
          })
          .reply(200, mockResponses[file], {
            headers: { 'content-type': 'application/json' }
          })
      }

      const errorCount = await lintFiles(
        files,
        apiKey,
        axeLinterUrl,
        linterConfig
      )

      assert.strictEqual(errorCount, 2)
      assert.strictEqual(errorCalls.length, 2)

      // Verify first error
      assert.strictEqual(
        errorCalls[0][0],
        'test.js:1 - test-rule-1 - Test error 1\nhttps://test-help-url-1.com'
      )
      assert.deepStrictEqual(errorCalls[0][1], {
        file: 'test.js',
        startLine: 1,
        startColumn: 1,
        endColumn: 10,
        title: 'Axe Linter'
      })

      // Verify second error
      assert.strictEqual(
        errorCalls[1][0],
        'test.html:1 - test-rule-2 - Test error 2\nhttps://test-help-url-2.com'
      )
      assert.deepStrictEqual(errorCalls[1][1], {
        file: 'test.html',
        startLine: 1,
        startColumn: 1,
        endColumn: 15,
        title: 'Axe Linter'
      })
    })

    it('should handle a single file', async () => {
      const files = ['test.js']
      readFileMock = () => '<div>test</div>'

      const pool = mockAgent.get(axeLinterUrl)
      pool
        .intercept({
          path: '/lint-source',
          method: 'POST'
        })
        .reply(
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

      assert.strictEqual(errorCount, 1)
      // Interceptor was consumed (no pending interceptors)
      mockAgent.assertNoPendingInterceptors()
    })

    it('should skip empty files', async () => {
      const files = ['empty.js']
      readFileMock = () => '   '

      // Set up an interceptor that should NOT be consumed
      const pool = mockAgent.get(axeLinterUrl)
      pool
        .intercept({
          path: '/lint-source',
          method: 'POST'
        })
        .reply(200, {})

      const errorCount = await lintFiles(
        files,
        apiKey,
        axeLinterUrl,
        linterConfig
      )

      assert.strictEqual(errorCount, 0)
      assert.ok(debugCalls.some((c) => c[0] === 'Skipping empty file empty.js'))
      // Interceptor should NOT have been consumed
      assert.strictEqual(mockAgent.pendingInterceptors().length, 1)
    })

    it('should handle linter API errors', async () => {
      const files = ['error.js']
      readFileMock = () => '<div><h1>hello world</h1></div>'

      const pool = mockAgent.get(axeLinterUrl)
      pool
        .intercept({
          path: '/lint-source',
          method: 'POST'
        })
        .reply(
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
        assert.strictEqual(error.message, 'API Error')
      }
    })

    it('should handle file read errors', async () => {
      const files = ['nonexistent.js']
      readFileMock = () => {
        throw new Error('ENOENT')
      }

      // Set up interceptor that should NOT be consumed
      const pool = mockAgent.get(axeLinterUrl)
      pool
        .intercept({
          path: '/lint-source',
          method: 'POST'
        })
        .reply(200, {})

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.ok(error instanceof Error)
        assert.strictEqual(error.message, 'ENOENT')
        // Interceptor should NOT have been consumed
        assert.strictEqual(mockAgent.pendingInterceptors().length, 1)
      }
    })

    it('should handle network errors', async () => {
      const files = ['test.js']
      readFileMock = () => '<div><h1>hello world</h1></div>'

      const pool = mockAgent.get(axeLinterUrl)
      pool
        .intercept({
          path: '/lint-source',
          method: 'POST'
        })
        .replyWithError(new Error('Network Error'))

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.ok(error instanceof Error)
      }
    })

    it('should handle HTTP errors', async () => {
      const files = ['test.js']
      readFileMock = () => '<div><h1>hello world</h1></div>'

      const pool = mockAgent.get(axeLinterUrl)
      pool
        .intercept({
          path: '/lint-source',
          method: 'POST'
        })
        .reply(500, 'Internal Server Error')

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('should have thrown an error')
      } catch (error) {
        assert.ok(error instanceof Error)
      }
    })

    it('should handle malformed API responses', async () => {
      const files = ['test.js']
      readFileMock = () => '<div><h1>hello world</h1></div>'

      const pool = mockAgent.get(axeLinterUrl)
      pool
        .intercept({
          path: '/lint-source',
          method: 'POST'
        })
        .reply(
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
      }
    })

    it('should rethrow non-Error objects', async () => {
      const files = ['test.js']
      readFileMock = () => '<div><h1>hello world</h1></div>'

      const nonErrorObject = {
        type: 'CustomError',
        details: 'Something went wrong',
        statusCode: 500
      }

      mock.method(globalThis, 'fetch', async () => {
        throw nonErrorObject
      })

      try {
        await lintFiles(files, apiKey, axeLinterUrl, linterConfig)
        assert.fail('Should have thrown an error')
      } catch (error: any) {
        assert.strictEqual(error instanceof Error, false)
        assert.deepStrictEqual(error, nonErrorObject)
        assert.strictEqual(error.type, 'CustomError')
        assert.strictEqual(error.details, 'Something went wrong')
        assert.strictEqual(error.statusCode, 500)
      }
    })

    it('should handle invalid linter config errors from server', async () => {
      const files = ['test.js']
      const invalidLinterConfig = {
        rules: { 'invalid-rule': 'invalid-value' }
      }

      readFileMock = () => 'const x = 1;'

      const pool = mockAgent.get(axeLinterUrl)
      pool
        .intercept({
          path: '/lint-source',
          method: 'POST'
        })
        .replyWithError(new Error('Invalid config'))

      try {
        await lintFiles(files, apiKey, axeLinterUrl, invalidLinterConfig)
        assert.fail('Should have thrown an error')
      } catch (error) {
        assert.ok(error instanceof Error || typeof error === 'object')
      }
    })
  })
})
