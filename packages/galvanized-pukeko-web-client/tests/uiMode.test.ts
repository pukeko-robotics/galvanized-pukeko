import { describe, it, expect } from 'vitest'
import { resolveMode } from '../src/uiMode'

// PLAT-12: the no-query default flipped from bespoke to headless. `resolveMode`
// is the pure query-string → UiMode mapper extracted from main.ts (main.ts runs
// init() at import, so the mapping is unit-tested here, not via importing main).
describe('resolveMode (PLAT-12 default = headless)', () => {
  it('resolves the no-?ui default to headless', () => {
    expect(resolveMode('')).toBe('headless')
    expect(resolveMode('?foo=bar')).toBe('headless')
  })

  it('resolves each explicit ?ui= value to itself', () => {
    expect(resolveMode('?ui=bespoke')).toBe('bespoke')
    expect(resolveMode('?ui=stock')).toBe('stock')
    expect(resolveMode('?ui=headless')).toBe('headless')
  })

  it('falls back to headless for an unknown ?ui= value', () => {
    expect(resolveMode('?ui=nonsense')).toBe('headless')
    expect(resolveMode('?ui=')).toBe('headless')
  })
})
