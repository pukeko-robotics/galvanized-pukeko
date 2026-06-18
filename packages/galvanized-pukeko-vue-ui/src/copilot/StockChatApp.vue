<script setup lang="ts">
/**
 * Stock-UI mode (P2b). CopilotKit's own chat (CopilotKitProvider + CopilotChat)
 * rendered against OUR AG-UI backend — no CopilotKit cloud runtime.
 *
 * The provider's `selfManagedAgents` prop takes a `Record<string,
 * AbstractAgent>`; with a local agent present no `runtimeUrl` is needed. We hand
 * it an AG-UI `HttpAgent` from `@copilotkit/vue/v2` (so it's the exact
 * AbstractAgent class CopilotKit core expects) pointed at `config.agUiUrl`, so
 * CopilotKit speaks the same AG-UI / HTTP-SSE wire the bespoke UI uses.
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
import { CopilotKitProvider, CopilotChat, HttpAgent } from '@copilotkit/vue/v2'
import { configService } from '../services/configService'
import A2UIRenderToolBridge from './A2UIRenderToolBridge.vue'

const props = withDefaults(defineProps<{ agUiUrl?: string }>(), { agUiUrl: '' })

// Agent id "default" matches AG-UI's `/agents/default/run` path and
// CopilotKit's DEFAULT_AGENT_ID, so CopilotChat resolves it without an explicit
// agentId prop.
const url = props.agUiUrl || configService.get().agUiUrl
const agent = shallowRef(new HttpAgent({ url }))
const selfManagedAgents = { default: agent.value }
</script>

<template>
  <CopilotKitProvider :self-managed-agents="selfManagedAgents">
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
