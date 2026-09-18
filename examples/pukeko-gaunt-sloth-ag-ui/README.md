# Pukeko + Gaunt Sloth AG-UI Example

This example demonstrates the Galvanized Pukeko web client communicating with Gaunt Sloth via the AG-UI protocol.

## Prerequisites

- Node.js 24+
- npm 11+
- An LLM provider — either an `OPENAI_API_KEY`, or a local [Ollama](https://ollama.com) daemon,
  which needs no key. See [Choosing a provider](#choosing-a-provider).

## Quick Start

From this directory:

```bash
node start.js
```

This will:
1. Start Gaunt Sloth in AG-UI server mode, on port 3000 by default
2. Start the Galvanized Pukeko web client, on port 5555 by default (pointed at Gaunt Sloth)
3. Open your browser to http://localhost:5555

Both ports come from the repository-root `.env` when there is one; see [Ports](#ports) below.

Press `Ctrl+C` to stop all services.

## Manual Start

Start each service in separate terminals:

**Terminal 1 — Gaunt Sloth AG-UI server:**

This example has no `node_modules` of its own; Gaunt Sloth comes from the repository
root. Run its installed binary directly, from this directory:

```bash
../../node_modules/.bin/gaunt-sloth-api ag-ui
```

Started this way it discovers `.gsloth.config.json` from the working directory, so it always runs
the fallback provider — `GTH_LLM_PROVIDER` is read by the launchers, not by the binary. Name the
file yourself to run another one:

```bash
../../node_modules/.bin/gaunt-sloth-api ag-ui --config .gsloth.config.ollama.json
```

**Terminal 2 — Web client (with AG-UI URL):**
```bash
cd ../../packages/galvanized-pukeko-web-client
AGUI_URL=http://localhost:3000/agents/default/run npm run dev
```

Then open http://localhost:5555 in your browser.

## Configuration

### Choosing a provider

`GTH_LLM_PROVIDER` picks which of this directory's Gaunt Sloth configurations the launchers run.
Leave it unset and you get `openai`, the documented fallback — which is the historical behaviour of
this example and needs an `OPENAI_API_KEY`.

| `GTH_LLM_PROVIDER` | Configuration file | Needs a key |
|---|---|---|
| unset, or `openai` | `.gsloth.config.json` | yes — `OPENAI_API_KEY` |
| `ollama` | `.gsloth.config.ollama.json` | no — a local Ollama daemon |

```bash
# No API key: run against a local Ollama daemon
GTH_LLM_PROVIDER=ollama node start.js
```

The Ollama configuration expects `gemma4:12b` and the daemon on `http://127.0.0.1:11434`; point
elsewhere with `OLLAMA_HOST`, or edit the `model` in that file.

`OLLAMA_HOST` also keys the GPU lock that the `it-gth-ag-ui` harness takes before it drives a local
model, so two runs against one daemon queue rather than collide — including a run in another
repository that shares the daemon. Two daemons at different addresses do not block each other. The
interactive `start.js` above does not take that lock: its session has no end, and a lock sized for
a test run would be reclaimed out from under it. If you are running a demo and a test at the same
time against one card, expect them to fight; that is the case the lock cannot cover.

A provider that names no configuration file ends the run and lists the ones that exist, rather than
quietly starting on the fallback — a server running a model you did not choose is worse than one
that refuses to start.

### Adding a provider

Drop a `.gsloth.config.<provider>.json` in this directory and `GTH_LLM_PROVIDER=<provider>` finds it;
the selection is by convention and no launcher needs editing. Providers other than the two above
also need their LangChain package installed at the repository root (`@gaunt-sloth/core` declares
them as peer dependencies and imports them on demand), so add e.g. `@langchain/anthropic` alongside
the config file.

### Why selection and not interpolation

A Gaunt Sloth JSON config has no environment interpolation, so the provider cannot be a `${VAR}`
inside `.gsloth.config.json`.

The alternative is a `.gsloth.config.js` module config whose `configure()` reads the environment.
Up to and including `2.0.0-beta.7` that route carried two silent failure modes, both fixed in Gaunt
Sloth under CFG-71 and both absent from the version pinned here:

- Returning a raw `{ type, model }` spec was never provider-routed, so it arrived as a plain object
  with no `invoke` while the JSON branch routed the identical block correctly.
- Returning an already-built model instance was flattened once the developer had a global
  `~/.gsloth/.gsloth.config.json`, because the global layer is deep-merged underneath the project
  layer and that merge walked the instance into a plain object, losing its prototype.

This example still selects between declarative JSON files, for the reasons that never depended on
those defects: it needs no `@gaunt-sloth/core` dependency here, and it leaves two short files a
reviewer can read and diff. See `scripts/llm-config.mjs`.

### Ports

`start.js` reads the repository-root `.env` and takes the AG-UI port from `GTH_AGUI_PORT` and the
web client's port from `WEB_PORT`, falling back to 3000 and 5555 when the file or the variable is
absent. It passes the resolved port to `gaunt-sloth-api` as `--port`, which wins over the
`commands.api.port` in `.gsloth.config.json`; `--config` names the configuration file outright, so a
missing one ends the run instead of falling back to whatever the working directory happens to hold.

Setting `GTH_AGUI_PORT` is how you move the AG-UI server off port 3000 — editing
`commands.api.port` alone will not, because the flag outranks it.

`WEB_PORT` moves the web client, and the AG-UI server follows it: the browser refuses a
cross-origin request unless the server names the page's own origin, port included, so `start.js`
passes the resolved `http://localhost:<WEB_PORT>` to `gaunt-sloth-api` as `--cors-origin`, over the
`cors.allowOrigin` pinned in `.gsloth.config.json`. Set `GTH_CORS_ORIGIN` if the page is served from
somewhere else again — behind a proxy, or under a hostname that is not `localhost`.

That flag needs a `@gaunt-sloth/agent` that has it — the version this repository pins. An older one
refuses the option it does not recognise, so the symptom is that the server does not start at all,
rather than starting with the wrong origin.

## How It Works

```
┌────────────────┐          AG-UI (SSE)          ┌──────────────┐
│  Pukeko Web    │◄──────────────────────────────►│ Gaunt Sloth  │
│  Client :5555  │  POST /agents/{agentId}/run    │  API :3000   │
└────────────────┘                                └──────────────┘
                                            │
                                            ▼
                                      ┌──────────┐
                                      │  LLM API │
                                      └──────────┘
```

- The web client sends chat messages as AG-UI `RunAgentInput` POST requests
- Gaunt Sloth processes them through LangChain/LangGraph and streams AG-UI events back
- Events: `RUN_STARTED → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT* → TEXT_MESSAGE_END → RUN_FINISHED`

## Related

- [Gaunt Sloth Assistant](https://github.com/pukeko-robotics/gaunt-sloth)
- [Galvanized Pukeko Web Client](../../packages/galvanized-pukeko-web-client/README.md)
