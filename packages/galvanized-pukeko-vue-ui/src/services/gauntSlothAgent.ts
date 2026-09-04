import { HttpAgent } from '@ag-ui/client'

/**
 * The AG-UI protocol version this client declares to the server (PLAT-55).
 *
 * `maxVersion` is a CLIENT-SIDE declaration — it is never sent on the wire and
 * appears in no `@ag-ui/core` schema. `AbstractAgent` reads it exactly once, in
 * its constructor, to decide which `BackwardCompatibility_*` middleware to
 * prepend. Its meaning is "the highest protocol version the server I am talking
 * to speaks".
 *
 * Left undeclared, the getter returns the `@ag-ui/client` package's OWN version
 * — i.e. every surface silently asserts "whatever my client library happens to
 * be", which is correct only while client and server move together. This repo's
 * policy is that consumers pin gaunt-sloth deliberately, so a client sitting
 * ahead of the server it talks to is the normal steady state, and that is
 * exactly the direction in which the default over-claims.
 *
 * WHY THIS IS A LITERAL AND NOT A LOOKUP. It cannot be fetched from the server:
 * the getter is consulted synchronously while `super()` runs, so there is no
 * point at which an async capabilities probe could supply it. It also cannot be
 * an instance field — a field initialiser has not run when the base constructor
 * reads the getter, and a `#private` one throws outright — so the value must be
 * a module-level constant.
 *
 * WHY 0.0.59. It is the AG-UI level of the gaunt-sloth release this repo
 * targets: `@gaunt-sloth/agent@2.0.0-beta.5` depends on `@ag-ui/core` and
 * `@ag-ui/encoder` at `^0.0.59`. `gauntSlothAgent.spec.ts` asserts that
 * correspondence against the installed manifest, so bumping the gaunt-sloth pin
 * without revisiting this line fails the suite instead of drifting silently.
 *
 * This value is load-bearing, not decorative: in `@ag-ui/client@0.0.59` the
 * gates are `<= 0.0.39`, `<= 0.0.45`, `<= 0.0.47` and `<= 0.0.57`. Declaring
 * anything at or below `0.0.57` inserts `BackwardCompatibility_0_0_57`, which
 * strips `subagentRunId` from outbound messages and drops `SUBAGENT_*` events
 * from the stream. Against a gaunt-sloth server that speaks subagents, that
 * would be a silent downgrade.
 */
export const GAUNT_SLOTH_AG_UI_MAX_VERSION = '0.0.59'

/**
 * The `HttpAgent` every vue-ui surface constructs, so there is exactly ONE place
 * that states the protocol level this client assumes.
 *
 * Both the bespoke surface (`chatService`) and the CopilotKit-mounted surfaces
 * (`StockChatApp`, `HeadlessChatApp`) use this class. That is safe because
 * `@copilotkit/vue/v2` re-exports `@ag-ui/client`'s own `HttpAgent` (`export *
 * from "@ag-ui/client"`) and, since CopilotKit 1.70.0 pins `@ag-ui/client` at
 * the same `0.0.59` vue-ui resolves, both import paths reach the SAME module
 * instance — so this subclass satisfies the `AbstractAgent` identity check
 * `CopilotKitProvider` performs on `selfManagedAgents`. The spec pins that
 * single-copy property, because it is a coincidence of two pins agreeing rather
 * than a guarantee.
 *
 * It deliberately imports only from `@ag-ui/client` (external to both builds),
 * never from `@copilotkit/vue`, so the core bundle stays free of the CopilotKit
 * dependency tree — see `copilot.ts`.
 */
export class GauntSlothAgent extends HttpAgent {
  override get maxVersion(): string {
    return GAUNT_SLOTH_AG_UI_MAX_VERSION
  }
}
