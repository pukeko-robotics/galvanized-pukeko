<script setup lang="ts">
/**
 * Stock-UI mode (P2b, increment 1).
 *
 * Renders CopilotKit's own chat components (CopilotKitProvider + CopilotChat)
 * against OUR AG-UI backend — no CopilotKit cloud runtime is involved.
 *
 * The integration seam is CopilotKitProvider's `selfManagedAgents` prop: it
 * accepts a `Record<string, AbstractAgent>` and, when at least one local agent
 * is present, the provider needs no `runtimeUrl`. We hand it an AG-UI
 * `HttpAgent` pointed at `config.agUiUrl`, so CopilotKit speaks the same
 * AG-UI / HTTP-SSE wire the bespoke UI uses.
 *
 * `HttpAgent` is imported from `@copilotkit/vue/v2` (which re-exports
 * `@ag-ui/client`) rather than from our own `@ag-ui/client@0.0.56`, so the
 * agent is the exact `AbstractAgent` class CopilotKit's core expects.
 *
 * See briefs/copilotkit-vue/PLAN.md for the full P2b plan.
 */
import { shallowRef } from 'vue'
import { CopilotKitProvider, CopilotChat, HttpAgent } from '@copilotkit/vue/v2'
import { configService } from '@galvanized-pukeko/vue-ui'

// Agent id "default" matches AG-UI's `/agents/default/run` path and
// CopilotKit's DEFAULT_AGENT_ID, so CopilotChat resolves it without an
// explicit agentId prop.
const config = configService.get()
const agent = shallowRef(new HttpAgent({ url: config.agUiUrl }))
const selfManagedAgents = { default: agent.value }
</script>

<template>
  <CopilotKitProvider :self-managed-agents="selfManagedAgents">
    <div class="stock-chat-app">
      <CopilotChat />
    </div>
  </CopilotKitProvider>
</template>

<style scoped>
.stock-chat-app {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
</style>
