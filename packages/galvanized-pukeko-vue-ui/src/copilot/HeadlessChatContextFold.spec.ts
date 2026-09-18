import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { HttpAgent } from '@ag-ui/client'
import {
  toBubbles,
  type AgentMessageLike,
  type ChatBubble,
  type ContextFoldMarker,
} from './useHeadlessChat'
import { describeContextFold } from '../services/contextCompaction'
import HeadlessChat from './HeadlessChat.vue'

/**
 * RC-68 — the context fold on the CopilotKit-driven headless surface.
 *
 * ## Where the event died on THIS path — and it is not where the node guessed
 *
 * The node's guess was that the fold met RC-47's drop-through in `toBubbles`.
 * It cannot: `toBubbles` folds `agent.messages`, and a `CUSTOM` event never
 * enters that log — the first case below measures the log across the event and
 * finds it unchanged. The event died one layer earlier, at `HeadlessChat.vue`'s
 * `agent.subscribe({...})`, which registered `onRunErrorEvent` and `onRunFailed`
 * and nothing else, so `@ag-ui/client`'s `subscriber.onCustomEvent?.(…)` call
 * found no handler.
 *
 * That is also why the marker cannot ride in the message log: a message is
 * replayed to the model on the next turn as the assistant's own words, which is
 * precisely what gaunt-sloth chose `CUSTOM` to avoid. So the position is carried
 * beside the log, as a count.
 */

const COMPACTION = {
  changed: true,
  removedCount: 12,
  keptCount: 4,
  keepRecent: 4,
  summaryText: 'Earlier conversation summarised.',
  before: { messages: 16, characters: 240000 },
  after: { messages: 5, characters: 18000 },
}

const NOTICE = {
  title: 'Context overflowed — conversation compacted',
  lines: ['12 older messages were folded into a summary.', 'Nothing on screen was undone.'],
  tone: 'warn',
}

const COMPACTED_VALUE = { cause: 'context_overflow', compaction: COMPACTION, notice: NOTICE }

function sseFrom(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
}

function agentOver(events: Array<Record<string, unknown>>): HttpAgent {
  const body = new TextEncoder().encode(sseFrom(events))
  const fetchStub = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body)
          controller.close()
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
  return new HttpAgent({ url: 'http://agent.test/run', fetch: fetchStub })
}

