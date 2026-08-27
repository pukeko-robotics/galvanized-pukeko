/**
 * Component kitchen sink — a DEV-ONLY page, deliberately NOT a build target.
 *
 * Reached through `sink/index.html` on the vite dev server (`pnpm run sink`,
 * which is `vite --open /sink/`). `vite build` takes its default single entry,
 * the root `index.html`, and `vite.config.ts` declares no extra input, so
 * nothing here is bundled: a production `dist/client/` contains only
 * `index.html` and no KitchenSink chunk.
 *
 * This file and `KitchenSink.vue` ARE type-checked — they sit under `src/`,
 * which `tsconfig.app.json` includes. Being type-checked is not the same as
 * being a bundle input; only the latter is what "build target" means here.
 *
 * If the sink is ever wanted in a deployed build, that is a deliberate change:
 * add it to `build.rollupOptions.input` in `vite.config.ts`. Do not assume it
 * ships today.
 */
import { createApp } from 'vue'
import KitchenSink from './KitchenSink.vue'
import '@galvanized-pukeko/vue-ui/style.css'

createApp(KitchenSink).mount('#app')
