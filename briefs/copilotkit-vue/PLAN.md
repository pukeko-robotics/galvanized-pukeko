# CopilotKit Vue integration (P2b) — WIP plan

> Status: **in progress.** Increment 1 (stock-UI mode, AG-UI direct) landed; the
> rest is planned below. This is the working note for graph node **P2b**
> ("CopilotKit Vue integration — vue-ui 1.0, headless UI, stock UI, A2UI, e2e").

## Goal

Integrate **`@copilotkit/vue`** (the v2 `/v2` API surface) into this repo so the
Vue UI can offer:

1. a **stock UI** mode — CopilotKit's own chat components (`CopilotChat`,
   `CopilotKitProvider`), rendered against our AG-UI backend;
2. a **headless** mode — CopilotKit composables (`useAgent`, `useFrontendTool`,
   `useRenderTool`, …) driving our existing bespoke Pukeko components;
3. **A2UI** surfaces rendered through CopilotKit's A2UI renderer (or bridged to
   our existing `A2UIRenderer.vue`);
4. **e2e** coverage (Playwright) for the new modes;
5. a **vue-ui 1.0** shell that exposes both the legacy bespoke UI and the
   CopilotKit-backed modes behind one library surface.

## Hard constraint — the wire stays AG-UI

The cross-repo contract is **AG-UI over HTTP/SSE** between the UI and any
backend (gaunt-sloth, ADK). We do **NOT** introduce the CopilotKit cloud
*runtime* (`runtimeUrl` / `/api/copilotkit`). Instead we use CopilotKit's
**self-managed agent** path:

```ts
import { CopilotKitProvider, HttpAgent } from '@copilotkit/vue/v2'

const agent = new HttpAgent({ url: config.agUiUrl })   // AG-UI HttpAgent
// <CopilotKitProvider :self-managed-agents="{ default: agent }">
```

`CopilotKitProvider` merges `selfManagedAgents` into its core as
`agents__unsafe_dev_only`; when local agents are present **no `runtimeUrl` is
required** (verified in `_refs/CopilotKit/.../CopilotKitProvider.vue`). The
agent id defaults to `"default"` (`DEFAULT_AGENT_ID`), matching our AG-UI path
`/agents/default/run`. So CopilotKit talks our existing AG-UI wire directly.

`HttpAgent` is imported **from `@copilotkit/vue/v2`** (which re-exports
`@ag-ui/client`) rather than from our own `@ag-ui/client@0.0.56`, so the agent
instance is an `AbstractAgent` of the *same class identity* CopilotKit's core
expects (CopilotKit bundles `@ag-ui/client@0.0.57`).

### Client-tool flow (the second contract)

Today the bespoke `chatService.runLoop` implements the gsloth-specific
client-tool interrupt/resume (`forwardedProps.command.resume`). CopilotKit has
its own equivalents: `useFrontendTool` / `useHumanInTheLoop` /
`use-interrupt.ts`. The server-side generalisation of this flow (tracked
elsewhere in TAKAHĒ) must keep speaking what CopilotKit emits. **Increment 3**
(headless) is where we reconcile these; until then the stock-UI mode covers the
plain chat + server-tool-render path only, and client tools continue to run
through the bespoke `ChatInterface` path.

## Increments

| # | Increment | State |
|---|-----------|-------|
| 1 | **Stock-UI mode**: `CopilotKitProvider` + `CopilotChat` wired to our AG-UI `HttpAgent`; selectable from the web-client; builds. | **done** |
| 2 | **A2UI in stock UI**: bridge our `show_a2ui_surface` tool to our `A2UISurface`/catalog via `useRenderTool`; render agent surfaces inside CopilotKit chat. | **done** |
| 3 | **Headless mode**: bespoke Pukeko chat primitives driven by CopilotKit composables (`useAgent`/`useCopilotKit`/`useRenderTool`); client-tool interrupt/resume reconciled via the gsloth C-a server flow + `useFrontendTool` (spike-1). | **done** |
| 4 | **vue-ui 1.0 shell**: `PukekoCopilot` exposes `uiMode: 'bespoke' \| 'stock' \| 'headless'` via the `@galvanized-pukeko/vue-ui/copilot` sub-export (CopilotKit kept an optional peer dep, out of the core bundle). Release cut deferred to the coordinator. | **done (API landed; version bump pending)** |
| 5 | **e2e**: Playwright specs for stock + headless authored and wired into `it-gth-ag-ui` (`chat-gth-stock.spec.ts`, `chat-gth-headless.spec.ts`). | **done (specs + runner; live run is the coordinator's integration step)** |

### How increments 2–5 landed

- **The A2UI bridge** is `A2UIToolSurface.vue` (CopilotKit-free, lives in
  `components/a2ui/`) + `copilot/A2UIRenderToolBridge.vue` (registers a
  `useRenderTool` for `show_a2ui_surface`). Our backend emits A2UI as a *tool
  call* with a custom JSONL result — NOT CopilotKit's own `render_a2ui` tool nor
  an AG-UI ActivityMessage — so CopilotKit's built-in A2UI renderer never fires
  for it; the custom render-tool renders it through our existing A2UI catalog
  instead. The chosen path is the brief's "bridge to `A2UIRenderer.vue`" option
  (not the provider's `a2ui` prop, which targets CopilotKit's own A2UI protocol).
  A2UI user actions are delivered back to the agent as a follow-up user message +
  `copilotkit.runAgent` (same AG-UI POST the composer issues).
- **Headless mode** = `copilot/HeadlessChat.vue` (+ `HeadlessChatApp.vue`
  provider shell). It projects `agent.messages` into bespoke chat bubbles via the
  pure `useHeadlessChat.toBubbles` helper and owns the run lifecycle through
  CopilotKit core. Spike-1's conclusion holds: gsloth's C-a server flow + a
  CopilotKit `useFrontendTool` registration *is* the interrupt/resume, so no
  bespoke `chatService.runLoop` is needed in headless mode.
- **The shell** (`copilot/PukekoCopilot.vue`) switches `bespoke`→`CoreApp`,
  `stock`→`StockChatApp`, `headless`→`HeadlessChatApp`. It's exported from a
  SEPARATE entry `@galvanized-pukeko/vue-ui/copilot` (built by
  `vite.copilot.config.ts`, ES+CJS, `@copilotkit/vue` externalized) so the core
  library root never pulls in CopilotKit. `@copilotkit/vue` is an OPTIONAL peer
  dependency. The web-client selects the mode via `?ui=stock|headless` →
  `CopilotApp.vue`.
- **Tests:** unit (`vitest`, new vue-ui suite) covers `toBubbles` (6 cases) and
  `A2UIToolSurface` mount/action/error (4 cases) — 10 green. A backend-less
  render smoke confirmed all three modes mount with zero console/page errors.
  E2e specs compile + are discovered by Playwright and wired into the runner.

### What already existed (pre-P2b)

- A complete bespoke AG-UI client (`vue-ui/src/services/chatService.ts`) whose
  `runLoop` **already mirrors CopilotKit's `run-handler.ts`** (interrupt/resume,
  message queueing, operator stop). This is the reference behaviour the
  CopilotKit modes must match.
