import '@galvanized-pukeko/vue-ui/style.css'

import { createApp, type Component } from 'vue'

import { configService } from '@galvanized-pukeko/vue-ui'

// UI mode selection (P2b). Default is the bespoke Pukeko UI; `?ui=stock` selects
// CopilotKit's CopilotChat and `?ui=headless` selects the bespoke-styled chat
// driven by CopilotKit composables — both over our AG-UI backend (no CopilotKit
// cloud runtime). The CopilotKit modes are served by the vue-ui `/copilot`
// sub-export (PukekoCopilot shell), loaded lazily so the bespoke build doesn't
// pull in @copilotkit/vue. See briefs/copilotkit-vue/PLAN.md.
type UiMode = 'bespoke' | 'stock' | 'headless'

function resolveMode(): UiMode {
    const mode = new URLSearchParams(window.location.search).get('ui')
    return mode === 'stock' || mode === 'headless' ? mode : 'bespoke'
}

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
    const mode = resolveMode()
    const App = await resolveApp(mode)
    createApp(App, mode === 'bespoke' ? {} : { uiMode: mode }).mount('#app')
}

init()
