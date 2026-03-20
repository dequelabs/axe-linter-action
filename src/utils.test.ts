import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pluralize } from './utils.ts'

describe('pluralize', () => {
  it('should return the plural form of a word', () => {
    assert.strictEqual(pluralize(1), '')
    assert.strictEqual(pluralize(2), 's')
  })
})
