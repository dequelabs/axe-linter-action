import 'mocha'
import { assert } from 'chai'
import { pluralize } from './utils'

describe('pluralize', () => {
  it('should return the plural form of a word', () => {
    assert.equal(pluralize(1), '')
    assert.equal(pluralize(2), 's')
  })
})
