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
export type { UiMode } from './copilot/types'
export { toBubbles } from './copilot/useHeadlessChat'
export type { ChatBubble, AgentMessageLike } from './copilot/useHeadlessChat'
