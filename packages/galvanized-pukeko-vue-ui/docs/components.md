# Components & API reference

Everything below is exported from the package root:

```ts
import { CoreApp, ChatInterface, PkForm, chatService, configService /* … */ } from '@galvanized-pukeko/vue-ui'
import '@galvanized-pukeko/vue-ui/style.css'
```

## App

| Export | Description |
|--------|-------------|
| `CoreApp` | The complete app: nav header, chat panel, and the content area where agent-rendered components and A2UI surfaces appear. Drop-in — see [getting-started.md](./getting-started.md). |
| `ChatInterface` | Just the chat panel: message history, streaming text/reasoning, tool-call badges, and the progress bar. Exposes `sendFormMessage()` and `clearHistory()` via `defineExpose`. |

## Layout & chrome

| Component | Description |
|-----------|-------------|
| `PkNavHeader` | Top navigation bar with `logo`, `nav-links`, and `nav-controls` slots. |
| `PkNavItem` | A single nav entry. |
| `PkLogo` / `PkLogoLarge` | Pukeko logo marks. |
| `PkProgressBar` | Slim activity bar driven by `runState` / `statusText`. |

## Widgets the agent (or you) can render

| Component | Description |
|-----------|-------------|
| `PkForm` | Form container with submit handling. |
| `PkInput` | Text input. |
| `PkSelect` | Dropdown. |
| `PkCheckbox` | Checkbox. |
| `PkRadio` | Radio button. |
| `PkInputCounter` | Numeric counter with +/-. |
| `PkButton` | Action button. |
| `PkBarChart` / `PkPieChart` | Charts (Chart.js). |
| `PkTable` | Data table. |
| `PkWebcamPanel` | Webcam capture panel (e.g. for vision/robotics clients). |

## A2UI surfaces

When the agent calls the `show_a2ui_surface` tool, `CoreApp` renders the returned
[A2UI](https://github.com/google/A2UI) document — text, rows/columns, text fields and buttons —
into the content area, and submits user interactions back to the agent. This is handled internally;
you don't wire it up manually when using `CoreApp`.

## Tool-call display registry

When a tool call appears in the chat, `ToolCallBadge` shows the tool name, status, and — on
expand — the arguments and the **result**. A long result is collapsed to a first-N-lines preview
with an overflow marker and a per-call **Show more / Show less** toggle (progressive disclosure).

By default the result is rendered by a generic JSON/text renderer (`ToolResultGeneric`). A host app
can register a **bespoke renderer for its own tool** — without patching the library — through the
display registry:

```ts
import { registerToolDisplay } from '@galvanized-pukeko/vue-ui'
// (or from '@galvanized-pukeko/vue-ui/copilot' — same registry, either entry works)
import CaptureImageResult from './CaptureImageResult.vue'

const unregister = registerToolDisplay('capture_image', {
  glyph: '📷',                                   // leading header glyph
  label: 'Captured image',                       // string, or (toolName) => string
  summariseParams: (part) =>                      // short inline summary in the header
    (part.args as { camera?: string }).camera ?? '',
  renderResult: CaptureImageResult,              // Vue component; receives { part }
})
```

- **Entry shape** — `ToolDisplayEntry`: `{ renderResult?, summariseParams?, glyph?, label? }`. Every
  field is optional; an unregistered tool (or an entry with no `renderResult`) uses the generic
  fallback and the default `Used <name> tool` header.
- **Renderer props** — a custom `renderResult` component receives `ToolResultRendererProps`
  (`{ part }` — the whole `ToolCallPart`, so it can read `args`, `result`, and `status`).
- **API** — `registerToolDisplay(name, entry) => unregister`, `registerToolDisplays(record)`,
  `getToolDisplay(name)`, `hasToolDisplay(name)`, `resetToolDisplays()`. The registry is a single
  process-wide instance shared by both the library root and the `/copilot` entry, so registration
  from either import path is seen by every chat surface.

- **Timing** — register at init time (module load / app setup), **before** chat badges mount. The
  registry is consulted in a `computed` keyed on the tool name, so a registration that arrives after
  a badge has already rendered will not update that already-mounted badge until its part changes.
  (It is a startup-time registry, not a reactive store — which is all RC-14 and other consumers need.)

This is the extension point used by the robot controller to render `capture_image` as an inline
thumbnail and motion tools as before/after images (RC-14).

## Services

### `configService`

Loads runtime configuration — see [configuration.md](./configuration.md).

### `chatService`

Drives the AG-UI run loop. Key surface:

```ts
import { chatService, runState, statusText } from '@galvanized-pukeko/vue-ui'
import type { RunState, ChatCallbacks } from '@galvanized-pukeko/vue-ui'

chatService.sendMessage(text, callbacks, { tools })   // start a run
chatService.submitToolResult(/* … */)                 // return a client-tool result
chatService.resumeWithCommand(/* … */)                // resume after a client tool
chatService.resetThread()                             // new conversation (rotates thread id)
chatService.getThreadId()
```

- `runState: Ref<RunState>` — `'idle' | 'streaming' | 'running-tool' | 'waiting'`.
- `statusText: Ref<string>` — human-readable status for the progress bar.
- `ChatCallbacks` — the AG-UI event handlers (`onMessageUpdate`, `onToolCallStart`,
  `onToolCallEnd`, `onToolCallResult`, `onError`, …) for driving a custom chat UI.

### Client tools

Pass `tools` to `sendMessage` and provide handlers; when the agent calls one, `ChatInterface`
runs your handler and resumes the run with the result. This is how browser-side capabilities
(camera, geolocation, robot motion, …) are exposed to the agent. See the
[robot controller](https://github.com/andruhon/pukeko-robot-controller) for a worked example.