- A working A2UI renderer (`vue-ui/src/components/a2ui/*`) and catalog.
- Bespoke chat UI (`ChatInterface.vue`, `CoreApp.vue`) — the legacy mode we keep
  as `uiMode: 'bespoke'`.
- No prior CopilotKit dependency (confirmed: nothing under `@copilotkit/*`).

## Where the modes live (after increments 2–4)

All CopilotKit-backed code now lives in the **vue-ui library** under
`packages/galvanized-pukeko-vue-ui/src/copilot/`, exported from the separate
`@galvanized-pukeko/vue-ui/copilot` entry (`src/copilot.ts`, built by
`vite.copilot.config.ts`):

- `copilot/PukekoCopilot.vue` — the `uiMode` shell (bespoke / stock / headless).
- `copilot/StockChatApp.vue` — `CopilotKitProvider` + `CopilotChat` + A2UI bridge.
- `copilot/HeadlessChatApp.vue` + `copilot/HeadlessChat.vue` — bespoke chat
  primitives driven by CopilotKit composables.
- `copilot/A2UIRenderToolBridge.vue` — `useRenderTool` for `show_a2ui_surface`.
- `components/a2ui/A2UIToolSurface.vue` — CopilotKit-free A2UI surface renderer
  (shared rendering half of the bridge).
- `copilot/useHeadlessChat.ts` — pure `agent.messages` → chat-bubble projection.

Host wiring: `packages/galvanized-pukeko-web-client/src/main.ts` →
`CopilotApp.vue` (`?ui=stock|headless`, default bespoke). The old
`web-client/src/StockChatApp.vue` was removed (superseded by the library shell).
`@copilotkit/vue@1.60.1` stays in the web-client deps and is now an OPTIONAL peer
dep of vue-ui.

## Open questions / decisions

- **Final home of the modes — DECIDED (increment 4).** The modes live in vue-ui
  behind a separate `/copilot` sub-export, with `@copilotkit/vue` as an
  **optional peer dependency** (NOT a hard dep). The core library root bundle
  (`vue-ui.es.js`) never imports CopilotKit; only `copilot.es.js` does (and it's
  externalized there). Apps opt into the dep tree by importing `/copilot`.
- **`@ag-ui/client` version skew** (ours 0.0.56 vs CopilotKit's 0.0.57). Handled
  by sourcing `HttpAgent` from `@copilotkit/vue/v2` in every CopilotKit mode, so
  agents are the exact class identity CopilotKit core expects. The bespoke
  `chatService` still uses our own 0.0.56 `HttpAgent`; the two paths never share
  an agent instance, so the skew is contained.
- **Styling.** Stock mode imports `@copilotkit/vue/styles.css`; the `/copilot`
  build emits its own `dist/copilot.css` (exported as `./copilot/style.css`) so
  it can't clobber the root `vue-ui.css`. Full token reconciliation with
  CopilotKit's CSS is still a polish task.
- **Client tools in stock/headless mode.** The render + run plumbing is in place
  (A2UI surfaces round-trip via a follow-up user message). A *live* check of the
  full client-tool interrupt/resume (e.g. webcam `capture_image`) through the
  CopilotKit modes still wants an end-to-end run against the gsloth server — see
  spike-1's residual note. Headless registers client tools via `useFrontendTool`.
- **Release cut.** Increment 4's API has landed but the vue-ui version bump /
  publish is left to the coordinator (per the worktree workflow).
