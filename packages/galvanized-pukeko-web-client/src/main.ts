import '@galvanized-pukeko/vue-ui/style.css'

import { createApp, type Component } from 'vue'

import { configService } from '@galvanized-pukeko/vue-ui'

import { resolveMode, type UiMode } from './uiMode'

// UI mode selection (P2b). The no-query default is the headless surface
// (PLAT-12); `?ui=bespoke` / `?ui=stock` / `?ui=headless` override it. See
// ./uiMode.ts and briefs/copilotkit-vue/PLAN.md.

async function resolveApp(mode: UiMode): Promise<Component> {
    if (mode === 'bespoke') {
        return (await import('./App.vue')).default
    }
    // CopilotKit's stylesheet + the /copilot bundle are only needed for the
    // CopilotKit-backed modes; load them lazily.
    await import('@copilotkit/vue/styles.css')
    await import('@galvanized-pukeko/vue-ui/copilot/style.css')
    return (await import('./CopilotApp.vue')).default
}

async function init() {
    await configService.load()
    const mode = resolveMode(window.location.search)
    const App = await resolveApp(mode)
    createApp(App, mode === 'bespoke' ? {} : { uiMode: mode }).mount('#app')
}

init()
