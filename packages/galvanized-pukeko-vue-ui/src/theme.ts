/**
 * Theming contract for the Galvanized Pukeko Vue UI (PLAT-23).
 *
 * A consumer app can re-skin the shared chat/UI surfaces WITHOUT forking a
 * single component by overriding a small set of **role-named CSS custom
 * properties** (`--pk-color-*`). The mechanism is deliberately DOM-side (write
 * the variables at `:root`) rather than JS-state: CSS custom properties cascade
 * and inherit through the DOM, so a single write on `document.documentElement`
 * re-themes every mounted vue-ui component regardless of which of the two
 * rollup bundles it came from (`vue-ui.es.js` vs `copilot.es.js`). This
 * sidesteps the two-bundle split that forced PLAT-17's `globalThis`-anchored
 * registry; there is nothing JS-side to share here.
 *
 * ── Default values & the DL-8 mapping ───────────────────────────────────────
 * The default theme reproduces today's exact appearance; this is a
 * refactor-to-tokens, not a restyle. The token *names* are the semantic layer
 * (they honour the META-5 DL-8 cross-surface colour roles); the default
 * *values* are the colours the web surfaces already shipped. DL-8 roles map to
 * the token families as:
 *   - **informational** (DL-8 "cyan") → the `--pk-color-info-*` tool-call family
 *   - **error** (DL-8 "red")          → the `--pk-color-danger*` family
 *   - **secondary / contextual** (DL-8 "dim") → `--pk-color-text-{muted,secondary,dim}`
 *   - **user's own input** (DL-8 "green")     → `--pk-color-primary` (the user
 *       bubble). The web has always drawn the user bubble in the accent blue,
 *       not green; the token is the semantic slot a consumer can now recolour to
 *       honour DL-8's green-for-user without forking the component.
 * (DL-8 "warning / yellow" has no surface in the current chat components, so no
 * warning token is defined yet; add one when a warning surface exists.)
 *
 * Each migrated component references its token with the original colour as the
 * CSS fallback (`var(--pk-color-primary, #3b82f6)`), so the default appearance
 * holds even for the `/copilot` bundle, which does not ship `global.css`'s
 * `:root` defaults. Overriding via {@link applyTheme} (or setting the variables
 * at `:root` by hand) still wins for both bundles because it writes higher up
 * the cascade.
 */

/** The full set of themeable semantic colour tokens (the token contract). */
export type PkColorToken =
  // Surfaces & structure
  | '--pk-color-surface'
  | '--pk-color-surface-muted'
  | '--pk-color-surface-sunken'
  | '--pk-color-border'
  // Text
  | '--pk-color-text'
  | '--pk-color-text-muted'
  | '--pk-color-text-secondary'
  | '--pk-color-text-dim'
  // Primary / accent (DL-8 "user's own input" slot + interactive accent)
  | '--pk-color-primary'
  | '--pk-color-on-primary'
  | '--pk-color-link'
  // Danger (DL-8 "error / red")
  | '--pk-color-danger'
  | '--pk-color-danger-strong'
  | '--pk-color-danger-hover'
  | '--pk-color-danger-hover-strong'
  | '--pk-color-danger-text'
  | '--pk-color-danger-surface'
  // Informational (DL-8 "informational / cyan"): the tool-call badge family
  | '--pk-color-info-surface'
  | '--pk-color-info-surface-hover'
  | '--pk-color-info-border'
  | '--pk-color-info-text'
  // Code / preformatted result blocks
  | '--pk-color-code-text'
  | '--pk-color-code-surface'
  | '--pk-color-code-border'

/**
 * A theme override: a partial map of token → CSS colour value. Anything omitted
 * keeps its default. Passed to {@link applyTheme}.
 */
export type PkTheme = Partial<Record<PkColorToken, string>>

/**
 * The default theme: the DL-8 default palette, i.e. the exact colours the web
 * surfaces shipped before PLAT-23. These values are mirrored verbatim in
 * `assets/global.css`'s `:root` block and in every migrated component's `var()`
 * fallback; the `theme.spec.ts` contract test asserts all three stay in lock-step.
 */
export const defaultTheme: Record<PkColorToken, string> = {
  // Surfaces & structure
  '--pk-color-surface': '#fff',
  '--pk-color-surface-muted': '#f3f4f6',
  '--pk-color-surface-sunken': '#f9fafb',
  '--pk-color-border': '#e5e7eb',
  // Text
  '--pk-color-text': '#1f2937',
  '--pk-color-text-muted': '#6b7280',
  '--pk-color-text-secondary': '#64748b',
  '--pk-color-text-dim': '#9ca3af',
  // Primary / accent
  '--pk-color-primary': '#3b82f6',
  '--pk-color-on-primary': '#fff',
  '--pk-color-link': '#2563eb',
  // Danger
  '--pk-color-danger': '#d32f2f',
  '--pk-color-danger-strong': '#b71c1c',
  '--pk-color-danger-hover': '#e53935',
  '--pk-color-danger-hover-strong': '#c62828',
  '--pk-color-danger-text': '#991b1b',
  '--pk-color-danger-surface': '#fee2e2',
  // Informational (tool-call badge)
  '--pk-color-info-surface': '#eff6ff',
  '--pk-color-info-surface-hover': '#dbeafe',
  '--pk-color-info-border': '#bfdbfe',
  '--pk-color-info-text': '#1e40af',
  // Code / preformatted
  '--pk-color-code-text': '#334155',
  '--pk-color-code-surface': '#f8fafc',
  '--pk-color-code-border': '#cbd5e1',
}

/** The token contract as an ordered list (useful for iteration/tests/tooling). */
export const PK_COLOR_TOKENS = Object.keys(defaultTheme) as PkColorToken[]

function resolveTarget(target?: HTMLElement): HTMLElement | null {
  if (target) return target
  if (typeof document === 'undefined') return null
  return document.documentElement
}

/**
 * Apply a theme override by writing its tokens as CSS custom properties on a
 * target element (default: `:root` / `document.documentElement`). Because the
 * properties cascade, this re-themes every mounted vue-ui component beneath the
 * target; no component props, no re-render plumbing.
 *
 * Returns an **undo** function that restores each touched property to whatever
 * it was before the call (removing it if it was previously unset), so tests and
 * transient theme swaps are clean.
 *
 * @example
 * ```ts
 * import { applyTheme } from '@galvanized-pukeko/vue-ui'
 *
 * // Re-skin the whole app to an emerald accent:
 * applyTheme({ '--pk-color-primary': '#059669', '--pk-color-link': '#047857' })
 * ```
 *
 * @param theme  Partial map of token → CSS colour value.
 * @param target Element to write the variables on. Defaults to `:root`.
 * @returns A function that reverts exactly the properties this call set.
 */
export function applyTheme(theme: PkTheme, target?: HTMLElement): () => void {
  const el = resolveTarget(target)
  if (!el) return () => {}
  const prior = new Map<string, string>()
  for (const [token, value] of Object.entries(theme)) {
    if (value == null) continue
    prior.set(token, el.style.getPropertyValue(token))
    el.style.setProperty(token, value)
  }
  return () => {
    for (const [token, was] of prior) {
      if (was) el.style.setProperty(token, was)
      else el.style.removeProperty(token)
    }
  }
}

/**
 * Remove every `--pk-color-*` override previously written on the target element
 * (default `:root`), reverting to the stylesheet / fallback defaults. Does not
 * touch variables the theme contract doesn't own.
 */
export function resetTheme(target?: HTMLElement): void {
  const el = resolveTarget(target)
  if (!el) return
  for (const token of PK_COLOR_TOKENS) el.style.removeProperty(token)
}
