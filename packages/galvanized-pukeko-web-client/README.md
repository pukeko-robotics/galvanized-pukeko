# @galvanized-pukeko/web-client

Reference host application for [`@galvanized-pukeko/vue-ui`](https://www.npmjs.com/package/@galvanized-pukeko/vue-ui).

It is a thin [Vite](https://vite.dev) + Vue app that mounts the library's `CoreApp` and loads its
runtime configuration — it ships **no UI of its own**. The chat interface, dynamic forms, charts,
tables and A2UI surfaces all live in the `vue-ui` package.

This package exists as (a) the static build that the
[`galvanized-pukeko-agent-adk`](https://github.com/Galvanized-Pukeko/galvanized-pukeko-ai-ui/tree/main/packages/galvanized-pukeko-agent-adk)
server embeds, and (b) a runnable reference for the
[examples](https://github.com/Galvanized-Pukeko/galvanized-pukeko-ai-ui/tree/main/examples).

> Not published to npm — it is an app, not a library. The publishable package is
> [`@galvanized-pukeko/vue-ui`](https://www.npmjs.com/package/@galvanized-pukeko/vue-ui).

## Run

```bash
pnpm install
pnpm run dev        # http://localhost:5555
```

Point it at an AG-UI server (Gaunt Sloth or the ADK agent) by setting `AGUI_URL`:

```bash
AGUI_URL=http://localhost:3000/agents/default/run pnpm run dev
```

Without `AGUI_URL`, the app fetches `/config.json` at runtime instead — see the vue-ui
[configuration docs](https://github.com/Galvanized-Pukeko/galvanized-pukeko-ai-ui/blob/main/packages/galvanized-pukeko-vue-ui/docs/configuration.md).

## The whole app

The host is essentially these few lines around the library:

```ts
// src/main.ts
import '@galvanized-pukeko/vue-ui/style.css'
import { createApp } from 'vue'
import { configService } from '@galvanized-pukeko/vue-ui'
import App from './App.vue'      // App.vue is just <CoreApp />

await configService.load()
createApp(App).mount('#app')
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm run dev` | Dev server on `:5555` |
| `pnpm run build` | Production build to `dist/client` |
| `pnpm run test` | Unit tests |
| `pnpm run lint` / `pnpm run type-check` | Lint / TypeScript check |

## Related

- [`@galvanized-pukeko/vue-ui` — the library](https://github.com/Galvanized-Pukeko/galvanized-pukeko-ai-ui/tree/main/packages/galvanized-pukeko-vue-ui)
- [Component & configuration docs](https://github.com/Galvanized-Pukeko/galvanized-pukeko-ai-ui/tree/main/packages/galvanized-pukeko-vue-ui/docs)
- [Examples](https://github.com/Galvanized-Pukeko/galvanized-pukeko-ai-ui/tree/main/examples)
- [Monorepo root](https://github.com/Galvanized-Pukeko/galvanized-pukeko-ai-ui)
