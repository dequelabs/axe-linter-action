import { assert } from 'chai'
import sinon from 'sinon'
import * as github from '@actions/github'
import * as core from '@actions/core'
import { getChangedFiles } from './git'

describe('git', () => {
  let sandbox: sinon.SinonSandbox
  let mockOctokit: any
  let mockContext: any
  let githubStub: sinon.SinonStub
  let debugStub: sinon.SinonStub

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    debugStub = sandbox.stub(core, 'debug')

    // Mock Octokit responses
    mockOctokit = {
      rest: {
        repos: {
          compareCommits: sandbox.stub()
        },
        pulls: {
          listFiles: sandbox.stub()
        }
      }
    }

    // Mock GitHub context
    mockContext = {
      repo: {
        owner: 'test-owner',
        repo: 'test-repo'
      },
      payload: {}
    }

    // Stub GitHub getOctokit
    githubStub = sandbox.stub(github, 'getOctokit').returns(mockOctokit)
    sandbox.stub(github, 'context').value(mockContext)
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('getChangedFiles', () => {
    const token = 'test-token'

    it('should handle pull request files', async () => {
      // Setup pull request context
      mockContext.payload.pull_request = { number: 123 }

      const mockFiles = [
        { filename: 'test.js' },
        { filename: 'test.md' },
        { filename: 'test.css' }, // Should be filtered out
        { filename: 'test.tsx' }
      ]

      mockOctokit.rest.pulls.listFiles.resolves({
        data: mockFiles
      })

      const result = await getChangedFiles(token)

      assert.isTrue(
        githubStub.calledWith(token),
        'getOctokit should be called with correct token'
      )
      assert.isTrue(
        mockOctokit.rest.pulls.listFiles.calledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          pull_number: 123
        }),
        'listFiles should be called with correct parameters'
      )

      assert.deepEqual(
        result,
        ['test.js', 'test.md', 'test.tsx'],
        'should return correct filtered files'
      )
    })

    it('should handle push event files', async () => {
      // Setup push context
      mockContext.payload.before = 'old-sha'
      mockContext.payload.after = 'new-sha'

      const mockFiles = [
        { filename: 'test.jsx' },
        { filename: 'test.vue' },
        { filename: 'test.py' }, // Should be filtered out
        { filename: 'test.html' }
      ]

      mockOctokit.rest.repos.compareCommits.resolves({
        data: {
          files: mockFiles
        }
      })

      const result = await getChangedFiles(token)

      assert.isTrue(
        githubStub.calledWith(token),
        'getOctokit should be called with correct token'
      )
      assert.isTrue(
        mockOctokit.rest.repos.compareCommits.calledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          base: 'old-sha',
          head: 'new-sha'
        }),
        'compareCommits should be called with correct parameters'
      )

      assert.deepEqual(
        result,
        ['test.jsx', 'test.vue', 'test.html'],
        'should return correct filtered files'
      )
      assert.isTrue(
        debugStub.calledWith('Not a pull request, checking push diff'),
        'should log debug message'
      )
    })

    it('should handle empty file lists', async () => {
      mockContext.payload.pull_request = { number: 123 }

      mockOctokit.rest.pulls.listFiles.resolves({
        data: []
      })

      const result = await getChangedFiles(token)

      assert.isArray(result, 'should return an array')
      assert.isEmpty(result, 'should return empty array')
    })

    it('should handle undefined files in compare commits response', async () => {
      mockContext.payload.before = 'old-sha'
      mockContext.payload.after = 'new-sha'

      mockOctokit.rest.repos.compareCommits.resolves({
        data: {
          files: undefined
        }
      })

      const result = await getChangedFiles(token)

      assert.isArray(result, 'should return an array')
      assert.isEmpty(result, 'should return empty array')
    })

    it('should filter out unsupported file types', async () => {
      mockContext.payload.pull_request = { number: 123 }

      const mockFiles = [
        { filename: 'test.cpp' },
        { filename: 'test.py' },
        { filename: 'test.rb' }
      ]

      mockOctokit.rest.pulls.listFiles.resolves({
        data: mockFiles
      })

      const result = await getChangedFiles(token)

      assert.isArray(result, 'should return an array')
      assert.isEmpty(result, 'should return empty array')
      assert.lengthOf(result, 0, 'should have no matching files')
    })

    it('should throw an error when API call fails', async () => {
      mockContext.payload.pull_request = { number: 123 }

      const error = new Error('API Error')
      mockOctokit.rest.pulls.listFiles.rejects(error)

      try {
        await getChangedFiles(token)
        assert.fail('should have thrown an error')
      } catch (err) {
        assert.strictEqual(err, error, 'should throw the original error')
      }
    })
  })
})
