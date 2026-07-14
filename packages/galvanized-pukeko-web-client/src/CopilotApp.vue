<script setup lang="ts">
/**
 * Host surface for the CopilotKit-backed UI modes (P2b). Thin wrapper around the
 * vue-ui `/copilot` shell — the actual stock/headless/bespoke switching lives in
 * the library (PukekoCopilot), so the host just forwards the chosen `uiMode`.
 *
 * The provider/agent wiring (self-managed AG-UI HttpAgent, no CopilotKit cloud
 * runtime) is inside the library components. See briefs/copilotkit-vue/PLAN.md.
 */
import { PukekoCopilot, type UiMode, type A2UITarget } from '@galvanized-pukeko/vue-ui/copilot'

// PLAT-19: the headless A2UI render target. Defaults to the split `panel`
// (bespoke parity); `?ui=headless` itself stays opt-in (mode selection lives in
// main.ts — flipping the app default is the separate gated PLAT-12).
withDefaults(defineProps<{ uiMode?: UiMode; a2uiTarget?: A2UITarget }>(), {
  uiMode: 'stock',
  a2uiTarget: 'panel',
})
</script>

<template>
  <div class="copilot-app">
    <PukekoCopilot :ui-mode="uiMode" :a2ui-target="a2uiTarget" />
  </div>
</template>

<style scoped>
.copilot-app {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
</style>
