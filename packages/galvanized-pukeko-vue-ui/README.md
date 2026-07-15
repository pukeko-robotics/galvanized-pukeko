# @galvanized-pukeko/vue-ui

[![npm](https://img.shields.io/npm/v/@galvanized-pukeko/vue-ui)](https://www.npmjs.com/package/@galvanized-pukeko/vue-ui)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/pukeko-robotics/galvanized-pukeko/blob/main/LICENSE)

Vue 3 component library for the [Galvanized Pukeko](https://github.com/pukeko-robotics/galvanized-pukeko)
framework. It lets an LLM agent render real UI — a chat interface plus forms, charts, tables and
interactive [A2UI](https://github.com/google/A2UI) surfaces — in your app, on the fly, by talking to
an [AG-UI](https://github.com/ag-ui-protocol/ag-ui) server such as
[Gaunt Sloth](https://github.com/pukeko-robotics/gaunt-sloth) or the
[ADK agent](https://github.com/pukeko-robotics/galvanized-pukeko/tree/main/packages/galvanized-pukeko-agent-adk).

```bash
npm install @galvanized-pukeko/vue-ui vue
```

```ts
import '@galvanized-pukeko/vue-ui/style.css'
import { createApp } from 'vue'
import { CoreApp, configService } from '@galvanized-pukeko/vue-ui'

await configService.load()
createApp(CoreApp).mount('#app')
```

## Documentation

- [Getting started](https://github.com/pukeko-robotics/galvanized-pukeko/blob/main/packages/galvanized-pukeko-vue-ui/docs/getting-started.md)
- [Configuration](https://github.com/pukeko-robotics/galvanized-pukeko/blob/main/packages/galvanized-pukeko-vue-ui/docs/configuration.md)
- [Components & API reference](https://github.com/pukeko-robotics/galvanized-pukeko/blob/main/packages/galvanized-pukeko-vue-ui/docs/components.md)
- [Theming](https://github.com/pukeko-robotics/galvanized-pukeko/blob/main/packages/galvanized-pukeko-vue-ui/docs/theming.md)

## Reference implementations

- [Web client host](https://github.com/pukeko-robotics/galvanized-pukeko/tree/main/packages/galvanized-pukeko-web-client)
- [Examples](https://github.com/pukeko-robotics/galvanized-pukeko/tree/main/examples)
- [Pukeko robot controller](https://github.com/andruhon/pukeko-robot-controller) — client tools (camera, motion) driven by the agent

## License

[MIT](https://github.com/pukeko-robotics/galvanized-pukeko/blob/main/LICENSE) © Andrew Kondratev
