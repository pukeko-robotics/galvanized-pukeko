<script setup lang="ts">
/**
 * Headless-mode app shell (P2b increment 3): a CopilotKitProvider wrapping the
 * bespoke-styled {@link HeadlessChat}. Same AG-UI `HttpAgent` wiring as stock
 * mode (self-managed agent, no CopilotKit runtime); the difference is the UI is
 * ours, driven by CopilotKit composables.
 */
import { shallowRef } from 'vue'
import { CopilotKitProvider, HttpAgent, type VueFrontendTool } from '@copilotkit/vue/v2'
import { configService } from '../services/configService'
import HeadlessChat from './HeadlessChat.vue'
import PkAppChrome from '../components/PkAppChrome.vue'
import type { A2UITarget } from './types'

const props = withDefaults(
  defineProps<{
    agUiUrl?: string
    a2uiTarget?: A2UITarget
    /**
     * Client tools the host registers with CopilotKit (PLAT-18), e.g.
     * `[createCaptureImageFrontendTool()]`. Forwarded to `CopilotKitProvider`'s
     * `frontendTools`, so the same stable-array contract applies: create the
     * array once, not per render.
     */
    frontendTools?: VueFrontendTool[]
  }>(),
  { agUiUrl: '', a2uiTarget: 'panel', frontendTools: () => [] },
)

const url = props.agUiUrl || configService.get().agUiUrl
const agent = shallowRef(new HttpAgent({ url }))
const selfManagedAgents = { default: agent.value }
</script>

<template>
  <CopilotKitProvider
    :self-managed-agents="selfManagedAgents"
    :frontend-tools="props.frontendTools"
  >
    <!-- PLAT-20: same header/nav/footer chrome as bespoke CoreApp, via the shared
         PkAppChrome. The headless split-screen + A2UI panel live inside
         HeadlessChat (PLAT-19), rendered here as the chrome's main content. -->
    <PkAppChrome>
      <HeadlessChat agent-id="default" :a2ui-target="props.a2uiTarget" />
    </PkAppChrome>
  </CopilotKitProvider>
</template>
