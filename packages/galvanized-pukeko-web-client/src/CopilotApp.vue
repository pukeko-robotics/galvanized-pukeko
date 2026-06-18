<script setup lang="ts">
/**
 * Host surface for the CopilotKit-backed UI modes (P2b). Thin wrapper around the
 * vue-ui `/copilot` shell — the actual stock/headless/bespoke switching lives in
 * the library (PukekoCopilot), so the host just forwards the chosen `uiMode`.
 *
 * The provider/agent wiring (self-managed AG-UI HttpAgent, no CopilotKit cloud
 * runtime) is inside the library components. See briefs/copilotkit-vue/PLAN.md.
 */
import { PukekoCopilot, type UiMode } from '@galvanized-pukeko/vue-ui/copilot'

withDefaults(defineProps<{ uiMode?: UiMode }>(), { uiMode: 'stock' })
</script>

<template>
  <div class="copilot-app">
    <PukekoCopilot :ui-mode="uiMode" />
  </div>
</template>

<style scoped>
.copilot-app {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
</style>
