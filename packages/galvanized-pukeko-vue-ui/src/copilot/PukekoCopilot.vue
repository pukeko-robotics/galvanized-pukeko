<script setup lang="ts">
/**
 * vue-ui 1.0 shell (P2b increment 4). One component, three UI modes behind a
 * single `uiMode` prop:
 *
 *   - 'bespoke'  — the legacy Pukeko UI (CoreApp): chat + A2UI via chatService.
 *   - 'stock'    — CopilotKit's CopilotChat over our AG-UI backend.
 *   - 'headless' — bespoke Pukeko chat primitives driven by CopilotKit composables.
 *
 * The CopilotKit modes ('stock' / 'headless') pull in `@copilotkit/vue`, a
 * dependency of this library that only the `./copilot` sub-export imports — so
 * apps that only use 'bespoke' never load CopilotKit in their bundle. This shell
 * lives in the `./copilot` entry, so importing it already opts into that cost.
 *
 * The wire stays AG-UI / HTTP-SSE in every mode (see PLAN.md): stock/headless
 * use CopilotKit's self-managed `HttpAgent` — never the CopilotKit cloud runtime.
 */
import StockChatApp from './StockChatApp.vue'
import HeadlessChatApp from './HeadlessChatApp.vue'
import CoreApp from '../CoreApp.vue'
import type { VueFrontendTool } from '@copilotkit/vue/v2'
import type { UiMode, A2UITarget } from './types'
import type { CameraController } from '../services/cameraController'

withDefaults(
  defineProps<{
    /** Which UI to render. Defaults to the legacy bespoke UI. */
    uiMode?: UiMode
    /** AG-UI endpoint for the CopilotKit modes; defaults to configService's. */
    agUiUrl?: string
    /**
     * Where the headless UI renders A2UI surfaces (PLAT-19). Defaults to the
     * split `panel` (bespoke parity); only meaningful when `uiMode === 'headless'`.
     */
    a2uiTarget?: A2UITarget
    /**
     * Client tools to register with CopilotKit (PLAT-18/PLAT-29), e.g.
     * `[createCaptureImageFrontendTool()]`. Forwarded to the CopilotKit shells
     * (stable array — create once); meaningful for the CopilotKit modes
     * (`uiMode === 'stock' | 'headless'`).
     */
    frontendTools?: VueFrontendTool[]
    /**
     * The camera tool's controller (RC-35). Only the headless surface reads it
     * here, to mirror a capture into its A2UI pane when `renderToA2UI` is on;
     * stock has no A2UI pane, so there the setting is a no-op.
     */
    camera?: CameraController | null
  }>(),
  { uiMode: 'bespoke', agUiUrl: '', a2uiTarget: 'panel', frontendTools: () => [], camera: null },
)
</script>

<template>
  <StockChatApp v-if="uiMode === 'stock'" :ag-ui-url="agUiUrl" :frontend-tools="frontendTools" />
  <HeadlessChatApp
    v-else-if="uiMode === 'headless'"
    :ag-ui-url="agUiUrl"
    :a2ui-target="a2uiTarget"
    :frontend-tools="frontendTools"
    :camera="camera"
  />
  <CoreApp v-else />
</template>
