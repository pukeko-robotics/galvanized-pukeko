/**
 * Per-tool display registry (PLAT-17).
 *
 * Maps a tool name to an optional custom result renderer, a param summariser,
 * and a glyph/label — with a generic JSON/text fallback (see
 * `ToolResultGeneric.vue`) for any tool that is not registered. This is the
 * pluggable extension point that lets a *consumer* (e.g. the robot-controller,
 * RC-14: `capture_image` → inline thumbnail) register a bespoke renderer for its
 * own tool WITHOUT patching vue-ui — it just imports {@link registerToolDisplay}
 * from the vue-ui public surface.
 *
 * Design mirrors the gaunt-sloth Ink TUI registry (TUI-C17, not yet built): name
 * → glyph/label + per-tool result formatter + collapsed inline preview, so the
 * web and TUI surfaces stay analogous.
 *
 * ── Why the registry is keyed off `globalThis` ──────────────────────────────
 * vue-ui ships as TWO independent rollup bundles: the library root (`index.ts`
 * → `vue-ui.es.js`, used by `ChatInterface`) and the CopilotKit sub-export
 * (`copilot.ts` → `copilot.es.js`, used by `HeadlessChat`). The shared
 * `ToolCallBadge` is reached from BOTH, so this module is inlined into BOTH
 * bundles. A plain module-level `Map` would therefore be TWO maps at runtime: a
 * consumer registering via one import path would not be seen by a badge rendered
 * from the other — silently falling back to generic. Anchoring the single map on
 * `globalThis` collapses them to one instance regardless of how many bundles
 * inline this file.
 */
import type { Component } from 'vue'
import type { ToolCallPart } from '../services/chatService'

/**
 * Props passed to a custom result-renderer component. The whole tool-call part
 * is handed over (not just the result string) so a renderer can read `args`,
 * `status`, and `result` together — e.g. RC-14's before/after motion renderers
 * need the args to caption the images. Note the renderer only mounts once a
 * result is present (the badge guards on `result != null`), so `status` is
 * effectively `'complete'` at render time.
 */
export interface ToolResultRendererProps {
  part: ToolCallPart
}

/** A per-tool display entry. Every field is optional; an empty entry behaves
 * exactly like an unregistered tool (generic fallback + default header). */
export interface ToolDisplayEntry {
  /**
   * A Vue component rendered in place of the generic JSON/text result view. It
   * receives {@link ToolResultRendererProps} (`{ part }`). Omit to keep the
   * generic renderer.
   */
  renderResult?: Component
  /**
   * Produces a short one-line summary of the call args, shown inline in the
   * collapsed header (e.g. `capture_image → front camera`). Omit for none.
   */
  summariseParams?: (part: ToolCallPart) => string
  /** A leading glyph/emoji for the header (e.g. `📷`). */
  glyph?: string
  /**
   * The header label. A string overrides the default `Used <name> tool`, or a
   * function receives the tool name and returns the label.
   */
  label?: string | ((toolName: string) => string)
}

const REGISTRY_KEY = Symbol.for('galvanized-pukeko.vue-ui.toolDisplayRegistry')

type GlobalWithRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, ToolDisplayEntry>
}

function registry(): Map<string, ToolDisplayEntry> {
  const g = globalThis as GlobalWithRegistry
  return (g[REGISTRY_KEY] ??= new Map<string, ToolDisplayEntry>())
}

/**
 * Register a display entry for a tool name. Re-registering the same name
 * replaces the prior entry. Returns an unregister function.
 *
 * **Timing:** register at init time (module load / app setup), before chat
 * badges mount. `ToolCallBadge` consults the registry inside a `computed` keyed
 * on the tool name, so a registration that arrives *after* a badge has already
 * rendered will not update that already-mounted badge until its part changes.
 * This is deliberate (consumers register once at startup, à la RC-14) — it is
 * not a reactive store.
 *
 * @example
 * ```ts
 * import { registerToolDisplay } from '@galvanized-pukeko/vue-ui'
 * import CaptureImageResult from './CaptureImageResult.vue'
 *
 * registerToolDisplay('capture_image', {
 *   glyph: '📷',
 *   label: 'Captured image',
 *   summariseParams: (p) => (p.args as { camera?: string })?.camera ?? '',
 *   renderResult: CaptureImageResult, // receives { part }
 * })
 * ```
 */
export function registerToolDisplay(toolName: string, entry: ToolDisplayEntry): () => void {
  registry().set(toolName, entry)
  return () => {
    if (registry().get(toolName) === entry) registry().delete(toolName)
  }
}

/** Register several tool displays at once. Returns an unregister-all function. */
export function registerToolDisplays(entries: Record<string, ToolDisplayEntry>): () => void {
  const undos = Object.entries(entries).map(([name, entry]) => registerToolDisplay(name, entry))
  return () => undos.forEach((u) => u())
}

/** Look up the display entry for a tool name (or `undefined` if unregistered). */
export function getToolDisplay(toolName: string): ToolDisplayEntry | undefined {
  return registry().get(toolName)
}

/** Whether a display entry is registered for a tool name. */
export function hasToolDisplay(toolName: string): boolean {
  return registry().has(toolName)
}

/** Clear the registry. Intended for tests. */
export function resetToolDisplays(): void {
  registry().clear()
}

/** Resolve the header label for a tool from its (optional) entry. */
export function toolDisplayLabel(toolName: string, entry?: ToolDisplayEntry): string {
  const label = entry?.label
  if (typeof label === 'function') return label(toolName)
  if (typeof label === 'string') return label
  return `Used ${toolName} tool`
}
