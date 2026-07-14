# Pukeko + Koog AG-UI Example

A greenfield **Koog (Kotlin + Ktor)** agent that speaks the AG-UI protocol using the
community **AG-UI Kotlin core types** (`com.ag-ui.community:kotlin-core`) plus a vendored
copy of the AG-UI `EventEncoder` (`koog-agent/.../EventEncoder.kt`, BE-7 — swap for
`com.ag-ui.community:kotlin-encoder` once BE-3's upstream PR publishes). It is the
sibling of [`pukeko-gaunt-sloth-ag-ui`](../pukeko-gaunt-sloth-ag-ui): the same Vue web
client, a different backend, the same wire.

An AG-UI server here is **not** a framework or a base class — it is a recipe:

> **core types + `EventEncoder` + your web framework (Ktor) + your agent (Koog).**

```
┌────────────────┐          AG-UI (SSE)          ┌──────────────────┐        ┌─────────┐
│  Pukeko Web    │◄──────────────────────────────►│  Koog AG-UI       │◄──────►│  LLM    │
│  Client :5555  │  POST /agents/default/run      │  server :3000     │ stream │ (OpenAI)│
└────────────────┘                                └──────────────────┘        └─────────┘
```

- `koog-agent/` — the Kotlin/Ktor server. `koogAgent(RunAgentInput): Flow<BaseEvent>`
  drives a Koog LLM stream and maps each `StreamFrame.TextDelta` to an AG-UI
  `TEXT_MESSAGE_CONTENT`, wrapped in the `RUN_STARTED → TEXT_MESSAGE_START →
  TEXT_MESSAGE_CONTENT* → TEXT_MESSAGE_END → RUN_FINISHED` lifecycle.
- `AgUiEndpoint.kt` — copied from the AG-UI Kotlin server-starter reference (package
  renamed). Decodes the body pre-writer (bad body → 4xx), builds a per-request
  `EventEncoder(Accept)`, streams `encoder.encode(event)` over `respondBytesWriter`.
- `start.js` — spawns the server and the web client together (mirrors the gaunt-sloth
  example).

## Prerequisites

- **JDK 21** (required — the AG-UI encoder artifact is JVM-21 bytecode; a JDK-17 build
  cannot consume it). Point Gradle at it:
  ```bash
  export JAVA_HOME=/usr/lib/jvm/java-21-openjdk   # confirm with: archlinux-java status
  ```
- The AG-UI Kotlin SDK `com.ag-ui.community:kotlin-core` at `0.4.1` published to
  **mavenLocal** (the coordinator publishes it). The `EventEncoder` is vendored in-tree
  (BE-7), so `:kotlin-encoder` is no longer needed.
- An LLM: `OPENAI_API_KEY` in the environment (default), or a local Ollama.
- Node 24+ / pnpm (only for the optional web-client path).

## Run the server

```bash
cd koog-agent
JAVA_HOME=/usr/lib/jvm/java-21-openjdk AGUI_PORT=3000 ./gradlew run
```

Then POST a `RunAgentInput` and watch the SSE stream:

```bash
curl -N -X POST http://localhost:3000/agents/default/run \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"threadId":"t1","runId":"r1","messages":[{"id":"m1","role":"user","content":"What is a takahe?"}],"tools":[],"context":[],"state":{}}'
```

## Test

```bash
cd koog-agent
JAVA_HOME=/usr/lib/jvm/java-21-openjdk ./gradlew build
```

`KoogAgUiEndpointTest` uses ktor `testApplication` to round-trip the SSE wire through the
real encoder with a deterministic stub agent (no live LLM), asserting canonical
`data: {json}\n\n` framing, the ordered lifecycle, matched START/END message ids, and a
4xx on a malformed body.

## Configuration (env)

| Var              | Default                   | Meaning                                  |
|------------------|---------------------------|------------------------------------------|
| `LLM_PROVIDER`   | `openai`                  | `openai` or `ollama`                     |
| `OPENAI_API_KEY` | —                         | required for the OpenAI path             |
| `OPENAI_MODEL`   | `gpt-4o-mini`             | any OpenAI chat model id                 |
| `OLLAMA_BASE_URL`| `http://localhost:11434`  | Ollama server                            |
| `OLLAMA_MODEL`   | `granite4.1:3b`           | Ollama model id                          |
| `AGUI_PORT`/`PORT`| `3000`                   | server port                              |

## Web client (optional, end-to-end)

```bash
# from this directory, after `pnpm install` at the galvanized-pukeko root
node start.js
# then open http://localhost:5555
```

`start.js` starts the Koog server on :3000, then the Vue web client on :5555 with
`AGUI_URL=http://localhost:3000/agents/default/run`.

## Notes

- **Ktor is pinned to 3.3.3** to match the ktor **client** Koog 1.0.0 depends on, so a
  single ktor train (`ktor-io`/`ktor-utils`) sits on the classpath. See the BE-2 report.
- The consumer depends on the **encoder only** (plus core) — there is no AG-UI "server"
  module. The ~15-line `AgUiEndpoint.kt` is the whole server.
- `kotlinx-serialization-json` is declared explicitly because `kotlin-core` exposes it as
  `implementation`, so the `AgUiJson` calls here need it on the compile classpath.

## Related

- [Gaunt Sloth AG-UI example](../pukeko-gaunt-sloth-ag-ui/README.md)
- [Koog](https://github.com/JetBrains/koog)
- [AG-UI protocol](https://github.com/ag-ui-protocol/ag-ui)
