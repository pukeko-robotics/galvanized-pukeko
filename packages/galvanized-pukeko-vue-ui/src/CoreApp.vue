<script setup lang="ts">
import ChatInterface from './components/ChatInterface.vue'
import A2UISurface from './components/a2ui/A2UISurface.vue'
import { useA2UI } from './composables/useA2UI'
import PkAppChrome from './components/PkAppChrome.vue'
import PkLogoLarge from './components/PkLogoLarge.vue'

// A2UI composable for rendering agent-driven UI surfaces
const a2ui = useA2UI()
</script>

<template>
  <!-- Shared header/nav/sidebars/footer chrome (PLAT-20). The bespoke split-screen
       + A2UI workplane below is unchanged and stays owned by this surface. -->
  <PkAppChrome>
    <div class="split-screen">
      <!-- Left Side: Chat Interface -->
      <div class="chat-panel">
        <ChatInterface :a2ui="a2ui" />
      </div>

      <!-- Right Side: Content -->
      <div class="content-panel">
        <div class="app-content">
          <!-- A2UI Surfaces rendered from agent tool calls -->
          <template v-if="a2ui.surfaces.value.size > 0">
            <A2UISurface
              v-for="[id, surface] in a2ui.surfaces.value"
              :key="id"
              :surface="surface"
              :surfaceId="id"
              :a2ui="a2ui"
            />
          </template>

          <div v-if="a2ui.surfaces.value.size === 0"
               id="galvanized-pukeko-ui-waiting-placeholder"
               class="waiting-placeholder">
            <PkLogoLarge />
          </div>
        </div>
      </div>
    </div>
  </PkAppChrome>
</template>

<style scoped>
/* See packages/client/src/assets/global.css for global styles */
/* Place only things specific to DevSite here */

.split-screen {
  display: flex;
  height: 100%;
  width: 100%;
}

.chat-panel {
  width: 40%;
  height: 100%;
  min-width: 300px;
}

.content-panel {
  width: 60%;
  height: 100%;
  overflow-y: auto;
  background-color: #f9fafb;
}

.app-content {
  padding: 2rem;
  max-width: 800px;
  margin: 0 auto;
}

.waiting-placeholder {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 40%;
  margin: 0 auto;
  opacity: 0.2;
  padding: 2rem 0;
}

.waiting-placeholder :deep(svg) {
  height: 70vh;
  aspect-ratio: auto;
}
</style>
