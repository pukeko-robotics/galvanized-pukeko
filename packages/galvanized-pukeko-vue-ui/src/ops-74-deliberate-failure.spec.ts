import { describe, expect, it } from 'vitest'

// OPS-74 acceptance probe. A deliberately failing assertion, so that the new
// push and pull_request triggers can be observed actually running the unit
// suites rather than merely looking correct in the YAML. This file exists only
// on a throwaway scratch branch and is deleted along with it.
describe('OPS-74 deliberate failure', () => {
  it('fails on purpose so the new trigger can be watched going red', () => {
    expect(1).toBe(2)
  })
})
