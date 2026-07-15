/// <reference types="node" />
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  applyTheme,
  resetTheme,
  defaultTheme,
  PK_COLOR_TOKENS,
  type PkTheme,
  type PkColorToken,
} from './theme'
// SFC source via Vite's `?raw`; global.css via fs (Vitest returns "" for
// `.css?raw`, and its cwd is the package root). The scoped <style> of a .vue
// file is NOT injected into jsdom, and jsdom never resolves `var()` in computed
// style, so the component-level assertions inspect the SFC source directly (the
// live-browser visual pass is the post-merge follow-up per the brief).
import chatInterfaceSrc from './components/ChatInterface.vue?raw'
import headlessChatSrc from './copilot/HeadlessChat.vue?raw'
import toolCallBadgeSrc from './components/ToolCallBadge.vue?raw'
import toolResultGenericSrc from './components/ToolResultGeneric.vue?raw'
const globalCss = readFileSync('src/assets/global.css', 'utf8')

const MIGRATED: Record<string, string> = {
  'ChatInterface.vue': chatInterfaceSrc,
  'HeadlessChat.vue': headlessChatSrc,
  'ToolCallBadge.vue': toolCallBadgeSrc,
  'ToolResultGeneric.vue': toolResultGenericSrc,
}

/** Every `var(--pk-color-X, <fallback>)` reference found in a source string. */
function tokenRefs(source: string): { token: string; fallback: string }[] {
  const re = /var\(\s*(--pk-color-[a-z-]+)\s*,\s*([^)]+?)\s*\)/g
  const out: { token: string; fallback: string }[] = []
  for (const m of source.matchAll(re)) out.push({ token: m[1], fallback: m[2].trim() })
  return out
}

afterEach(() => resetTheme())

describe('theme: token contract present with DL-8 defaults', () => {
  it('exposes the documented semantic tokens', () => {
    // Role-named tokens, not raw colours; families cover surface/text/primary/
    // danger/info/code per DL-8.
    expect(PK_COLOR_TOKENS).toContain('--pk-color-surface')
    expect(PK_COLOR_TOKENS).toContain('--pk-color-text')
    expect(PK_COLOR_TOKENS).toContain('--pk-color-primary')
    expect(PK_COLOR_TOKENS).toContain('--pk-color-danger')
    expect(PK_COLOR_TOKENS).toContain('--pk-color-border')
    expect(PK_COLOR_TOKENS).toContain('--pk-color-info-text')
    expect(PK_COLOR_TOKENS.length).toBe(Object.keys(defaultTheme).length)
  })

  it('default values are the DL-8 defaults (today’s shipped colours)', () => {
    expect(defaultTheme['--pk-color-primary']).toBe('#3b82f6') // accent / user bubble
    expect(defaultTheme['--pk-color-danger']).toBe('#d32f2f') // DL-8 error = red
    expect(defaultTheme['--pk-color-surface']).toBe('#fff')
    expect(defaultTheme['--pk-color-text']).toBe('#1f2937')
    expect(defaultTheme['--pk-color-info-text']).toBe('#1e40af') // DL-8 informational
  })

  it('global.css :root defines every token with the same default (CSS ↔ JS parity)', () => {
    for (const token of PK_COLOR_TOKENS) {
      const m = globalCss.match(new RegExp(`${token}:\\s*([^;]+);`))
      expect(m, `global.css should define ${token}`).toBeTruthy()
      expect(m![1].trim(), `global.css ${token} must match defaultTheme`).toBe(defaultTheme[token])
    }
  })
})

describe('theme: override applies', () => {
  it('applyTheme writes tokens as CSS variables on a target element', () => {
    const el = document.createElement('div')
    applyTheme({ '--pk-color-primary': '#059669', '--pk-color-link': '#047857' }, el)
    expect(el.style.getPropertyValue('--pk-color-primary')).toBe('#059669')
    expect(el.style.getPropertyValue('--pk-color-link')).toBe('#047857')
  })

  it('applyTheme defaults to :root and its undo restores the prior state', () => {
    expect(document.documentElement.style.getPropertyValue('--pk-color-primary')).toBe('')
    const undo = applyTheme({ '--pk-color-primary': '#059669' })
    expect(document.documentElement.style.getPropertyValue('--pk-color-primary')).toBe('#059669')
    undo()
    expect(document.documentElement.style.getPropertyValue('--pk-color-primary')).toBe('')
  })

  it('undo restores a previously-set value (stacked override), not just clears it', () => {
    const el = document.createElement('div')
    el.style.setProperty('--pk-color-primary', '#111') // a pre-existing override
    const undo = applyTheme({ '--pk-color-primary': '#059669' }, el)
    expect(el.style.getPropertyValue('--pk-color-primary')).toBe('#059669')
    undo()
    // the restore-prior branch: reverts to #111, does NOT remove the property
    expect(el.style.getPropertyValue('--pk-color-primary')).toBe('#111')
  })

  it('resetTheme removes every pk override, reverting to the stylesheet defaults', () => {
    const el = document.createElement('div')
    applyTheme({ '--pk-color-primary': '#059669', '--pk-color-danger': '#7c3aed' }, el)
    resetTheme(el)
    expect(el.style.getPropertyValue('--pk-color-primary')).toBe('')
    expect(el.style.getPropertyValue('--pk-color-danger')).toBe('')
  })
})

