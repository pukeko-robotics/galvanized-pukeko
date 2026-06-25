# Pukeko + Gaunt Sloth AG-UI Example

This example demonstrates the Galvanized Pukeko web client communicating with Gaunt Sloth via the AG-UI protocol.

## Prerequisites

- Node.js 24+
- npm 11+
- A configured Gaunt Sloth config (`.gsloth.config.json`) with a valid LLM provider

## Quick Start

From this directory:

```bash
node start.js
```

This will:
1. Start Gaunt Sloth in AG-UI server mode on port 3000
2. Start the Galvanized Pukeko web client on port 5555 (pointed at Gaunt Sloth)
3. Open your browser to http://localhost:5555

Press `Ctrl+C` to stop all services.

## Manual Start

Start each service in separate terminals:

**Terminal 1 — Gaunt Sloth AG-UI server:**
```bash
npx gaunt-sloth-api ag-ui
```

**Terminal 2 — Web client (with AG-UI URL):**
```bash
cd ../../packages/galvanized-pukeko-web-client
AGUI_URL=http://localhost:3000/agents/default/run npm run dev
```

Then open http://localhost:5555 in your browser.

## Configuration

The example uses the Gaunt Sloth config from this directory (`.gsloth.config.json`). Edit this file to change the LLM provider or model.

The example ships with an OpenAI configuration. Set `OPENAI_API_KEY` in your environment or update `.gsloth.config.json` for a different provider.

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
