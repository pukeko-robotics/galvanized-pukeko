import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HeadlessChat from './HeadlessChat.vue'

/**
 * PLAT-20: the bespoke-parity chrome added to the headless chat surface — the
 * empty-workplane PkLogoLarge placeholder, the New-Conversation reset (abort +
 * clear the CopilotKit agent thread), the send hint, and the UI-only greeting.
 *
 * Same CopilotKit mock strategy as HeadlessChatA2UI.spec.ts: `useAgent` yields a
 * `{ value }` holder whose agent we control per case; `abortRun`/`setMessages`
 * are spies so we can assert the reset calls the real AbstractAgent API rather
 * than hand-mutating internals.
 */
const mocks = vi.hoisted(() => ({
  runAgent: vi.fn(),
  addMessage: vi.fn(),
  abortRun: vi.fn(),
  setMessages: vi.fn(),
  agentRef: { value: null as unknown as Record<string, unknown> },
}))

vi.mock('@copilotkit/vue/v2', () => ({
  useCopilotKit: () => ({ copilotkit: { value: { runAgent: mocks.runAgent } } }),
  useAgent: () => ({ agent: mocks.agentRef }),
}))

/** A minimal A2UI surface (adapted from HeadlessChatA2UI.spec.ts). */
function surfaceJsonl(): string {
  const surfaceUpdate = {
    surfaceUpdate: {
      surfaceId: '@default',
      components: [
        { id: 'root', component: { Column: { children: { explicitList: ['title'] } } } },
        { id: 'title', component: { Text: { text: { literalString: 'Pick an option' }, usageHint: 'h3' } } },
      ],
    },
  }
  const beginRendering = { beginRendering: { surfaceId: '@default', root: 'root' } }
  return JSON.stringify(surfaceUpdate) + JSON.stringify(beginRendering)
}

/** An agent message log with a completed show_a2ui_surface tool call. */
function a2uiMessages() {
  return [
    {
      id: 'a1',
      role: 'assistant',
      toolCalls: [{ id: 'tc-1', function: { name: 'show_a2ui_surface', arguments: '{}' } }],
    },
    { id: 't1', role: 'tool', toolCallId: 'tc-1', content: surfaceJsonl() },
  ]
}

function setAgent(messages: unknown[]) {
  mocks.agentRef.value = {
    messages,
    addMessage: mocks.addMessage,
    abortRun: mocks.abortRun,
    setMessages: mocks.setMessages,
    isRunning: false,
  }
}

beforeEach(() => {
  mocks.runAgent.mockClear()
  mocks.addMessage.mockClear()
  mocks.abortRun.mockClear()
  mocks.setMessages.mockClear()
})

describe('HeadlessChat chrome (PLAT-20)', () => {
  it('shows the PkLogoLarge placeholder in the panel when the workplane is empty', () => {
    setAgent([])
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'panel' } })

    const placeholder = wrapper.find('[data-testid="pk-headless-waiting-placeholder"]')
    expect(placeholder.exists()).toBe(true)
    // No A2UI surface rendered yet.
    expect(wrapper.find('[data-testid="pk-headless-a2ui-panel"] .a2ui-surface').exists()).toBe(false)
  })

  it('replaces the placeholder with the A2UI surface once one arrives', () => {
    setAgent(a2uiMessages())
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'panel' } })

    // Surface present…
    const panel = wrapper.find('[data-testid="pk-headless-a2ui-panel"]')
    expect(panel.find('.a2ui-surface').exists()).toBe(true)
    expect(panel.text()).toContain('Pick an option')
    // …and the placeholder is gone.
    expect(wrapper.find('[data-testid="pk-headless-waiting-placeholder"]').exists()).toBe(false)
  })

  it('New Conversation aborts the run and clears the agent thread', async () => {
    setAgent(a2uiMessages())
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'panel' } })

    const btn = wrapper.find('[data-testid="pk-headless-new-conversation"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')

    expect(mocks.abortRun).toHaveBeenCalledTimes(1)
    expect(mocks.setMessages).toHaveBeenCalledTimes(1)
    // Cleared via the idiomatic AbstractAgent.setMessages([]) — an empty log.
    expect(mocks.setMessages).toHaveBeenCalledWith([])
  })

  it('renders the send hint under the input area', () => {
    setAgent([])
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'panel' } })
    expect(wrapper.find('.helper-text').text()).toBe(
      'Click Send or press Enter to send your message',
    )
  })

  it('shows a UI-only greeting only while the agent thread is empty', () => {
    setAgent([])
    const empty = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'panel' } })
    expect(empty.find('[data-testid="pk-headless-greeting"]').exists()).toBe(true)

    setAgent(a2uiMessages())
    const withMsgs = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'panel' } })
    expect(withMsgs.find('[data-testid="pk-headless-greeting"]').exists()).toBe(false)
  })
})