describe('theme: migrated components reference tokens (override wins over default)', () => {
  it('the primary chat surfaces reference the semantic tokens', () => {
    // ChatInterface user bubble is themed via the primary token, so an override
    // re-skins it; the tool-call badge uses the info family.
    expect(MIGRATED['ChatInterface.vue']).toContain('var(--pk-color-primary,')
    expect(MIGRATED['ChatInterface.vue']).toContain('var(--pk-color-danger,')
    expect(MIGRATED['HeadlessChat.vue']).toContain('var(--pk-color-primary,')
    expect(MIGRATED['ToolCallBadge.vue']).toContain('var(--pk-color-info-text,')
    expect(MIGRATED['ToolResultGeneric.vue']).toContain('var(--pk-color-code-text,')
  })

  it('every migrated component references at least one token', () => {
    for (const source of Object.values(MIGRATED)) expect(tokenRefs(source).length).toBeGreaterThan(0)
  })
})

describe('theme: default unchanged (no visual regression)', () => {
  it('every token reference falls back to exactly its DL-8 default colour', () => {
    // Internal lock-step check: whether a token resolves via global.css (default
    // theme) or via the CSS fallback (e.g. the /copilot bundle, which does not
    // ship global.css), both paths yield the SAME default colour. So every
    // `var(--pk-color-X, <fallback>)` must have <fallback> === the
    // defaultTheme['--pk-color-X'] value (which the contract test also asserts
    // equals the global.css :root value). NOTE: this proves fallback == default
    // == :root are consistent; it does NOT machine-prove equality to the
    // pre-PLAT-23 historical colours (only the 5 tokens spot-checked in the
    // contract test have a literal historical anchor here). Equality to the old
    // appearance rests on the reviewed migration diff and the post-merge
    // live-browser visual pass.
    let checked = 0
    for (const [f, source] of Object.entries(MIGRATED)) {
      for (const { token, fallback } of tokenRefs(source)) {
        expect(PK_COLOR_TOKENS, `${token} in ${f} is not a known token`).toContain(
          token as PkColorToken,
        )
        expect(fallback, `${token} fallback in ${f} must equal its default`).toBe(
          defaultTheme[token as PkColorToken],
        )
        checked++
      }
    }
    expect(checked).toBeGreaterThan(30) // sanity: the migration actually happened
  })

  it('leaves no un-tokenised raw hex colour in the migrated component styles', () => {
    for (const [f, source] of Object.entries(MIGRATED)) {
      const style = source.split('<style')[1] ?? ''
      // Strip any tokenised `var(--token, #hex)` fallback (the new --pk-color-*
      // tokens plus pre-existing ones like --bg-input-idle), then look for any
      // remaining RAW hex; there must be none.
      const stripped = style.replace(/var\(\s*--[a-z-]+\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/g, '')
      const leftover = stripped.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
      expect(leftover, `${f} still has raw hex: ${leftover.join(', ')}`).toEqual([])
    }
  })
})

describe('theme: worked example (end-to-end consumer override)', () => {
  // A minimal example theme (NOT the robot palette) that recolours the user bubble
  // and tool badge to emerald, which also demonstrates honouring DL-8's
  // green-for-user semantics via the token seam. Documented in docs/theming.md.
  const emeraldExample: PkTheme = {
    '--pk-color-primary': '#059669',
    '--pk-color-link': '#047857',
    '--pk-color-info-text': '#065f46',
    '--pk-color-info-surface': '#ecfdf5',
    '--pk-color-info-border': '#a7f3d0',
  }

  it('applying the example theme overrides the resolved tokens, and undo restores', () => {
    const root = document.documentElement
    // default: no override present, so resolution would use the stylesheet/fallback
    expect(root.style.getPropertyValue('--pk-color-primary')).toBe('')

    const undo = applyTheme(emeraldExample)
    for (const [token, value] of Object.entries(emeraldExample)) {
      expect(root.style.getPropertyValue(token)).toBe(value)
    }
    // the override differs from the default -> a real re-skin
    expect(root.style.getPropertyValue('--pk-color-primary')).not.toBe(
      defaultTheme['--pk-color-primary'],
    )

    undo()
    expect(root.style.getPropertyValue('--pk-color-primary')).toBe('')
  })
})
