// UI mode selection (P2b). `?ui=` overrides the surface at runtime; the
// no-query default is `headless` (PLAT-12 flipped it from bespoke once headless
// reached parity — PLAT-19 A2UI render, PLAT-20 chrome). `?ui=bespoke` selects
// the legacy bespoke Pukeko UI, `?ui=stock` selects CopilotKit's CopilotChat,
// `?ui=headless` selects the bespoke-styled chat driven by CopilotKit
// composables — all over our AG-UI backend (no CopilotKit cloud runtime). The
// CopilotKit modes are served by the vue-ui `/copilot` sub-export (PukekoCopilot
// shell), loaded lazily so the bespoke build doesn't pull in @copilotkit/vue.
// See briefs/copilotkit-vue/PLAN.md.
export type UiMode = 'bespoke' | 'stock' | 'headless'

/**
 * Resolve the UI mode from a URL query string (e.g. `window.location.search`).
 * Only the explicit `?ui=bespoke` / `?ui=stock` overrides map to those surfaces;
 * anything else (including no `?ui=`) resolves to the `headless` default.
 */
export function resolveMode(search: string): UiMode {
    const mode = new URLSearchParams(search).get('ui')
    return mode === 'bespoke' || mode === 'stock' ? mode : 'headless'
}
