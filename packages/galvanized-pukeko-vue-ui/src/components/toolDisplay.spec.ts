import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import {
  registerToolDisplay,
  registerToolDisplays,
  getToolDisplay,
  hasToolDisplay,
  resetToolDisplays,
  toolDisplayLabel,
} from './toolDisplay'

const Dummy = defineComponent({ setup: () => () => h('div') })

describe('tool-display registry (PLAT-17)', () => {
  beforeEach(() => resetToolDisplays())

  it('returns undefined for an unregistered tool', () => {
    expect(getToolDisplay('nope')).toBeUndefined()
    expect(hasToolDisplay('nope')).toBe(false)
  })

  it('registers and looks up an entry by tool name', () => {
    registerToolDisplay('capture_image', { glyph: '📷', renderResult: Dummy })
    expect(hasToolDisplay('capture_image')).toBe(true)
    const entry = getToolDisplay('capture_image')
    expect(entry?.glyph).toBe('📷')
    expect(entry?.renderResult).toBe(Dummy)
  })

  it('re-registering the same name replaces the entry', () => {
    registerToolDisplay('t', { glyph: 'a' })
    registerToolDisplay('t', { glyph: 'b' })
    expect(getToolDisplay('t')?.glyph).toBe('b')
  })

  it('returns an unregister function that removes the entry', () => {
    const undo = registerToolDisplay('t', { glyph: 'a' })
    undo()
    expect(hasToolDisplay('t')).toBe(false)
  })

  it('unregister does not clobber a newer registration of the same name', () => {
    const undo = registerToolDisplay('t', { glyph: 'a' })
    registerToolDisplay('t', { glyph: 'b' }) // supersedes
    undo() // must be a no-op now
    expect(getToolDisplay('t')?.glyph).toBe('b')
  })

  it('registerToolDisplays registers several and unregisters all', () => {
    const undo = registerToolDisplays({ a: { glyph: '1' }, b: { glyph: '2' } })
    expect(hasToolDisplay('a')).toBe(true)
    expect(hasToolDisplay('b')).toBe(true)
    undo()
    expect(hasToolDisplay('a')).toBe(false)
    expect(hasToolDisplay('b')).toBe(false)
  })

  describe('toolDisplayLabel', () => {
    it('defaults to "Used <name> tool" with no entry', () => {
      expect(toolDisplayLabel('search')).toBe('Used search tool')
    })
    it('uses a string label override', () => {
      expect(toolDisplayLabel('search', { label: 'Searched' })).toBe('Searched')
    })
    it('uses a function label override', () => {
      expect(toolDisplayLabel('search', { label: (n) => `ran ${n}` })).toBe('ran search')
    })
  })
})
