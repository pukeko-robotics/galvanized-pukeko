# Agents

## Working Repositories

The repositories we are working on are:

- `packages/galvanized-pukeko-agent-adk` — Java Spring Boot ADK agent (backend)
- `packages/galvanized-pukeko-vue-ui` — Vue UI source (compiled and deployed to web-client)
- `packages/galvanized-pukeko-web-client` — Web client host (serves Vue UI build, owns `config.json` and Playwright tests)
- `packages/gaunt-sloth-assistant` — TypeScript CLI tool for agent workflows

## Copies for Reference

Copies of important dependencies are available in the `./_readonly` directory for reference (do not edit):

- `./_readonly/langchainjs`
- `./_readonly/langgraphjs`
- `./_readonly/adk-java`
- `./_readonly/ag-ui` — AG-UI protocol SDKs
  - TypeScript SDK: `sdks/typescript/`
  - Java community SDK: `sdks/community/java/` (Spring server library at `servers/spring/`)

## NPM builds

From root directory:
    - `it-gth` - run integration tests for Gaunt Sloth Assistant
    - `test-gth` - run unit tests for Gaunt Sloth Assistant
    - `it-adk` - run integration tests for ADK agent
    - `it-adk-headed` - run integration tests for ADK agent in headed mode

## Playwright tests

- Config: `./playwright.config.ts` (base URL `http://localhost:5555`)
- Specs: `./e2e/` (e.g. `chat.spec.ts`)
- Integration test runners start required services before invoking Playwright

## Maven builds

Global maven is not available on this machine use `./mvnw` for java projects (`packages/galvanized-pukeko-agent-adk`)

## Publishing `@galvanized-pukeko/vue-ui`

`vue-ui` is published to the **public** npm registry. `@gaunt-sloth/*` is
consumed from public npm too (the `2.0.0-alpha.x` line), so there is no local
registry and no cross-repo `file:` redirect. To cut a `vue-ui` release:

```bash
cd packages/galvanized-pukeko-vue-ui
npm version patch --no-git-tag-version   # or set the next public patch by hand
npm run build
npm publish --access public
```

Then bump each consumer's `@galvanized-pukeko/vue-ui` pin and reinstall.
