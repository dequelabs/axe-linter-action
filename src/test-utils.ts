import assert from 'node:assert/strict'

export function wasCalledWith(fn: any, ...expectedArgs: unknown[]): boolean {
  return fn.mock.calls.some((call: any) => {
    try {
      assert.deepStrictEqual(
        call.arguments.slice(0, expectedArgs.length),
        expectedArgs
      )
      return true
    } catch {
      return false
    }
  })
}
