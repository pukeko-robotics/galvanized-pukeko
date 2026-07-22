import { describe, it, expect, vi } from 'vitest'
import { nextTick, toRaw } from 'vue'
import { mount } from '@vue/test-utils'
import StockChatApp from './StockChatApp.vue'
import PukekoCopilot from './PukekoCopilot.vue'

/**
 * PLAT-29: the stock CopilotKit surface exposes `frontendTools` and forwards it
 * to `CopilotKitProvider` — same contract PLAT-18 gave the headless surface, so
 * stock-surface hosts can register the shared `capture_image` (or any client
 * tool) without forking.
 *
 * `@copilotkit/vue/v2` is mocked with recording stubs: the provider stub
 * declares the real prop names, so `findComponent(...).props()` shows exactly
 * what StockChatApp bound to it. Vue wraps prop values in a reactive proxy, so
 * we compare `toRaw(received)` to prove the host's *same backing array* reaches
 * the provider (forwarded, not dropped or copied), and re-render to prove the
 * reference is stable — the contract PLAT-18 set: a fresh array per render would
 * churn the provider.
 */
vi.mock('@copilotkit/vue/v2', async () => {
  const { defineComponent, h } = await import('vue')
  const CopilotKitProvider = defineComponent({
    name: 'CopilotKitProvider',
    props: ['selfManagedAgents', 'frontendTools'],
    setup(_, { slots }) {
      return () => h('div', { class: 'copilotkit-provider-stub' }, slots.default?.())
    },
  })
  const CopilotChat = defineComponent({
    name: 'CopilotChat',
    setup() {
      return () => h('div', { class: 'copilot-chat-stub' })
    },
  })
  class HttpAgent {
    url: string
    constructor(opts: { url: string }) {
      this.url = opts.url
    }
  }
  return { CopilotKitProvider, CopilotChat, HttpAgent }
})

/**
 * A2UIRenderToolBridge uses CopilotKit composables the mock doesn't provide —
 * stub it out. An explicit `agUiUrl` also short-circuits `configService.get()`
 * (unloaded in the unit env), so the tests focus purely on prop passthrough.
 */
const mountOpts = (props: Record<string, unknown> = {}) => ({
  props: { agUiUrl: 'http://test.local/agents/default/run', ...props },
  global: { stubs: { A2UIRenderToolBridge: true } },
})

const findProvider = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findComponent({ name: 'CopilotKitProvider' })

describe('StockChatApp frontendTools passthrough (PLAT-29)', () => {
  it('forwards the frontendTools array to CopilotKitProvider by identity', async () => {
    const frontendTools = [{ name: 'capture_image', handler: vi.fn() }]
    const wrapper = mount(StockChatApp, mountOpts({ frontendTools }))

    const provider = findProvider(wrapper)
    expect(provider.exists()).toBe(true)
    // Same backing array reaches the provider (reactive proxy unwrapped).
    const first = provider.props('frontendTools')
    expect(toRaw(first)).toBe(frontendTools)

    // Stable across a re-render — not a fresh array each render.
    wrapper.vm.$forceUpdate()
    await nextTick()
    expect(provider.props('frontendTools')).toBe(first)
  })

  it('defaults to an empty array when the prop is omitted (headless parity)', () => {
    const wrapper = mount(StockChatApp, mountOpts())

    const provider = findProvider(wrapper)
    expect(provider.props('frontendTools')).toEqual([])
    // The rest of the surface is unchanged: agent wiring + chat still render.
    expect(provider.props('selfManagedAgents')).toHaveProperty('default')
    expect(wrapper.find('.copilot-chat-stub').exists()).toBe(true)
  })

  it('renders identically with the prop omitted vs an explicit empty default', () => {
    const omitted = mount(StockChatApp, mountOpts())
    const explicit = mount(StockChatApp, mountOpts({ frontendTools: [] }))
    expect(omitted.html()).toBe(explicit.html())
  })

  it('PukekoCopilot forwards frontendTools to the stock surface', () => {
    const frontendTools = [{ name: 'capture_image', handler: vi.fn() }]
    const wrapper = mount(PukekoCopilot, mountOpts({ uiMode: 'stock', frontendTools }))

    const provider = findProvider(wrapper)
    expect(provider.exists()).toBe(true)
    expect(toRaw(provider.props('frontendTools'))).toBe(frontendTools)
  })
})
