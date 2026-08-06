<script setup lang="ts">
/**
 * Host surface for the CopilotKit-backed UI modes (P2b). Thin wrapper around the
 * vue-ui `/copilot` shell — the actual stock/headless/bespoke switching lives in
 * the library (PukekoCopilot), so the host just forwards the chosen `uiMode`.
 *
 * The provider/agent wiring (self-managed AG-UI HttpAgent, no CopilotKit cloud
 * runtime) is inside the library components. See briefs/copilotkit-vue/PLAN.md.
 */
import {
  PukekoCopilot,
  createCaptureImageFrontendTool,
  registerCaptureImageToolDisplay,
  type UiMode,
  type A2UITarget,
} from '@galvanized-pukeko/vue-ui/copilot'

// RC-19: render a captured frame inline in the conversation. Without this the
// badge falls through to the generic renderer and a capture shows as a raw
// `{mimeType, data: <base64>}` blob. At module scope, not in setup: the PLAT-17
// registry is not reactive, so it must be populated before any badge mounts.
registerCaptureImageToolDisplay()

// PLAT-19: the headless A2UI render target. Defaults to the split `panel`
// (bespoke parity). `uiMode` defaults to `headless` — the app default surface
// as of PLAT-12 (mode selection / `?ui=` override lives in main.ts).
withDefaults(defineProps<{ uiMode?: UiMode; a2uiTarget?: A2UITarget }>(), {
  uiMode: 'headless',
  a2uiTarget: 'panel',
})

// PLAT-18: register the shared `capture_image` client tool once for the
// headless surface (its default on-demand getUserMedia source — no persistent
// webcam panel here). Created at setup scope so the array identity is stable
// (CopilotKitProvider's `frontendTools` contract).
const frontendTools = [createCaptureImageFrontendTool()]
</script>

<template>
  <div class="copilot-app">
    <PukekoCopilot :ui-mode="uiMode" :a2ui-target="a2uiTarget" :frontend-tools="frontendTools" />
  </div>
</template>

<style scoped>
.copilot-app {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
</style>
