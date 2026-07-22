import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import HeadlessChat from './HeadlessChat.vue'

/**
 * PLAT-13: run-error surfacing. CopilotKit core swallows a failed run
 * (`runAgent` resolves normally), so HeadlessChat subscribes to the agent's
 * own event stream and surfaces RUN_ERROR / run-failure in the existing
 * error banner — the headless equivalent of the bespoke chatService's
 * `console.error` + `onError` path. Without it a mid-run server error (e.g.
 * a failed resume after a client-tool fulfilment) ends the run silently.
 *
 * Same CopilotKit mock strategy as HeadlessChatChrome.spec.ts, with the agent
 * fake additionally exposing `subscribe` so the test can drive the captured
 * subscriber.
 */
const mocks = vi.hoisted(() => ({
  runAgent: vi.fn(),
  agentRef: { value: null as unknown as Record<string, unknown> },
}))

vi.mock('@copilotkit/vue/v2', () => ({
  useCopilotKit: () => ({ copilotkit: { value: { runAgent: mocks.runAgent } } }),
  useAgent: () => ({ agent: mocks.agentRef }),
}))

interface CapturedSubscriber {
  onRunErrorEvent?: (params: { event: { message?: string } }) => void
  onRunFailed?: (params: { error?: { message?: string } }) => void
}

function setAgentWithSubscribe() {
  const captured: { subscriber: CapturedSubscriber | null } = { subscriber: null }
  const unsubscribe = vi.fn()
  mocks.agentRef.value = {
    messages: [],
    addMessage: vi.fn(),
    abortRun: vi.fn(),
    setMessages: vi.fn(),
    isRunning: false,
    subscribe: vi.fn((s: CapturedSubscriber) => {
      captured.subscriber = s
      return { unsubscribe }
    }),
  }
  return { captured, unsubscribe }
}

beforeEach(() => {
  mocks.runAgent.mockClear()
})

describe('HeadlessChat run-error surfacing (PLAT-13)', () => {
  it('shows a RUN_ERROR frame in the error banner and logs it', async () => {
    const { captured } = setAgentWithSubscribe()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })

    expect(wrapper.find('[data-testid="pk-headless-error"]').exists()).toBe(false)
    captured.subscriber!.onRunErrorEvent!({
      event: { message: 'System messages are only permitted as the first passed message.' },
    })
    await nextTick()

    const banner = wrapper.find('[data-testid="pk-headless-error"]')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('System messages are only permitted')
    expect(errSpy).toHaveBeenCalledWith(
      '[HeadlessChat] Run error:',
      'System messages are only permitted as the first passed message.',
    )
    errSpy.mockRestore()
  })

  it('shows a run failure (onRunFailed) in the error banner', async () => {
    const { captured } = setAgentWithSubscribe()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })

    captured.subscriber!.onRunFailed!({ error: { message: 'network down' } })
    await nextTick()

    expect(wrapper.find('[data-testid="pk-headless-error"]').text()).toContain('network down')
    errSpy.mockRestore()
  })

  it('unsubscribes from the agent when unmounted', () => {
    const { unsubscribe } = setAgentWithSubscribe()
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })
    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('still mounts against a minimal agent fake without subscribe (defensive)', () => {
    mocks.agentRef.value = {
      messages: [],
      addMessage: vi.fn(),
      abortRun: vi.fn(),
      setMessages: vi.fn(),
      isRunning: false,
    }
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })
    expect(wrapper.find('[data-testid="pk-headless-chat"]').exists()).toBe(true)
  })
})
