import assert from 'node:assert/strict'
import { pluralize } from './utils.ts'

describe('pluralize', () => {
  it('should return the plural form of a word', () => {
    assert.equal(pluralize(1), '')
    assert.equal(pluralize(2), 's')
  })
})
