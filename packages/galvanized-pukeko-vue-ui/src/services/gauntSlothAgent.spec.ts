/// <reference types="node" />
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mount } from '@vue/test-utils'
import { HttpAgent } from '@ag-ui/client'
import { GauntSlothAgent, GAUNT_SLOTH_AG_UI_MAX_VERSION } from './gauntSlothAgent'
import { ChatService } from './chatService'
import { configService, type UiConfig } from './configService'
import HeadlessChatApp from '../copilot/HeadlessChatApp.vue'
import StockChatApp from '../copilot/StockChatApp.vue'

/**
 * PLAT-55: vue-ui never declared an AG-UI `maxVersion`, so every surface
 * inherited one from whichever `@ag-ui/client` copy it imported. These specs pin
 * the declaration itself, pin all four construction sites to the one class that
 * makes it, and pin the two external facts the literal depends on.
 *
 * WHY `toBeInstanceOf(GauntSlothAgent)` AND NOT ONLY THE VERSION STRING. The
 * declared literal currently equals the installed `@ag-ui/client` version, so a
 * bare `maxVersion === '0.0.59'` assertion passes just as well with the whole
 * subclass deleted and every site back on a bare `HttpAgent` — it cannot fail
 * for the reason it exists. The `instanceof` check is what actually discriminates,
 * so every site carries one.
 */

/** The four sites construct through `configService`; load it without a network. */
function withConfig(agUiUrl = 'http://config.test/agents/default/run'): void {
  ;(configService as unknown as { config: UiConfig | null }).config = { agUiUrl }
}

/** Reach the private field the two chatService sites assign. */
const agentOf = (svc: ChatService) => (svc as unknown as { agent: HttpAgent | null }).agent

/**
 * Stub CopilotKit's UI so mounting stays cheap, but deliberately DO NOT stub the
 * agent class: `HttpAgent` is re-exported here exactly as the real module does
 * it, so a site reverted to CopilotKit's `HttpAgent` still constructs something
 * — and fails the `instanceof GauntSlothAgent` check rather than dying on an
 * undefined constructor. That keeps the mutation's red about the assertion.
 */
vi.mock('@copilotkit/vue/v2', async () => {
  const { defineComponent, h } = await import('vue')
  const { HttpAgent: RealHttpAgent } = await import('@ag-ui/client')
  const CopilotKitProvider = defineComponent({
    name: 'CopilotKitProvider',
    props: ['selfManagedAgents', 'frontendTools'],
    setup(_, { slots }) {
      return () => h('div', { class: 'copilotkit-provider-stub' }, slots.default?.())
    },
  })
  const CopilotChat = defineComponent({
    name: 'CopilotChat',
    setup: () => () => h('div', { class: 'copilot-chat-stub' }),
  })
  return { CopilotKitProvider, CopilotChat, HttpAgent: RealHttpAgent }
})

/**
 * An explicit `agUiUrl` short-circuits `configService.get()` (unloaded in the
 * unit env); the inner surfaces use CopilotKit composables the mock does not
 * provide, so they are stubbed out — same shape as StockChatAppFrontendTools.
 */
const mountOpts = () => ({
  props: { agUiUrl: 'http://mounted.test/agents/default/run' },
  global: { stubs: { A2UIRenderToolBridge: true, HeadlessChat: true } },
})

/** Pull the agent the surface handed CopilotKit out of the provider's props. */
const agentHandedToCopilotKit = (wrapper: ReturnType<typeof mount>) => {
  const provider = wrapper.findComponent({ name: 'CopilotKitProvider' })
  expect(provider.exists()).toBe(true)
  return (provider.props('selfManagedAgents') as Record<string, unknown>).default
}

describe('GauntSlothAgent declares the AG-UI protocol level (PLAT-55)', () => {
  it('reports the declared literal, not the @ag-ui/client package version', () => {
    const agent = new GauntSlothAgent({ url: 'http://declared.test/run' })
    expect(agent.maxVersion).toBe(GAUNT_SLOTH_AG_UI_MAX_VERSION)
    // The override is what produces it: a bare HttpAgent returns its own
    // package version from the same getter.
    expect(agent).toBeInstanceOf(GauntSlothAgent)
  })

  it('declares maxVersion ITSELF rather than inheriting the package default', () => {
    // The load-bearing assertion of this file. The declared literal happens to
    // equal the installed @ag-ui/client version today, so `agent.maxVersion ===
    // '0.0.59'` passes just as well with the override deleted — it would go on
    // passing while the class silently reverted to inheriting. This names the
    // override itself, so deleting it fails.
    const own = Object.getOwnPropertyDescriptor(GauntSlothAgent.prototype, 'maxVersion')
    expect(own?.get, 'GauntSlothAgent must define its own maxVersion getter').toBeTypeOf('function')
    // Called on a bare object: the getter must yield the module constant with no
    // dependence on instance state. That is not a stylistic point — AbstractAgent
    // reads it while `super()` runs, before any field initialiser, so a getter
    // backed by an instance field returns undefined (a `#private` one throws).
    expect(own?.get?.call({})).toBe(GAUNT_SLOTH_AG_UI_MAX_VERSION)
  })

  it('stays above the 0.0.57 gate, so no compatibility middleware is inserted', () => {
    // In @ag-ui/client 0.0.59 the gates are <=0.0.39, <=0.0.45, <=0.0.47 and
    // <=0.0.57. Declaring 0.0.57 or below prepends BackwardCompatibility_0_0_57,
    // which strips `subagentRunId` outbound and drops SUBAGENT_* events inbound —
    // a silent downgrade against a gaunt-sloth server that speaks subagents.
    // If a future @ag-ui/client adds a gate ABOVE the declared level this goes
    // red, which is the point: someone must then re-decide the literal.
    const agent = new GauntSlothAgent({ url: 'http://gate.test/run' })
    const middlewares = (agent as unknown as { middlewares?: unknown[] }).middlewares ?? []
    expect(middlewares).toHaveLength(0)
  })
})

