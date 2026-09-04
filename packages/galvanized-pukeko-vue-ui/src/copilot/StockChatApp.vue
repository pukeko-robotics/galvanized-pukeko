<script setup lang="ts">
/**
 * Stock-UI mode (P2b). CopilotKit's own chat (CopilotKitProvider + CopilotChat)
 * rendered against OUR AG-UI backend — no CopilotKit cloud runtime.
 *
 * The provider's `selfManagedAgents` prop takes a `Record<string,
 * AbstractAgent>`; with a local agent present no `runtimeUrl` is needed. We hand
 * it vue-ui's own {@link GauntSlothAgent} (PLAT-55) pointed at `config.agUiUrl`,
 * so CopilotKit speaks the same AG-UI / HTTP-SSE wire the bespoke UI uses AND
 * declares the same protocol level. It still derives from the exact
 * `AbstractAgent` CopilotKit core expects: `@copilotkit/vue/v2` re-exports
 * `@ag-ui/client`, and since CopilotKit 1.70.0 pins the `0.0.59` vue-ui itself
 * resolves, both import paths reach one module instance — so there is a single
 * class identity here rather than two. `gauntSlothAgent.spec.ts` asserts that.
 *
 * Increment 2 adds A2UI: {@link A2UIRenderToolBridge} registers a custom
 * renderer for our `show_a2ui_surface` tool so agent surfaces render inside the
 * CopilotKit transcript via our own A2UI catalog.
 *
 * This is the library version of the web-client's StockChatApp; increment 4
 * promotes it into the vue-ui `/copilot` sub-export behind the `PukekoCopilot`
 * `uiMode` shell.
 */
import { shallowRef } from 'vue'
import { CopilotKitProvider, CopilotChat, type VueFrontendTool } from '@copilotkit/vue/v2'
import { GauntSlothAgent } from '../services/gauntSlothAgent'
import { configService } from '../services/configService'
import A2UIRenderToolBridge from './A2UIRenderToolBridge.vue'

const props = withDefaults(
  defineProps<{
    agUiUrl?: string
    /**
     * Client tools the host registers with CopilotKit (PLAT-18/PLAT-29), e.g.
     * `[createCaptureImageFrontendTool()]`. Forwarded to `CopilotKitProvider`'s
     * `frontendTools`, so the same stable-array contract applies: create the
     * array once, not per render.
     */
    frontendTools?: VueFrontendTool[]
  }>(),
  { agUiUrl: '', frontendTools: () => [] },
)

// Agent id "default" matches AG-UI's `/agents/default/run` path and
// CopilotKit's DEFAULT_AGENT_ID, so CopilotChat resolves it without an explicit
// agentId prop.
const url = props.agUiUrl || configService.get().agUiUrl
const agent = shallowRef(new GauntSlothAgent({ url }))
const selfManagedAgents = { default: agent.value }
</script>

<template>
  <CopilotKitProvider
    :self-managed-agents="selfManagedAgents"
    :frontend-tools="props.frontendTools"
  >
    <div class="pk-stock-chat-app">
      <A2UIRenderToolBridge agent-id="default" />
      <CopilotChat />
    </div>
  </CopilotKitProvider>
</template>

<style scoped>
.pk-stock-chat-app {
  height: 100%;
  width: 100%;
  overflow: hidden;
}
</style>
