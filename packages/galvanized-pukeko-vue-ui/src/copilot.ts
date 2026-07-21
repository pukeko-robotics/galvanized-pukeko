/**
 * `@galvanized-pukeko/vue-ui/copilot` — the CopilotKit-backed UI modes (P2b).
 *
 * Kept as a SEPARATE entry point from the library root (`index.ts`) so the core
 * bespoke library stays free of the `@copilotkit/vue` dependency tree. Apps opt
 * into CopilotKit only by importing from this sub-path. `@copilotkit/vue` is an
 * optional peer dependency of vue-ui (see package.json).
 *
 * The cross-repo wire stays AG-UI over HTTP/SSE in every mode — these modes use
 * CopilotKit's self-managed `HttpAgent`, never the CopilotKit cloud runtime.
 */
import PukekoCopilot from './copilot/PukekoCopilot.vue'
import StockChatApp from './copilot/StockChatApp.vue'
import HeadlessChatApp from './copilot/HeadlessChatApp.vue'
import HeadlessChat from './copilot/HeadlessChat.vue'
import A2UIRenderToolBridge from './copilot/A2UIRenderToolBridge.vue'
import A2UIToolSurface from './components/a2ui/A2UIToolSurface.vue'

export {
  PukekoCopilot,
  StockChatApp,
  HeadlessChatApp,
  HeadlessChat,
  A2UIRenderToolBridge,
  A2UIToolSurface,
}
export type { UiMode, A2UITarget } from './copilot/types'
export { toBubbles } from './copilot/useHeadlessChat'
export type { ChatBubble, AgentMessageLike } from './copilot/useHeadlessChat'

// Shared `capture_image` client tool, headless registration (PLAT-18): build
// the CopilotKit frontend tool and pass it via the `frontendTools` prop of
// HeadlessChatApp / PukekoCopilot. The generic capture layer itself is
// re-exported here too so copilot-only consumers have a single import path
// (like the registry/theming re-exports above, the two bundles share behaviour
// through the frozen envelope contract, not module identity).
export { createCaptureImageFrontendTool } from './copilot/captureImageFrontendTool'
export type { CaptureImageFrontendToolOptions } from './copilot/captureImageFrontendTool'
export {
  CAPTURE_IMAGE_TOOL_NAME,
  CAPTURE_IMAGE_DEFAULT_DESCRIPTION,
  frameToEnvelope,
  captureImageResult,
  createCaptureImageToolDeclaration,
  createCaptureImageClientTool,
  webcamPanelCaptureSource,
  createOnDemandCaptureSource,
} from './services/captureImage'
export type {
  ImageEnvelope,
  ImageCaptureSource,
  CaptureImageToolOptions,
  OnDemandCaptureOptions,
} from './services/captureImage'

// Per-tool display registry (PLAT-17). Re-exported here as well as from the
// library root so a consumer importing the headless surface from this sub-path
// can register renderers against the SAME registry the shared ToolCallBadge
// reads (the registry is anchored on globalThis, so the two bundles share one
// instance). See `toolDisplay.ts` for the full rationale.
export {
  registerToolDisplay,
  registerToolDisplays,
  getToolDisplay,
  hasToolDisplay,
  resetToolDisplays,
  toolDisplayLabel,
} from './components/toolDisplay'
export type { ToolDisplayEntry, ToolResultRendererProps } from './components/toolDisplay'

// Theming (PLAT-23). Re-exported here as well as from the library root so a
// consumer importing the headless surface from this sub-path can re-skin it via
// the same `applyTheme` (the tokens are DOM/`:root`-side, so both bundles read
// the same variables). See `theme.ts` and docs `theming.md`.
export { applyTheme, resetTheme, defaultTheme, PK_COLOR_TOKENS } from './theme'
export type { PkTheme, PkColorToken } from './theme'
