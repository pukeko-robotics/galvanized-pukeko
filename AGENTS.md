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

`vue-ui` is the one public package here; the web-client and agent-adk packages are
private examples and are never published. `@gaunt-sloth/*` is consumed from public
npm too, so there is no local registry and no cross-repo `file:` redirect.

**Releases go through the `Release` workflow (`.github/workflows/release.yml`), and
only through it.** Never hand-run `npm publish` or `pnpm publish`: the workflow is
what runs the unit-test gate, publishes over npm Trusted Publishing (OIDC, no token
on anyone's machine), attaches provenance, and cuts the `vue-ui-v<version>` GitHub
release. Dispatching it is a by-hand step taken at a release milestone, by Andrew.

The versioning model is **release-current-then-post-bump**: a run ships whatever
version `packages/galvanized-pukeko-vue-ui/package.json` carries on `main`, and only
after a successful publish writes the next one back. So **the number on `main` is
always the next release, not the last** — `npm view @galvanized-pukeko/vue-ui` is the
only answer to what actually shipped. The dispatch inputs describe that post-bump.

Set a version with the bump script rather than by hand — it also derives
`publishConfig.tag` from the version, which is what stops a prerelease landing on
`latest`:

```bash
pnpm run release:bump -- 0.2.0            # explicit version
pnpm run release:bump -- prerelease alpha # or a semver verb + preid
pnpm run release:bump -- minor --dry-run  # compute only, write nothing
```

A stable version publishes to `latest`; a prerelease publishes to its own preid tag
(`alpha`/`beta`/`rc`) and leaves `latest` where it is. Consumers move to a new vue-ui
deliberately, by bumping their own pin to a version that is on the registry.
