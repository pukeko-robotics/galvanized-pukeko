# Agents

## Working Repositories

The repositories we are working on are:

- `packages/galvanized-pukeko-agent-adk` — Java Spring Boot ADK agent (backend)
- `packages/galvanized-pukeko-vue-ui` — Vue UI source (compiled and deployed to web-client)
- `packages/galvanized-pukeko-web-client` — Web client host (serves Vue UI build, owns `config.json` and Playwright tests)
- `packages/gaunt-sloth-assistant` — TypeScript CLI tool for agent workflows

## Committing

**Write the commit message to a file and commit with `git commit -F <file>` — never `git commit
-m`.** This is a hard safety rule, not a style preference. Inside double quotes bash treats a
backtick or `$(…)` as **shell command substitution**, so a message that quotes code the way ordinary
prose does is *executed* before git ever runs; that failure has already destroyed a working tree on
a developer machine. A file path carries no shell metacharacters, so with `-F` no part of the
message can reach a shell — and multi-paragraph bodies, quotes and trailers survive with no
escaping.

- **Create the message file with your file-write tool** — never `echo "..." > msg.txt` and never an
  unquoted heredoc. Both put the identical prose back into a shell argument one layer up, which is
  where this hazard silently returns.
- Messages are plain English: what changed and why. No code, no shell commands, no backticks, no
  markup.
- The same applies to any long prose on a command line — prefer `gh pr create --body-file` and
  `gh release create --notes-file` over `--body` / `--notes`.

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

This is a pnpm workspace (`packageManager: pnpm@11.3.0`), so use pnpm. Set the
next public version by hand (the 0.0.14/15/16 tags were verdaccio-local and never
public — public went 0.0.13 → 0.1.0), build, then publish:

```bash
cd packages/galvanized-pukeko-vue-ui
pnpm version 0.1.0 --no-git-tag-version   # or edit package.json by hand
pnpm run build                            # pnpm publish does NOT auto-build (no prepublishOnly)
pnpm publish                              # publishConfig sets access: public; add --no-git-checks if the tree is dirty
```

Then bump each consumer's `@galvanized-pukeko/vue-ui` pin and reinstall.
