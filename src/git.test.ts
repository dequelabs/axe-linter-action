import 'mocha'
import assert from 'node:assert/strict'
import sinon from 'sinon'
import * as github from '@actions/github'
import * as core from '@actions/core'
import { getChangedFiles } from './git'

describe('git', () => {
  const token = 'test-token'
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

      assert.strictEqual(
        githubStub.calledWith(token),
        true,
        'getOctokit should be called with correct token'
      )
      assert.strictEqual(
        mockOctokit.rest.pulls.listFiles.calledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          pull_number: 123
        }),
        true,
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

      assert.strictEqual(
        githubStub.calledWith(token),
        true,
        'getOctokit should be called with correct token'
      )
      assert.strictEqual(
        mockOctokit.rest.repos.compareCommits.calledWith({
          owner: 'test-owner',
          repo: 'test-repo',
          base: 'old-sha',
          head: 'new-sha'
        }),
        true,
        'compareCommits should be called with correct parameters'
      )

      assert.deepEqual(
        result,
        ['test.jsx', 'test.vue', 'test.html'],
        'should return correct filtered files'
      )
      assert.strictEqual(
        debugStub.calledWith('Not a pull request, checking push diff'),
        true,
        'should log debug message'
      )
    })

    it('should handle empty file lists', async () => {
      mockContext.payload.pull_request = { number: 123 }

      mockOctokit.rest.pulls.listFiles.resolves({
        data: []
      })

      const result = await getChangedFiles(token)

      assert.ok(Array.isArray(result), 'should return an array')
      assert.strictEqual(result.length, 0, 'should return empty array')
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

      assert.ok(Array.isArray(result), 'should return an array')
      assert.strictEqual(result.length, 0, 'should return empty array')
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

      assert.ok(Array.isArray(result), 'should return an array')
      assert.strictEqual(result.length, 0, 'should return empty array')
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

    it('should exclude deleted files in pull request', async () => {
      mockContext.payload.pull_request = { number: 123 }

      const mockFiles = [
        { filename: 'test.js', status: 'added' },
        { filename: 'removed.js', status: 'removed' },
        { filename: 'modified.jsx', status: 'modified' },
        { filename: 'deleted.md', status: 'removed' },
        { filename: 'test.tsx', status: 'added' }
      ]

      mockOctokit.rest.pulls.listFiles.resolves({
        data: mockFiles
      })

      const result = await getChangedFiles(token)

      assert.deepEqual(result, ['test.js', 'modified.jsx', 'test.tsx'])
      assert.ok(!result.includes('removed.js'))
      assert.ok(!result.includes('deleted.md'))
    })

    it('should exclude deleted files in push event', async () => {
      mockContext.payload.before = 'old-sha'
      mockContext.payload.after = 'new-sha'

      const mockFiles = [
        { filename: 'test.vue', status: 'added' },
        { filename: 'deleted.js', status: 'removed' },
        { filename: 'test.html', status: 'modified' },
        { filename: 'removed.md', status: 'removed' }
      ]

      mockOctokit.rest.repos.compareCommits.resolves({
        data: {
          files: mockFiles
        }
      })

      const result = await getChangedFiles(token)

      assert.deepEqual(result, ['test.vue', 'test.html'])
      assert.ok(!result.includes('deleted.js'))
      assert.ok(!result.includes('removed.md'))
      assert.strictEqual(
        debugStub.calledWith('Not a pull request, checking push diff'),
        true
      )
    })

    it('should handle files with different statuses', async () => {
      mockContext.payload.pull_request = { number: 123 }

      const mockFiles = [
        { filename: 'test1.js', status: 'added' },
        { filename: 'test2.js', status: 'modified' },
        { filename: 'test3.js', status: 'renamed' },
        { filename: 'test4.js', status: 'removed' },
        { filename: 'test5.js', status: 'changed' }
      ]

      mockOctokit.rest.pulls.listFiles.resolves({
        data: mockFiles
      })

      const result = await getChangedFiles(token)

      assert.deepEqual(result, ['test1.js', 'test2.js', 'test3.js', 'test5.js'])
      assert.ok(!result.includes('test4.js'))
    })
  })
  describe('file pattern matching', () => {
    it('should match JavaScript files correctly', async () => {
      const mockFiles = [
        { filename: 'src/app.js', status: 'added' },
        { filename: 'test/test.js', status: 'modified' },
        { filename: 'src/components/Button.jsx', status: 'added' },
        { filename: 'src/utils/helper.esm', status: 'modified' },
        { filename: 'src/types.ts', status: 'added' }, // Should not match
        { filename: 'src/styles.css', status: 'modified' } // Should not match
      ]

      mockOctokit.rest.repos.compareCommits.resolves({
        data: {
          files: mockFiles
        }
      })

      const result = await getChangedFiles(token)

      for (const file of [
        'src/app.js',
        'test/test.js',
        'src/components/Button.jsx',
        'src/utils/helper.esm'
      ]) {
        assert.ok(result.includes(file), `expected result to include "${file}"`)
      }
      assert.ok(!result.includes('src/types.ts'))
      assert.ok(!result.includes('src/styles.css'))
    })

    it('should match HTML files correctly', async () => {
      const mockFiles = [
        { filename: 'index.html', status: 'modified' },
        { filename: 'public/about.htm', status: 'added' },
        { filename: 'templates/page.html', status: 'modified' },
        { filename: 'templates/page.liquid', status: 'added' },
        { filename: 'docs/readme.txt', status: 'added' }, // Should not match
        { filename: 'styles/main.css', status: 'modified' } // Should not match
      ]

      mockOctokit.rest.repos.compareCommits.resolves({
        data: {
          files: mockFiles
        }
      })

      const result = await getChangedFiles(token)

      for (const file of [
        'index.html',
        'public/about.htm',
        'templates/page.html',
        'templates/page.liquid'
      ]) {
        assert.ok(result.includes(file), `expected result to include "${file}"`)
      }
      assert.ok(!result.includes('docs/readme.txt'))
      assert.ok(!result.includes('styles/main.css'))
    })

    it('should handle case insensitive matching', async () => {
      const mockFiles = [
        { filename: 'src/App.JS', status: 'added' },
        { filename: 'src/Component.JSX', status: 'modified' },
        { filename: 'docs/README.MD', status: 'added' },
        { filename: 'docs/test.MaRkDoWn', status: 'added' },
        { filename: 'public/INDEX.HTML', status: 'modified' },
        { filename: 'src/Test.VUE', status: 'added' },
        { filename: 'templates/page.LIQUID', status: 'added' }
      ]

      mockOctokit.rest.repos.compareCommits.resolves({
        data: {
          files: mockFiles
        }
      })

      const result = await getChangedFiles(token)

      for (const file of [
        'src/App.JS',
        'src/Component.JSX',
        'docs/README.MD',
        'docs/test.MaRkDoWn',
        'public/INDEX.HTML',
        'src/Test.VUE',
        'templates/page.LIQUID'
      ]) {
        assert.ok(result.includes(file), `expected result to include "${file}"`)
      }
    })

    it('should handle nested paths correctly', async () => {
      const mockFiles = [
        { filename: 'deeply/nested/path/component.jsx', status: 'added' },
        { filename: 'very/deep/structure/util.js', status: 'modified' },
        { filename: 'nested/docs/guide.md', status: 'added' },
        { filename: 'a/b/c/d/e/f/page.html', status: 'modified' },
        { filename: 'deep/path/app.vue', status: 'added' }
      ]

      mockOctokit.rest.repos.compareCommits.resolves({
        data: {
          files: mockFiles
        }
      })

      const result = await getChangedFiles(token)

      for (const file of [
        'deeply/nested/path/component.jsx',
        'very/deep/structure/util.js',
        'nested/docs/guide.md',
        'a/b/c/d/e/f/page.html',
        'deep/path/app.vue'
      ]) {
        assert.ok(result.includes(file), `expected result to include "${file}"`)
      }
    })

    it('should handle files without extensions correctly', async () => {
      const mockFiles = [
        { filename: 'README', status: 'modified' }, // Should not match
        { filename: 'LICENSE', status: 'added' }, // Should not match
        { filename: 'docs/markdown', status: 'modified' }, // Should not match
        { filename: 'test.html', status: 'added' }, // Should match
        { filename: 'test.', status: 'modified' } // Should not match
      ]

      mockOctokit.rest.repos.compareCommits.resolves({
        data: {
          files: mockFiles
        }
      })

      const result = await getChangedFiles(token)

      for (const file of ['test.html']) {
        assert.ok(result.includes(file), `expected result to include "${file}"`)
      }
      assert.ok(!result.includes('README'))
      assert.ok(!result.includes('LICENSE'))
      assert.ok(!result.includes('docs/markdown'))
      assert.ok(!result.includes('test.'))
    })

    it('should exclude dotfiles', async () => {
      const mockFiles = [
        { filename: '.eslintrc.js', status: 'modified' },
        { filename: '.prettierrc.js', status: 'added' },
        { filename: 'src/app.js', status: 'added' }
      ]

      mockOctokit.rest.repos.compareCommits.resolves({
        data: { files: mockFiles }
      })

      const result = await getChangedFiles(token)

      assert.deepEqual(result, ['src/app.js'])
    })

    it('should exclude files under dot-directories', async () => {
      const mockFiles = [
        { filename: '.github/README.md', status: 'modified' },
        { filename: '.github/workflows/ci.html', status: 'added' },
        { filename: 'src/.hidden/utils.js', status: 'added' },
        { filename: 'docs/guide.md', status: 'added' }
      ]

      mockOctokit.rest.repos.compareCommits.resolves({
        data: { files: mockFiles }
      })

      const result = await getChangedFiles(token)

      assert.deepEqual(result, ['docs/guide.md'])
    })

    it('should handle push event diff correctly', async () => {
      // Setup push event context
      mockContext.payload = {
        before: 'old-sha',
        after: 'new-sha'
      }

      const mockFiles = [
        { filename: 'src/app.js', status: 'added' },
        { filename: 'test/test.jsx', status: 'modified' }
      ]

      // Setup compareCommits response
      mockOctokit.rest.repos = {
        compareCommits: sandbox.stub().resolves({
          data: {
            files: mockFiles
          }
        })
      }

      const result = await getChangedFiles(token)

      for (const file of ['src/app.js', 'test/test.jsx']) {
        assert.ok(result.includes(file), `expected result to include "${file}"`)
      }
    })
  })
})
