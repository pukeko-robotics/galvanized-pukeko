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
| `PkWebcamPanel` | Webcam capture panel (e.g. for vision/robotics clients). Exposes `captureFrame()`, `composeBeforeAfter()`, `startCamera()`, `stopCamera()`, `isActive`, and `cameraStatus` / `cameraError` (see [Camera status](#camera-status)) via `defineExpose`. |

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

- **Entry shape** — `ToolDisplayEntry`: `{ renderResult?, renderPart?, summariseParams?, glyph?, label? }`.
  Every field is optional; an unregistered tool (or an entry with no `renderResult`) uses the generic
  fallback and the default `Used <name> tool` header.
- **`renderPart`** — a component that replaces the whole badge for that tool, receives `{ part }`
  from the moment the call starts, and is not collapsed. It is for a tool whose result is the thing
  the user asked for rather than tool internals; the camera tool uses it so a photo shows without a
  click. Every other tool should keep the collapsed badge.
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

### The shared `capture_image` client tool

The library ships one ready-made client tool: `capture_image`, a single-frame webcam capture.
The agent calls it, the browser grabs a frame, and the result comes back as a JSON envelope —
`{ "mimeType": "image/jpeg", "data": "<base64>" }` on success, `{ "error": "…" }` on failure.
Register it once on whichever chat surface you use:

```ts
// Bespoke ChatInterface path:
import { createCaptureImageClientTool, webcamPanelCaptureSource } from '@galvanized-pukeko/vue-ui'

const capture = createCaptureImageClientTool(webcamPanelCaptureSource(() => webcamPanelRef.value))
// <ChatInterface :client-tools="[capture.tool]"
//                :client-tool-handlers="{ [capture.tool.name]: capture.handler }" />

// CopilotKit path (stock or headless):
import { createCaptureImageFrontendTool } from '@galvanized-pukeko/vue-ui/copilot'

const frontendTools = [createCaptureImageFrontendTool()] // create once — stable array
// <HeadlessChatApp :frontend-tools="frontendTools" />
// <StockChatApp    :frontend-tools="frontendTools" />
// or via <PukekoCopilot ui-mode="stock|headless" :frontend-tools="frontendTools" />
```

Both CopilotKit surfaces — `StockChatApp` (CopilotKit's own chat) and `HeadlessChatApp`
(our headless UI) — accept the same `frontendTools` prop and forward it to
`CopilotKitProvider`, so any client tool registers identically regardless of surface.
Pass a **stable** array (create it once, outside render) to avoid churning the provider.
`PukekoCopilot` forwards the prop to whichever CopilotKit surface `uiMode` selects.

Pass `{ description: '…' }` to either factory to tell the model what your camera actually
shows. No server-side setup is needed with the gaunt-sloth AG-UI backend — the run-input
declaration alone binds the tool as a client-side interrupt.

### Configuring the camera tool (CopilotKit surfaces)

On the CopilotKit surfaces the camera is a configurable capability. Create one controller
with your settings and hand it to the tool, the display registration and the shell:

```ts
import {
  createCameraController,
  createCaptureImageFrontendTool,
  registerCaptureImageToolDisplay,
} from '@galvanized-pukeko/vue-ui/copilot'

const camera = createCameraController({ countdownSeconds: 3, inlinePreviewSize: 'full' })
registerCaptureImageToolDisplay({ camera })                   // the element in the Chat
const frontendTools = [createCaptureImageFrontendTool({ camera })]
// <PukekoCopilot ui-mode="headless" :frontend-tools="frontendTools" :camera="camera" />
```

The configuration belongs to the host. The model still calls `capture_image` with no
arguments and gets the same envelope back.

| Setting | Default | What it does |
|---|---|---|
| `permanentPreview` | `null` | A view of your own that is always on, `{ source, blink? }`. Captures read from `source`, `blink()` runs at the shutter, and no live view is shown in the Chat. `webcamPanelPermanentPreview(() => panelRef.value)` wires a mounted `PkWebcamPanel`. |
| `countdownSeconds` | `3` | A `3 — 2 — 1 — 📷` countdown before the shutter. `0` turns it off. Values are clamped to 0–10. |
| `renderToA2UI` | `false` | Also show the latest capture in the headless A2UI pane (`a2uiTarget: 'panel'`). Has no effect where there is no pane: `?ui=stock`, or `a2uiTarget: 'chat'`. |
| `sounds` | `true` | A beep on each countdown number and a shutter click. The user can mute them from the countdown, and the browser remembers that choice. If the browser refuses to play a sound, the photo is still taken. |
| `inlinePreviewSize` | `'full'` | How big the photo and the live view are drawn in the Chat: `'full'`, `'small'` or `'collapsed'`. `'collapsed'` puts the photo behind a "Show photo" disclosure. |
| `toolCallLabel` | `'Taking photo…'` | The label shown in the Chat while a capture runs. |

What the user sees with no permanent preview: the label appears in the Chat. Then the browser asks
for camera permission if it has not been granted, and the agent's turn waits for the answer. A live
view opens below the label and the countdown runs. The view blinks at the shutter, and the photo
replaces the view, shown in full. If the frame is still arriving, "Loading your photo" shows in the
meantime. If the camera cannot be reached, the Chat shows a short explanation and asks the user to
check the camera, instead of showing an error. Screen readers hear each countdown number through a
polite live region.

Both `?ui=headless` and `?ui=stock` render captures. Stock does it through the tool's own `render`,
so no extra wiring is needed there.

Frames come from an `ImageCaptureSource` when you do not use a controller:
`webcamPanelCaptureSource` adapts a mounted `PkWebcamPanel`, `createOnDemandCaptureSource()` opens
`getUserMedia`, captures one frame and releases the camera again, and
`createCaptureImageFrontendTool({ source })` captures straight from a source of yours, with no
countdown, sounds or live view.

## Camera status

`PkWebcamPanel` exposes **why** it does or does not have frames, so a host can fail fast
instead of waiting out a readiness deadline it has no way to shorten. Read it off the
component ref:

```ts
const panel = useTemplateRef('webcam')

if (panel.value?.cameraStatus === 'denied') {
  // panel.value.cameraError → { name: 'NotAllowedError', message: '…' }
}
```

| `cameraStatus` | Meaning | Will waiting help? |
|----------------|---------|--------------------|
| `idle` | No capture attempt in flight that can produce frames — before the first start, or after `stopCamera()`, which abandons a start still running. Stopping a panel that is showing an error keeps that error status instead, so that stopping does not erase why the camera never opened. | No — start the camera. |
| `starting` | A `getUserMedia` call is in flight and has not settled. | **Yes.** The only status where it can. |
| `live` | `getUserMedia` resolved and the stream is open. | No — capture should already work. |
| `denied` | Permission was refused. | No — only the user changing a browser permission will. |
| `no-device` | No camera device was found — none attached, or none available to this page. | No. |
| `busy` | The device is held by another application. | No, though a later retry may succeed. |
| `error` | Rejected for a reason this table does not name; `cameraError` carries the browser's own. | No. |

`stopCamera()` abandons a `getUserMedia` call that has not settled. The browser cannot
cancel one, so the panel discards the late result and releases its tracks instead of
returning to `live` for a session you already stopped — which is what makes `idle` above
safe to act on.

`cameraError` is `{ name, message }` — the browser's own error name and text — or `null`
when there is no failure. Both members are plain, JSON-serialisable values rather than a
raw `DOMException`, so they survive a structured clone and a tool envelope.

The status is classified from the rejection's `name`, never its message, which is
vendor- and locale-dependent. `webcamStatusFromError(err)` is exported if you call
`getUserMedia` yourself and want the same mapping. Note that `OverconstrainedError` maps
to `error`, not `no-device`: it means an attached camera could not satisfy the
constraints you asked for, so relaxing them is the move — read the name off `cameraError`
to tell it apart from the other `error` cases.

**A failed capture can name its cause.** An `ImageCaptureSource` may implement the
optional `cameraStatus()` method, and `capture_image` then reports the reason instead of
asking `Is the camera active?` — for example `Failed to capture frame. Camera permission
was denied.` A source that omits the method keeps `Failed to capture frame. Is the camera
active?` byte for byte.

**Which sources supply it, and what that changes.** `webcamPanelCaptureSource` and
`createOnDemandCaptureSource()` both supply the hook, so **panel-backed consumers and the
CopilotKit surfaces alike now receive cause-naming messages**. That is a deliberate,
visible change for them, not a compatibility accident: a host that asserts the old string
verbatim will go red when it moves to this version, and updating the assertion is the
intended fix. `createHttpSnapshotCaptureSource()` does not supply it — it fetches frames
over HTTP and has no camera to report on — so every one of its failures keeps the frozen
message unchanged.

`webcamPanelCaptureSource` reports the current status of the panel it adapts.
`createOnDemandCaptureSource()` reports why its **last capture attempt** was refused, which
is not the same thing: it opens and releases the camera around each capture, so it
reports nothing before the first attempt or after a successful one. Only the
`getUserMedia` rejection itself is classified: a failure *after* the camera has opened
reports `error`, because a camera that opened was provably not refused. Either way the
status is read at capture time, and any status that names no cause — `error`, covering
`OverconstrainedError`, an unrecognised rejection and every post-open failure — keeps the
frozen message, exactly as a source that omits the hook does.

`captureFailureMessage(status)` and `CAPTURE_IMAGE_FAILED_ERROR` are exported for hosts
that build their own envelope.
