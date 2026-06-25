# Getting started

`@galvanized-pukeko/vue-ui` is a Vue 3 component library that lets an LLM agent render real UI —
a chat interface plus forms, charts, tables and interactive [A2UI](https://github.com/google/A2UI)
surfaces — in your app, on the fly, by talking to an [AG-UI](https://github.com/ag-ui-protocol/ag-ui)
server (such as [Gaunt Sloth](https://github.com/Galvanized-Pukeko/gaunt-sloth-assistant) or the
[ADK agent](https://github.com/pukeko-robotics/galvanized-pukeko/tree/main/packages/galvanized-pukeko-agent-adk)).

The fastest way to use it is the all-in-one `CoreApp` component. You only need an AG-UI server to
point it at.

## Install

```bash
npm install @galvanized-pukeko/vue-ui vue
```

## Minimal app

```ts
// main.ts
import '@galvanized-pukeko/vue-ui/style.css'
import { createApp } from 'vue'
import { CoreApp, configService } from '@galvanized-pukeko/vue-ui'

await configService.load()   // reads /config.json (see configuration.md)
createApp(CoreApp).mount('#app')
```

```html
<!-- index.html -->
<div id="app"></div>
<script type="module" src="/main.ts"></script>
```

```json
// public/config.json
{ "agUiUrl": "http://localhost:3000/agents/default/run", "appName": "Demo" }
```

Run an AG-UI server and your dev server:

```bash
npx gaunt-sloth-api ag-ui --port 3000     # any AG-UI server works
vite                                       # serves the SPA above
```

`CoreApp` then handles the chat loop, streaming, and rendering of any components the agent asks for.

## Building blocks

If you don't want the whole `CoreApp`, compose the pieces yourself:

- [`ChatInterface`](./components.md) — the chat panel (messages, streaming, tool-call badges, progress bar).
- [`chatService`](./components.md#chatservice) — send messages and drive the AG-UI run loop.
- [`configService`](./configuration.md) — load runtime configuration.
- The `Pk*` components — render the same widgets the agent uses, directly.

See [components.md](./components.md) and [configuration.md](./configuration.md) for the full surface.
