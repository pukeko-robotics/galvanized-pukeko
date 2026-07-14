<script setup lang="ts">
/**
 * Shared app chrome (PLAT-20): the config-driven header/nav, the empty
 * left/right sidebars, and the footer that both the bespoke {@link CoreApp} and
 * the headless {@link HeadlessChatApp} shell wrap their main content in. Factored
 * out of `CoreApp.vue` verbatim so the two surfaces render identical chrome
 * without duplicating the markup + grid CSS.
 *
 * Only the truly-identical outer chrome lives here. The split-screen + A2UI
 * workplane (and its empty-state placeholder) stay per-surface: bespoke owns its
 * split in `CoreApp`, and the headless split + panel live inside `HeadlessChat`
 * where its PLAT-19 `panelA2ui` state is — hoisting that here would regress the
 * PLAT-19 panel tests, so it deliberately isn't hoisted.
 *
 * The main content goes in the default slot (rendered inside `<main>`).
 */
import { onMounted, ref } from 'vue'
import PkNavHeader from './PkNavHeader.vue'
import PkLogo from './PkLogo.vue'
import PkNavItem from './PkNavItem.vue'
import { configService, type UiConfig } from '../services/configService'

const uiConfig = ref<UiConfig | null>(configService.get())

onMounted(() => {
  if (uiConfig.value?.pageTitle) {
    document.title = uiConfig.value.pageTitle
  }
})
</script>

<template>
  <div class="app-container">
    <!-- Header -->
    <header id="galvanized-pukeko-ui-nav-header" class="app-header">
      <PkNavHeader>
        <template #logo>
          <PkNavItem
            v-if="uiConfig?.logo"
            :text="uiConfig.logo.text"
            :href="uiConfig.logo.href"
            :img="uiConfig.logo.img"
          />
          <PkLogo v-else/>
        </template>
        <template #nav-links>
          <template v-if="uiConfig?.header">
            <PkNavItem
              v-for="(item, index) in uiConfig.header"
              :key="index"
              :text="item.text"
              :href="item.href"
              :img="item.img"
              class="nav-link-item"
            />
          </template>
        </template>
      </PkNavHeader>
    </header>

    <!-- Main layout with sidebars and content -->
    <div class="app-main-layout">
      <!-- Left Sidebar -->
      <aside id="galvanized-pukeko-ui-nav-left-sidebar" class="app-left-sidebar">
        <!-- Empty by default -->
      </aside>

      <!-- Main Content Area -->
      <main class="app-main-content">
        <slot />
      </main>

      <!-- Right Sidebar -->
      <aside id="galvanized-pukeko-ui-nav-right-sidebar" class="app-right-sidebar">
        <!-- Empty by default -->
      </aside>
    </div>

    <!-- Footer -->
    <footer id="galvanized-pukeko-ui-nav-footer" class="app-footer">
      <div v-if="uiConfig?.footer" class="footer-content">
        <PkNavItem
          v-for="(item, index) in uiConfig.footer"
          :key="index"
          :text="item.text"
          :href="item.href"
          :img="item.img"
          class="footer-item"
        />
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* See packages/client/src/assets/global.css for global styles */
/* Place only things specific to DevSite here */

.app-container {
  height: 100vh;
  width: 100vw;
  display: grid;
  grid-template-rows: auto 1fr auto;
  overflow: hidden;
}

.app-header {
  grid-row: 1;
  z-index: 100;
}

.app-main-layout {
  grid-row: 2;
  display: grid;
  grid-template-columns: auto 1fr auto;
  overflow: hidden;
}

.app-left-sidebar {
  grid-column: 1;
  overflow-y: auto;
  /* Empty by default, will take no space unless content is added */
}

.app-left-sidebar:empty {
  display: none;
}

.app-main-content {
  grid-column: 2;
  overflow: hidden;
}

.app-right-sidebar {
  grid-column: 3;
  overflow-y: auto;
  /* Empty by default, will take no space unless content is added */
}

.app-right-sidebar:empty {
  display: none;
}

.app-footer {
  grid-row: 3;
  background-color: var(--bg-input-idle);
  border-top: var(--line-separator-subtle);
}

.app-footer:empty {
  display: none;
}

.footer-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--padding-twothird);
  padding: var(--padding-third);
  height: calc(var(--padding-twothird) * 3);
}

.footer-item {
  color: var(--text-button-sec-idle);
}

.nav-link-item {
  padding: var(--padding-third) var(--padding-twothird);
  border-radius: var(--border-radius-small-box);
  transition: var(--transition-normal);
}

.nav-link-item:hover {
  background: var(--bg-button-nob-active);
  color: var(--text-button-nob-active);
}
</style>