describe('all four construction sites go through GauntSlothAgent (PLAT-55)', () => {
  it('chatService.ensureAgent() — chatService.ts first site', () => {
    withConfig()
    const svc = new ChatService()
    svc.getThreadId() // drives ensureAgent()
    const agent = agentOf(svc)
    expect(agent).toBeInstanceOf(GauntSlothAgent)
    expect(agent?.maxVersion).toBe(GAUNT_SLOTH_AG_UI_MAX_VERSION)
  })

  it('chatService.resetThread() — chatService.ts second site', () => {
    withConfig()
    const svc = new ChatService()
    svc.resetThread()
    const agent = agentOf(svc)
    expect(agent).toBeInstanceOf(GauntSlothAgent)
    expect(agent?.maxVersion).toBe(GAUNT_SLOTH_AG_UI_MAX_VERSION)
  })

  it('HeadlessChatApp.vue hands CopilotKit a GauntSlothAgent', () => {
    const agent = agentHandedToCopilotKit(mount(HeadlessChatApp, mountOpts()))
    expect(agent).toBeInstanceOf(GauntSlothAgent)
    expect((agent as GauntSlothAgent).maxVersion).toBe(GAUNT_SLOTH_AG_UI_MAX_VERSION)
  })

  it('StockChatApp.vue hands CopilotKit a GauntSlothAgent', () => {
    const agent = agentHandedToCopilotKit(mount(StockChatApp, mountOpts()))
    expect(agent).toBeInstanceOf(GauntSlothAgent)
    expect((agent as GauntSlothAgent).maxVersion).toBe(GAUNT_SLOTH_AG_UI_MAX_VERSION)
  })
})

describe('the declared literal is tied to the facts it was derived from (PLAT-55)', () => {
  /**
   * The drift check the node asked for: the declaration means "the protocol
   * level of the gaunt-sloth release vue-ui targets", and that is readable from
   * the installed manifest rather than trusted to memory. vue-ui does not depend
   * on gaunt-sloth itself, so this reaches the workspace root — the anchor is the
   * repository's own pin, and this spec only ever runs inside the workspace.
   */
  it('matches the AG-UI level @gaunt-sloth/agent targets', () => {
    // Resolved against THIS FILE's directory, not the process cwd, and via
    // `import.meta.dirname` rather than `new URL(..., import.meta.url)` — Vite
    // rewrites the latter into a served asset URL, which then fails as "The URL
    // must be of scheme file" (same reason theme.spec.ts spells it this way).
    const manifest = JSON.parse(
      readFileSync(
        `${import.meta.dirname}/../../../../node_modules/@gaunt-sloth/agent/package.json`,
        'utf8',
      ),
    ) as { version: string; dependencies: Record<string, string> }

    // `^0.0.x` is an exact pin in semver, so the range's base IS the level.
    const core = manifest.dependencies['@ag-ui/core']
    const encoder = manifest.dependencies['@ag-ui/encoder']
    expect(core, '@gaunt-sloth/agent must still declare @ag-ui/core').toBeTruthy()
    expect(encoder).toBe(core)
    expect(core.replace(/^[\^~]/, '')).toBe(GAUNT_SLOTH_AG_UI_MAX_VERSION)
  })

  /**
   * The duplicate-copy guard. PLAT-55 was filed because `@copilotkit/vue@1.66.4`
   * pinned `@ag-ui/client` at an exact 0.0.57 while vue-ui moved to ^0.0.59,
   * which loaded two protocol implementations into one app. OPS-108 collapsed
   * that by moving CopilotKit to 1.70.0, which pins the same 0.0.59 — but a
   * caret on 0.0.x is an exact pin, so the copies coincide only because two
   * independent pins name the same version today. Either side moving re-splits
   * them, and nothing else in the repo would notice. This is also what makes one
   * GauntSlothAgent acceptable to CopilotKit at all.
   */
  it('resolves exactly one @ag-ui/client, shared with @copilotkit/vue', () => {
    const here = createRequire(`${import.meta.dirname}/gauntSlothAgent.spec.ts`)
    const mine = realpathSync(here.resolve('@ag-ui/client/package.json'))
    const viaCopilotKit = realpathSync(
      createRequire(realpathSync(here.resolve('@copilotkit/vue/package.json'))).resolve(
        '@ag-ui/client/package.json',
      ),
    )
    // Deliberately NOT asserting either copy's version against the declared
    // literal. They coincide today, but tying them would re-create exactly the
    // "inherit whatever the client library happens to be" behaviour this node
    // removes: the declaration tracks the SERVER, not the client package.
    expect(viaCopilotKit, 'CopilotKit resolves a second @ag-ui/client copy').toBe(mine)
  })
})
