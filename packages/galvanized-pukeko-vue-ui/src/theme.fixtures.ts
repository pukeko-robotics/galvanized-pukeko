import type { PkTheme } from './theme'

/**
 * A minimal example theme (NOT the robot palette) that recolours the user
 * bubble and tool-call badge to emerald, demonstrating DL-8's green-for-user
 * semantics via the token seam. Documented (byte-for-byte) in `docs/theming.md`
 * under "Worked example: an emerald theme".
 *
 * Shared between the jsdom unit suite (`theme.spec.ts`) and the real-browser
 * override-wins proof (`e2e/theme.visual.spec.ts`) so the two can't drift
 * apart — both import this single object rather than each hand-rolling their
 * own copy of the override values.
 */
export const emeraldExample: PkTheme = {
  '--pk-color-primary': '#059669',
  '--pk-color-link': '#047857',
  '--pk-color-info-text': '#065f46',
  '--pk-color-info-surface': '#ecfdf5',
  '--pk-color-info-border': '#a7f3d0',
}
