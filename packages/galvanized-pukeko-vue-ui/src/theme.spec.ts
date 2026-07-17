/// <reference types="node" />
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  applyTheme,
  resetTheme,
  defaultTheme,
  PK_COLOR_TOKENS,
  type PkColorToken,
} from './theme'
import { emeraldExample } from './theme.fixtures'
// SFC source via Vite's `import.meta.glob` (`?raw` query, eager); global.css via
// fs (Vitest returns "" for `.css?raw`, and its cwd is the package root). The
// scoped <style> of a .vue file is NOT injected into jsdom, and jsdom never
// resolves `var()` in computed style, so the component-level assertions inspect
// the SFC source directly (the live-browser visual pass is the post-merge
// follow-up per the brief).
const globalCss = readFileSync('src/assets/global.css', 'utf8')

// Discover MIGRATED by globbing the package's component source dirs, rather
// than a hardcoded allowlist, so a future component that starts referencing
// `--pk-color-*` is picked up automatically (and a wrong `var(--pk-color-X,
// #wronghex)` fallback in it can't pass CI silently just because nobody
// remembered to add it to a list here). Vite 8's `import.meta.glob` API dropped
// the older (<=4) `{ as: 'raw' }` shorthand in favour of `{ query, import }`;
// `query: '?raw', import: 'default'` is the Vite 8 equivalent (see
// `node_modules/vite/types/importGlob.d.ts`: `as` is `@deprecated`, superseded
// by `query`/`import`). `eager: true` plus the explicit `<string>` generic
// (overload 3 of `ImportGlobFunction`) resolves synchronously to
// `Record<string, string>` — the same shape the old static `?raw` imports gave
// us — so nothing downstream in this file needs to change.
//
// Scoped to `./components/**/*.vue` and `./copilot/**/*.vue` (matching where
// the four currently-migrated SFCs live: `components/ChatInterface.vue`,
// `copilot/HeadlessChat.vue`, `components/ToolCallBadge.vue`,
// `components/ToolResultGeneric.vue`) rather than all of `src/**/*.vue`, so the
// glob can't accidentally sweep in test fixtures or unrelated components
// outside the theming surface.
const globbedVueSources: Record<string, string> = {
  ...import.meta.glob<string>('./components/**/*.vue', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob<string>('./copilot/**/*.vue', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
}

/** True if the SFC's `<style>` block references at least one `--pk-color-*` token. */
function hasTokenizedStyle(source: string): boolean {
  const style = source.split('<style')[1] ?? ''
  return style.includes('--pk-color-')
}

const MIGRATED: Record<string, string> = Object.fromEntries(
  Object.entries(globbedVueSources)
    .filter(([, source]) => hasTokenizedStyle(source))
    .map(([path, source]) => [path.split('/').pop()!, source]),
)

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

  it('global.css defines no --pk-color-* custom property absent from PK_COLOR_TOKENS (reverse parity)', () => {
    // The forward direction (above) proves every JS token has a CSS definition.
    // This is the other direction: a stray `--pk-color-*` declared in CSS but
    // never exported from PK_COLOR_TOKENS would be invisible to consumers
    // calling applyTheme() — they'd have no typed way to override it.
    const re = /(--pk-color-[a-z-]+):\s*[^;]+;/g
    const declaredInCss = new Set<string>()
    for (const m of globalCss.matchAll(re)) declaredInCss.add(m[1])
    expect(declaredInCss.size).toBeGreaterThan(0) // sanity: the regex actually matched something
    for (const token of declaredInCss) {
      expect(PK_COLOR_TOKENS, `global.css defines ${token} but it is not in PK_COLOR_TOKENS`).toContain(
        token as PkColorToken,
      )
    }
  })
})

describe('theme: MIGRATED discovery (glob-based, not a hardcoded allowlist)', () => {
  it('finds the four currently-tokenized SFCs by scanning for --pk-color- in <style>, not a fixed list', () => {
    expect(Object.keys(MIGRATED).sort()).toEqual(
      ['ChatInterface.vue', 'HeadlessChat.vue', 'ToolCallBadge.vue', 'ToolResultGeneric.vue'].sort(),
    )
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
  // emeraldExample lives in ./theme.fixtures so this exact object is also what
  // e2e/theme.visual.spec.ts applies in a real browser (see that file for the
  // mounted-render, actual-computed-colour proof jsdom can't provide here).
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
