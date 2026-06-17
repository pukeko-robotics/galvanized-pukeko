import '@galvanized-pukeko/vue-ui/style.css'

import { createApp, type Component } from 'vue'

import { configService } from '@galvanized-pukeko/vue-ui'

// UI mode selection (P2b). Default is the bespoke Pukeko UI; `?ui=stock`
// selects the CopilotKit stock-UI mode (CopilotChat over our AG-UI backend).
// See briefs/copilotkit-vue/PLAN.md.
async function resolveApp(): Promise<Component> {
    const mode = new URLSearchParams(window.location.search).get('ui')
    if (mode === 'stock') {
        // CopilotKit's stylesheet is only needed in stock mode; load it lazily
        // so the bespoke build doesn't pull it in.
        await import('@copilotkit/vue/styles.css')
        return (await import('./StockChatApp.vue')).default
    }
    return (await import('./App.vue')).default
}

async function init() {
    await configService.load()
    const App = await resolveApp()
    createApp(App).mount('#app')
}

init()