const FOLD_MID_TURN = [
  { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
  { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Let me check.' },
  { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
  { type: 'CUSTOM', name: 'context_compacted', value: COMPACTED_VALUE },
  { type: 'TEXT_MESSAGE_START', messageId: 'm2', role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'Two metres.' },
  { type: 'TEXT_MESSAGE_END', messageId: 'm2' },
  { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' },
]

describe('RC-68 — what @ag-ui/client does with a CUSTOM event (the death site)', () => {
  it('delivers it to onCustomEvent intact, and adds NOTHING to the message log', async () => {
    const agent = agentOver(FOLD_MID_TURN)
    const seen: Array<{ name: string; messageCount: number; value: unknown }> = []

    await agent.runAgent(undefined, {
      onCustomEvent: ({ event, messages }) => {
        seen.push({ name: event.name, messageCount: messages.length, value: event.value })
      },
    })

    // Delivered — so the subscription layer does not swallow it, and a client
    // that hears nothing is a client that registered no handler.
    expect(seen).toHaveLength(1)
    expect(seen[0].name).toBe('context_compacted')
    expect(seen[0].value).toEqual(COMPACTED_VALUE)

    // And invisible to the log: two assistant messages, neither mentioning it.
    expect(agent.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(JSON.stringify(agent.messages)).not.toContain('compact')

    // Therefore `toBubbles` over the log ALONE can never show the fold: the
    // positive half is that it renders the turn correctly (EXT-174's graceful
    // degradation), the absence half that no bubble is a fold.
    const bubbles = toBubbles(agent.messages as ReadonlyArray<AgentMessageLike>)
    expect(bubbles.map((b) => b.kind)).toEqual(['assistant', 'assistant'])
    for (const bubble of bubbles) {
      expect(Object.prototype.hasOwnProperty.call(bubble, 'fold')).toBe(false)
      expect('fold' in bubble).toBe(false)
    }
  })
})

describe('RC-68 toBubbles — a fold is positioned by COUNT, so it always lands', () => {
  const fold = describeContextFold(COMPACTED_VALUE)
  const marker = (afterMessageCount: number, id = 'fold-1'): ContextFoldMarker => ({
    id,
    afterMessageCount,
    fold,
  })

  const kinds = (bubbles: ChatBubble[]): string[] => bubbles.map((b) => b.kind)

  it('splices the marker at the point in the stream it was recorded at', () => {
    const messages: AgentMessageLike[] = [
      { id: 'u1', role: 'user', content: 'how long?' },
      { id: 'a1', role: 'assistant', content: 'Let me check.' },
      { id: 'a2', role: 'assistant', content: 'Two metres.' },
    ]

    // Recorded when the log held [u1, a1] — so it belongs between them and a2.
    expect(kinds(toBubbles(messages, [marker(2)]))).toEqual([
      'user',
      'assistant',
      'fold',
      'assistant',
    ])
  })

  it('lands after a TOOL message, which produces no bubble of its own', () => {
    // The discriminating case for count-anchoring. A tool result mutates an
    // existing part and emits nothing, so a marker anchored to that message's
    // ID would have no bubble to attach to and would be dropped — re-creating
    // the very disappearance this node exists to fix.
    const messages: AgentMessageLike[] = [
      { id: 'u1', role: 'user', content: 'measure it' },
      {
        id: 'a1',
        role: 'assistant',
        toolCalls: [{ id: 'tc1', function: { name: 'measure', arguments: '{}' } }],
      },
      { id: 't1', role: 'tool', toolCallId: 'tc1', content: '2m' },
    ]

    const bubbles = toBubbles(messages, [marker(3)])

    expect(kinds(bubbles)).toEqual(['user', 'assistant', 'fold'])
    // The tool result still attached — the splice did not disturb the fold-in.
    const assistant = bubbles[1]
    expect(assistant.kind).toBe('assistant')
    if (assistant.kind === 'assistant') {
      expect(assistant.parts[0]).toMatchObject({ status: 'complete', result: '2m' })
    }
  })

  it('keeps a marker recorded past the end of the log — at the end', () => {
    // The ordinary live case: the fold arrives before the message that follows
    // it has been recorded, so its count exceeds the log length.
    const messages: AgentMessageLike[] = [{ id: 'u1', role: 'user', content: 'hi' }]

    expect(kinds(toBubbles(messages, [marker(9)]))).toEqual(['user', 'fold'])
  })

  it('keeps a marker recorded against an empty log — at the front', () => {
    const messages: AgentMessageLike[] = [{ id: 'a1', role: 'assistant', content: 'Two metres.' }]

    expect(kinds(toBubbles(messages, [marker(0)]))).toEqual(['fold', 'assistant'])
  })

  it('orders two folds by position, and keys each bubble by its own id', () => {
    const messages: AgentMessageLike[] = [
      { id: 'u1', role: 'user', content: 'a' },
      { id: 'a1', role: 'assistant', content: 'b' },
    ]

    const bubbles = toBubbles(messages, [marker(2, 'fold-late'), marker(1, 'fold-early')])

    expect(kinds(bubbles)).toEqual(['user', 'fold', 'assistant', 'fold'])
    expect(bubbles[1].id).toBe('fold-early')
    expect(bubbles[3].id).toBe('fold-late')
  })

  it('flushes held reasoning ABOVE the marker rather than below it', () => {
    // The server ends reasoning before it sends the fold, so thinking belongs
    // above the line, and the answer after it starts a fresh bubble.
    const messages: AgentMessageLike[] = [
      { id: 'r1', role: 'reasoning', content: 'Weighing options.' },
      { id: 'a1', role: 'assistant', content: 'Two metres.' },
    ]

    const bubbles = toBubbles(messages, [marker(1)])

    expect(kinds(bubbles)).toEqual(['assistant', 'fold', 'assistant'])
    const thinking = bubbles[0]
    if (thinking.kind !== 'assistant') throw new Error('expected an assistant bubble')
    expect(thinking.parts).toEqual([{ kind: 'thinking', text: 'Weighing options.', done: true }])
  })

  it('changes nothing when no folds are passed', () => {
    const messages: AgentMessageLike[] = [
      { id: 'u1', role: 'user', content: 'hi' },
      { id: 'a1', role: 'assistant', content: 'hello' },
    ]

    const bubbles = toBubbles(messages)

    // Positive: the existing projection is untouched.
    expect(kinds(bubbles)).toEqual(['user', 'assistant'])
    // Absence: no bubble acquired a fold property, as an absent one — not one
    // written as undefined, which `toBeUndefined()` could not tell apart.
    for (const bubble of bubbles) {
      expect(Object.prototype.hasOwnProperty.call(bubble, 'fold')).toBe(false)
      expect('fold' in bubble).toBe(false)
    }
  })
})

// ---- the mounted surface -------------------------------------------------

const mocks = vi.hoisted(() => ({
  runAgent: vi.fn(),
  abortRun: vi.fn(),
  setMessages: vi.fn(),
  agentRef: { value: null as unknown as Record<string, unknown> },
}))

vi.mock('@copilotkit/vue/v2', () => ({
  useCopilotKit: () => ({ copilotkit: { value: { runAgent: mocks.runAgent } } }),
  useAgent: () => ({ agent: mocks.agentRef }),
}))

interface CapturedSubscriber {
  onCustomEvent?: (params: {
    event: { name?: string; value?: unknown }
    messages: unknown[]
  }) => void
}

function setAgentWithSubscribe(messages: AgentMessageLike[]) {
  const captured: { subscriber: CapturedSubscriber | null } = { subscriber: null }
  const log = reactive(messages)
  mocks.setMessages.mockImplementation(() => {
    log.splice(0)
  })
  mocks.agentRef.value = {
    messages: log,
    addMessage: vi.fn(),
    abortRun: mocks.abortRun,
    setMessages: mocks.setMessages,
    isRunning: false,
    subscribe: vi.fn((s: CapturedSubscriber) => {
      captured.subscriber = s
      return { unsubscribe: vi.fn() }
    }),
  }
  return { captured, log }
}

/** The transcript's children, in document order, by their test id. */
function transcriptOrder(wrapper: ReturnType<typeof mount>): string[] {
  const container = wrapper.find('.messages').element
  return Array.from(container.children).map((el) => el.getAttribute('data-testid') ?? '')
}

beforeEach(() => {
  mocks.runAgent.mockClear()
  mocks.abortRun.mockClear()
  mocks.setMessages.mockClear()
})

describe('RC-68 headless surface — the marker renders where the cut happened', () => {
  it('draws the fold between the turn before it and the turn after it', async () => {
    const { captured } = setAgentWithSubscribe([
      { id: 'u1', role: 'user', content: 'how long?' },
      { id: 'a1', role: 'assistant', content: 'Let me check.' },
      { id: 'a2', role: 'assistant', content: 'Two metres.' },
    ])
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })

    // No marker before the event: a rename of the event name cannot pass this
    // by leaving the marker permanently on screen.
    expect(wrapper.find('[data-testid="pk-headless-fold"]').exists()).toBe(false)

    // The fold arrived when the log held [u1, a1].
    captured.subscriber!.onCustomEvent!({
      event: { name: 'context_compacted', value: COMPACTED_VALUE },
      messages: [{ id: 'u1' }, { id: 'a1' }],
    })
    await nextTick()

    expect(transcriptOrder(wrapper)).toEqual([
      'pk-headless-user',
      'pk-headless-assistant',
      'pk-headless-fold',
      'pk-headless-assistant',
    ])
  })

  it('shows the server’s own notice in the marker', async () => {
    const { captured } = setAgentWithSubscribe([{ id: 'u1', role: 'user', content: 'hi' }])
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })

    captured.subscriber!.onCustomEvent!({
      event: { name: 'context_compacted', value: COMPACTED_VALUE },
      messages: [{ id: 'u1' }],
    })
    await nextTick()

    const marker = wrapper.find('[data-testid="pk-context-fold"]')
    expect(marker.exists()).toBe(true)
    expect(wrapper.find('[data-testid="pk-context-fold-title"]').text()).toBe(NOTICE.title)
    expect(marker.text()).toContain('12 older messages were folded into a summary.')
    expect(marker.classes()).toContain('tone-warn')
  })

  it('falls back to the fold’s numbers when the server sent no notice', async () => {
    const { captured } = setAgentWithSubscribe([{ id: 'u1', role: 'user', content: 'hi' }])
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })

    captured.subscriber!.onCustomEvent!({
      event: { name: 'context_compacted', value: { compaction: COMPACTION } },
      messages: [{ id: 'u1' }],
    })
    await nextTick()

    const counts = wrapper.find('[data-testid="pk-context-fold-counts"]')
    expect(counts.exists()).toBe(true)
    expect(counts.text()).toContain('16 →')
    expect(counts.text()).toContain('5 messages')
    // Positive pairing: the marker still names itself.
    expect(wrapper.find('[data-testid="pk-context-fold-title"]').text()).toBe(
      'Conversation compacted',
    )
  })

  it('does NOT repeat the numbers when the notice already states them', async () => {
    const { captured } = setAgentWithSubscribe([{ id: 'u1', role: 'user', content: 'hi' }])
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })

    captured.subscriber!.onCustomEvent!({
      event: { name: 'context_compacted', value: COMPACTED_VALUE },
      messages: [{ id: 'u1' }],
    })
    await nextTick()

    // Positive: the notice's own lines are what is shown.
    expect(wrapper.findAll('[data-testid="pk-context-fold-line"]')).toHaveLength(2)
    // Absence: the numbers row is not rendered alongside them.
    expect(wrapper.find('[data-testid="pk-context-fold-counts"]').exists()).toBe(false)
  })

  it('ignores an unknown CUSTOM event without breaking the transcript, and logs it once', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { captured } = setAgentWithSubscribe([
      { id: 'u1', role: 'user', content: 'how long?' },
      { id: 'a1', role: 'assistant', content: 'Two metres.' },
    ])
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })

    captured.subscriber!.onCustomEvent!({
      event: { name: 'telemetry_ping', value: { seq: 1 } },
      messages: [{ id: 'u1' }],
    })
    captured.subscriber!.onCustomEvent!({
      event: { name: 'telemetry_ping', value: { seq: 2 } },
      messages: [{ id: 'u1' }],
    })
    await nextTick()

    // Positive: the stream is intact, both turns still on screen and in order.
    expect(transcriptOrder(wrapper)).toEqual(['pk-headless-user', 'pk-headless-assistant'])
    // Absence: nothing was drawn for it.
    expect(wrapper.find('[data-testid="pk-headless-fold"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pk-context-fold"]').exists()).toBe(false)

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      '[HeadlessChat] Ignoring unhandled AG-UI CUSTOM event:',
      'telemetry_ping',
      expect.stringContaining('not reported'),
    )
    info.mockRestore()
  })

  it('clears the markers on New Conversation, so none strands on an empty thread', async () => {
    const { captured } = setAgentWithSubscribe([
      { id: 'u1', role: 'user', content: 'how long?' },
      { id: 'a1', role: 'assistant', content: 'Two metres.' },
    ])
    const wrapper = mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'chat' } })

    captured.subscriber!.onCustomEvent!({
      event: { name: 'context_compacted', value: COMPACTED_VALUE },
      messages: [{ id: 'u1' }],
    })
    await nextTick()
    expect(wrapper.find('[data-testid="pk-headless-fold"]').exists()).toBe(true)

    await wrapper.find('[data-testid="pk-headless-new-conversation"]').trigger('click')
    await nextTick()

    expect(wrapper.find('[data-testid="pk-headless-fold"]').exists()).toBe(false)
    // Positive pairing: the thread really did reset, rather than the marker
    // merely being hidden by a broken transcript.
    expect(wrapper.find('[data-testid="pk-headless-greeting"]').exists()).toBe(true)
  })
})
