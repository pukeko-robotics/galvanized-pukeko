import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HeadlessChat from './HeadlessChat.vue'

/**
 * PLAT-19: the headless A2UI render target (`chat` | `panel`).
 *
 * These are COMPONENT tests over a KNOWN fixture JSONL — no live model. We mock
 * `@copilotkit/vue/v2` (there is no pre-existing copilot spec that mocks it, so
 * we establish the pattern here): `useAgent` yields an agent whose `messages`
 * we control and whose `addMessage` is a spy; `useCopilotKit` yields a
 * `copilotkit` whose `runAgent` is a spy. Both are exposed as plain `{ value }`
 * holders — HeadlessChat only reads `.value`, never Vue-reactivity on them, and
 * we set `messages` before mount, so no reactive ref is required.
 */
const mocks = vi.hoisted(() => ({
  runAgent: vi.fn(),
  addMessage: vi.fn(),
  // A ref-like holder for the "current agent"; tests assign `.value` per case.
  agentRef: { value: null as unknown as Record<string, unknown> },
}))

vi.mock('@copilotkit/vue/v2', () => ({
  useCopilotKit: () => ({ copilotkit: { value: { runAgent: mocks.runAgent } } }),
  useAgent: () => ({ agent: mocks.agentRef }),
}))

// A minimal A2UI surface: a Column with a Text and a Button carrying an action
// with a literal context `{ pick: 'A' }`. Same wire shape (concatenated,
// brace-delimited JSON objects) the backend emits as the show_a2ui_surface
// tool result — adapted from A2UIToolSurface.spec.ts.
function surfaceJsonl(): string {
  const surfaceUpdate = {
    surfaceUpdate: {
      surfaceId: '@default',
      components: [
        { id: 'root', component: { Column: { children: { explicitList: ['title', 'go'] } } } },
        { id: 'title', component: { Text: { text: { literalString: 'Pick an option' }, usageHint: 'h3' } } },
        {
          id: 'go',
          component: {
            Button: {
              action: { name: 'choose', context: [{ key: 'pick', value: { literalString: 'A' } }] },
              child: 'Go',
            },
          },
        },
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
    isRunning: false,
    abortRun: vi.fn(),
  }
}

beforeEach(() => {
  mocks.runAgent.mockClear()
  mocks.addMessage.mockClear()
})

describe('HeadlessChat A2UI render target (PLAT-19)', () => {
  it('chat target: mounts the surface INLINE (its own A2UIToolSurface), no panel', () => {
    setAgent(a2uiMessages())
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })

    // The badge stays in the thread…
    expect(wrapper.find('.tool-call-badge').exists()).toBe(true)
    // …and the surface renders inline via A2UIToolSurface (its wrapper class).
    expect(wrapper.find('.a2ui-tool-surface').exists()).toBe(true)
    expect(wrapper.find('.a2ui-tool-surface').text()).toContain('Pick an option')
    expect(wrapper.find('button.a2ui-button').exists()).toBe(true)
    // No split panel in chat mode.
    expect(wrapper.find('[data-testid="pk-headless-a2ui-panel"]').exists()).toBe(false)
  })

  it('panel target: mounts the surface in the shared split PANEL, not inline', () => {
    setAgent(a2uiMessages())
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'panel' } })

    // Badge still in the thread (bespoke parity: badge in chat + surface in pane).
    expect(wrapper.find('.tool-call-badge').exists()).toBe(true)
    const panel = wrapper.find('[data-testid="pk-headless-a2ui-panel"]')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('Pick an option')
    expect(panel.find('button.a2ui-button').exists()).toBe(true)
    // Panel uses A2UISurface directly — no per-part A2UIToolSurface wrapper.
    expect(wrapper.find('.a2ui-tool-surface').exists()).toBe(false)
  })

  it('chat target action round-trip: adds serialized user action + re-runs agent', async () => {
    setAgent(a2uiMessages())
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })

    await wrapper.find('button.a2ui-button').trigger('click')

    expect(mocks.addMessage).toHaveBeenCalledTimes(1)
    const arg = mocks.addMessage.mock.calls[0][0] as { role: string; content: string }
    expect(arg.role).toBe('user')
    const action = JSON.parse(arg.content) as { actionName: string; context?: Record<string, unknown> }
    expect(action.actionName).toBe('choose')
    expect(action.context).toEqual({ pick: 'A' })
    expect(mocks.runAgent).toHaveBeenCalledTimes(1)
  })

  it('panel target action round-trip: adds serialized user action + re-runs agent', async () => {
    setAgent(a2uiMessages())
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'panel' } })

    await wrapper.find('[data-testid="pk-headless-a2ui-panel"] button.a2ui-button').trigger('click')

    expect(mocks.addMessage).toHaveBeenCalledTimes(1)
    const arg = mocks.addMessage.mock.calls[0][0] as { role: string; content: string }
    expect(arg.role).toBe('user')
    const action = JSON.parse(arg.content) as { actionName: string; context?: Record<string, unknown> }
    expect(action.actionName).toBe('choose')
    expect(action.context).toEqual({ pick: 'A' })
    expect(mocks.runAgent).toHaveBeenCalledTimes(1)
  })

  it('panel target: a later tool call updates the SAME surface in place (the crux)', () => {
    // Two show_a2ui_surface tool calls. The second batch carries NO
    // beginRendering/root of its own — it only updates @default's title text. A
    // fresh per-part processor (chat mode) would have rootComponentId === null
    // for that batch and render nothing; only the shared panel processor, which
    // retains the root from batch 1, rebuilds and shows the update. This is the
    // exact behavior the panel target exists to provide.
    const firstBatch =
      JSON.stringify({
        surfaceUpdate: {
          surfaceId: '@default',
          components: [
            { id: 'root', component: { Column: { children: { explicitList: ['title'] } } } },
            { id: 'title', component: { Text: { text: { path: '/label' } } } },
          ],
        },
      }) +
      JSON.stringify({
        dataModelUpdate: { surfaceId: '@default', contents: [{ key: 'label', valueString: 'Original' }] },
      }) +
      JSON.stringify({ beginRendering: { surfaceId: '@default', root: 'root' } })
    // Second batch: only bumps the bound datum on the existing surface.
    const secondBatch = JSON.stringify({
      dataModelUpdate: { surfaceId: '@default', contents: [{ key: 'label', valueString: 'Updated' }] },
    })

    setAgent([
      { id: 'a1', role: 'assistant', toolCalls: [{ id: 'tc-1', function: { name: 'show_a2ui_surface', arguments: '{}' } }] },
      { id: 't1', role: 'tool', toolCallId: 'tc-1', content: firstBatch },
      { id: 'a2', role: 'assistant', toolCalls: [{ id: 'tc-2', function: { name: 'show_a2ui_surface', arguments: '{}' } }] },
      { id: 't2', role: 'tool', toolCallId: 'tc-2', content: secondBatch },
    ])
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'panel' } })

    const panel = wrapper.find('[data-testid="pk-headless-a2ui-panel"]')
    expect(panel.text()).toContain('Updated')
    expect(panel.text()).not.toContain('Original')
    // Still exactly one surface in the shared pane (updated in place, not a new one).
    expect(panel.findAll('.a2ui-surface')).toHaveLength(1)
  })

  it('defaults to the panel target when a2uiTarget is not provided', () => {
    // No A2UI messages needed: the panel container renders whenever the target
    // is panel, so its mere presence with default props proves the default.
    setAgent([])
    const dflt = mount(HeadlessChat, { props: { agentId: 'default' } })
    expect(dflt.find('[data-testid="pk-headless-a2ui-panel"]').exists()).toBe(true)

    // Contrast: chat target renders no panel — confirms the default is panel,
    // not merely "panel always present".
    const chat = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })
    expect(chat.find('[data-testid="pk-headless-a2ui-panel"]').exists()).toBe(false)
  })
})
