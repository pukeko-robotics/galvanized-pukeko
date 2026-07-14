<script setup lang="ts">
/**
 * Headless-mode app shell (P2b increment 3): a CopilotKitProvider wrapping the
 * bespoke-styled {@link HeadlessChat}. Same AG-UI `HttpAgent` wiring as stock
 * mode (self-managed agent, no CopilotKit runtime); the difference is the UI is
 * ours, driven by CopilotKit composables.
 */
import { shallowRef } from 'vue'
import { CopilotKitProvider, HttpAgent } from '@copilotkit/vue/v2'
import { configService } from '../services/configService'
import HeadlessChat from './HeadlessChat.vue'
import type { A2UITarget } from './types'

const props = withDefaults(
  defineProps<{ agUiUrl?: string; a2uiTarget?: A2UITarget }>(),
  { agUiUrl: '', a2uiTarget: 'panel' },
)

const url = props.agUiUrl || configService.get().agUiUrl
const agent = shallowRef(new HttpAgent({ url }))
const selfManagedAgents = { default: agent.value }
</script>

<template>
  <CopilotKitProvider :self-managed-agents="selfManagedAgents">
    <div class="pk-headless-app">
      <HeadlessChat agent-id="default" :a2ui-target="props.a2uiTarget" />
    </div>
  </CopilotKitProvider>
</template>

<style scoped>
.pk-headless-app {
  height: 100%;
  width: 100%;
  overflow: hidden;
}
</style>
