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
  createCameraController,
  createCaptureImageFrontendTool,
  registerCaptureImageToolDisplay,
  type UiMode,
  type A2UITarget,
} from '@galvanized-pukeko/vue-ui/copilot'

// RC-35: one camera controller shared by the tool's handler, the in-Chat
// element and the A2UI pane. Library defaults otherwise — a 3-second
// photobooth countdown with sounds (user-mutable), the photo inline at full
// size and uncollapsed, the live view in the Chat — plus the preview mirrored
// into the headless Workplane, since this app's default surface has one.
const camera = createCameraController({ renderToA2UI: true })

// RC-19/RC-35: render a capture inline in the conversation — live view,
// countdown, then the photo — instead of the generic renderer's raw
// `{mimeType, data: <base64>}` blob. At module scope, not in setup: the PLAT-17
// registry is not reactive, so it must be populated before any badge mounts.
registerCaptureImageToolDisplay({ camera })

// PLAT-19: the headless A2UI render target. Defaults to the split `panel`
// (bespoke parity). `uiMode` defaults to `headless` — the app default surface
// as of PLAT-12 (mode selection / `?ui=` override lives in main.ts).
withDefaults(defineProps<{ uiMode?: UiMode; a2uiTarget?: A2UITarget }>(), {
  uiMode: 'headless',
  a2uiTarget: 'panel',
})

// PLAT-18/RC-35: register the shared `capture_image` client tool once. Its
// handler captures from a stream opened for the capture (no permanent webcam
// panel here), and its `render` is what shows a capture on `?ui=stock`.
// Created at setup scope so the array identity is stable (CopilotKitProvider's
// `frontendTools` contract). `?ui=bespoke` gets no camera, deliberately (D6).
const frontendTools = [createCaptureImageFrontendTool({ camera })]
</script>

<template>
  <div class="copilot-app">
    <PukekoCopilot
      :ui-mode="uiMode"
      :a2ui-target="a2uiTarget"
      :frontend-tools="frontendTools"
      :camera="camera"
    />
  </div>
</template>

<style scoped>
.copilot-app {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
</style>
