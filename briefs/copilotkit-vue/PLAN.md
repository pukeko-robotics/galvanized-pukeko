# CopilotKit Vue integration (P2b) — WIP plan

> Status: **in progress.** Increments 1 (stock-UI mode, AG-UI direct) and 2
> (A2UI in stock UI) landed; the rest is planned below. This is the working note
> for graph node **P2b**
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
| 1 | **Stock-UI mode**: `CopilotKitProvider` + `CopilotChat` wired to our AG-UI `HttpAgent`; selectable from the web-client; builds. | **done (this commit)** |
| 2 | **A2UI in stock UI**: bridge to `A2UIRenderer.vue` via `useRenderTool` — render the agent's `show_a2ui_surface` surfaces inside CopilotKit chat using our existing A2UI processor + catalog. | **done** |
| 3 | **Headless mode**: drive the bespoke Pukeko components (`PkForm`, charts, webcam client-tool) from CopilotKit composables; reconcile client-tool interrupt/resume with `chatService.runLoop`. | todo |
| 4 | **vue-ui 1.0 shell**: promote the chosen mode(s) into `@galvanized-pukeko/vue-ui`'s public API behind a config flag (`uiMode: 'bespoke' | 'stock' | 'headless'`); cut the 1.0 release. | todo |
| 5 | **e2e**: Playwright specs for stock + headless against both gaunt-sloth and ADK backends; wire into `it-gth-ag-ui` / `it-adk`. | todo |

### What already existed (pre-P2b)

- A complete bespoke AG-UI client (`vue-ui/src/services/chatService.ts`) whose
  `runLoop` **already mirrors CopilotKit's `run-handler.ts`** (interrupt/resume,
  message queueing, operator stop). This is the reference behaviour the
  CopilotKit modes must match.
- A working A2UI renderer (`vue-ui/src/components/a2ui/*`) and catalog.
- Bespoke chat UI (`ChatInterface.vue`, `CoreApp.vue`) — the legacy mode we keep
  as `uiMode: 'bespoke'`.
- No prior CopilotKit dependency (confirmed: nothing under `@copilotkit/*`).

## Where increment 1 lives

- `packages/galvanized-pukeko-web-client/src/StockChatApp.vue` — the stock-UI
  surface: provider + `CopilotChat`, agent built from config's `agUiUrl`.
- `packages/galvanized-pukeko-web-client/src/main.ts` — chooses `App` vs
  `StockChatApp` from a `?ui=stock` query flag (default stays bespoke).
- `@copilotkit/vue@1.60.1` added to the web-client's deps.

## Where increment 2 lives

- `packages/galvanized-pukeko-web-client/src/StockA2UISurface.vue` — registers a
  CopilotKit `useRenderTool` renderer for `show_a2ui_surface`. On tool-call
  completion it parses the JSONL `result` with `parseA2UIJsonl` and renders the
  resulting surfaces through the **shared** `A2UISurface` component + `useA2UI`
  processor (one processor instance per `toolCallId`).
- `packages/galvanized-pukeko-web-client/src/StockChatApp.vue` — mounts
  `<StockA2UISurface />` inside `CopilotKitProvider` (the hook needs the injected
  CopilotKit context).
- `@galvanized-pukeko/vue-ui` now publicly exports the A2UI bridge
  (`A2UISurface`, `A2UIRenderer`, `useA2UI`, `parseA2UIJsonl`, `A2UIContextKey`
  + types) so the host app reuses the bespoke A2UI renderer rather than
  duplicating one. `parseA2UIJsonl` was factored out of `ChatInterface.vue`'s
  inline brace-matcher so both paths parse the wire identically.
- `zod` added to the web-client deps (used to satisfy `useRenderTool`'s
  StandardSchema `parameters`).

**Scope of inc 2: display.** Agent surfaces render inside the stock chat thread.
Interactive A2UI *actions* (a Button submitting back) flow through `useA2UI`'s
`sendAction`, which resumes via the bespoke `chatService` tool-result wire;
in stock mode no `pendingToolCallId` is set on that path, so submit-back is a
deliberate no-op until **increment 3** reconciles client-tool interrupt/resume
with CopilotKit's own `useFrontendTool` / `use-interrupt`.

## Open questions / decisions

- **Final home of the modes.** Increment 1 puts stock UI in the *web-client*
  (host app) to avoid pulling `@copilotkit/vue`'s large dep tree into the
  published `@galvanized-pukeko/vue-ui` library before we've decided the 1.0
  API. Increment 4 must decide whether CopilotKit becomes a hard dep / peer dep
  / optional sub-export of vue-ui.
- **`@ag-ui/client` version skew** (ours 0.0.56 vs CopilotKit's 0.0.57). Handled
  for the stock path by sourcing `HttpAgent` from CopilotKit; revisit if the
  bespoke and stock paths ever need to share one agent instance.
- **Styling.** Stock mode imports `@copilotkit/vue/styles.css`; reconciling that
  with the Pukeko design tokens (`global.css`) is a 1.0 design task.
- **Client tools in stock mode.** Deferred to increment 3 — needs the
  server-side generalised interrupt to be in place to test against.
