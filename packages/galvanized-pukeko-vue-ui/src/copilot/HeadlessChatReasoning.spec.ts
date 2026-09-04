import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { HttpAgent } from '@ag-ui/client'
import { toBubbles, type AgentMessageLike, type ChatBubble } from './useHeadlessChat'
import HeadlessChat from './HeadlessChat.vue'

/**
 * PLAT-32: reasoning ("thinking") on the headless surface, proven from the WIRE
 * rather than from a hand-written message log.
 *
 * The other reasoning specs in this directory (`useHeadlessChat.spec.ts`) feed
 * `toBubbles` synthetic `role: 'reasoning'` messages. That premise is sound —
 * but nothing there PROVES it, so a mapping and a spec built on the same wrong
 * idea about the event shape would both be green. These cases close that gap by
 * driving literal AG-UI SSE bytes through the real `@ag-ui/client` pipeline
 * (fetch → parseSSEStream → EventSchemas → defaultApplyEvents) and asserting on
 * the `agent.messages` the client actually produces. `EventSchemas.parse` rejects
 * a malformed event, so these fixtures cannot drift from the protocol silently:
 * the required `role: 'reasoning'` field on REASONING_MESSAGE_START was found
 * exactly that way.
 *
 * What this establishes, and it is the answer to the node's fork: the reasoning
 * channel is exposed by **`@ag-ui/client`**, which materialises
 * REASONING_MESSAGE_* into a first-class `role: 'reasoning'` message whose
 * `content` accumulates per delta — NOT by `@copilotkit/vue`, whose reasoning
 * support is a stock-chat component reachable only through
 * `CopilotChatMessageView`. The headless layer therefore reads the channel off
 * `agent.messages`, which is what `toBubbles` already does.
 */

/** Serialise events as AG-UI server-sent-event frames, exactly as the wire carries them. */
function sseFrom(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
}

/** A real HttpAgent whose only stub is `fetch`, so the entire client pipeline runs. */
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

/** A gemma-shaped turn: the model thinks, then answers. */
const THINK_THEN_ANSWER = [
  { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
  { type: 'REASONING_MESSAGE_START', messageId: 'reason-1', role: 'reasoning' },
  { type: 'REASONING_MESSAGE_CONTENT', messageId: 'reason-1', delta: 'Checking ' },
  { type: 'REASONING_MESSAGE_CONTENT', messageId: 'reason-1', delta: 'the floor plan.' },
  { type: 'REASONING_MESSAGE_END', messageId: 'reason-1' },
  { type: 'TEXT_MESSAGE_START', messageId: 'answer-1', role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'answer-1', delta: 'Two metres.' },
  { type: 'TEXT_MESSAGE_END', messageId: 'answer-1' },
  { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' },
]

function assistantBubble(bubbles: ChatBubble[], i = 0) {
  const bubble = bubbles[i]
  if (bubble?.kind !== 'assistant') throw new Error(`bubble ${i} is not an assistant bubble`)
  return bubble
}

describe('PLAT-32 reasoning reaches the headless bubble model from the wire', () => {
  it('materialises REASONING_MESSAGE_* into a reasoning message the mapping can read', async () => {
    const agent = agentOver(THINK_THEN_ANSWER)
    await agent.runAgent()

    // The channel itself: @ag-ui/client, not @copilotkit/vue, produces this.
    expect(agent.messages).toEqual([
      { id: 'reason-1', role: 'reasoning', content: 'Checking the floor plan.' },
      { id: 'answer-1', role: 'assistant', content: 'Two metres.' },
    ])
  })

  it('renders the finished thinking ahead of the answer in one bubble', async () => {
    const agent = agentOver(THINK_THEN_ANSWER)
    await agent.runAgent()

    const bubbles = toBubbles(agent.messages as ReadonlyArray<AgentMessageLike>)
    expect(bubbles).toHaveLength(1)
    const bubble = assistantBubble(bubbles)
    // Keyed by the reasoning message, so the bubble shown while thinking streams
    // is the same one the answer lands in (a changing key would remount it).
    expect(bubble.id).toBe('reason-1')
    expect(bubble.parts).toEqual([
      { kind: 'thinking', text: 'Checking the floor plan.', done: true },
      { kind: 'text', text: 'Two metres.' },
    ])
  })

  it('leaves the thinking part open while reasoning is still streaming', async () => {
    const agent = agentOver(THINK_THEN_ANSWER)
    const midRun: ChatBubble[][] = []
    // Snapshot the log at the moment a content delta lands — the live state the
    // surface actually paints, rather than the settled end-of-run log.
    await agent.runAgent(undefined, {
      onReasoningMessageContentEvent: ({ messages }) => {
        midRun.push(toBubbles(messages as ReadonlyArray<AgentMessageLike>))
      },
    })

    expect(midRun.length).toBeGreaterThan(0)
    const streaming = assistantBubble(midRun[midRun.length - 1])
    expect(streaming.parts).toEqual([
      { kind: 'thinking', text: 'Checking ', done: false },
    ])
  })

  it('accumulates every delta rather than trailing one behind', async () => {
    // The bespoke chatService must re-flush on REASONING_MESSAGE_END because the
    // subscriber's `reasoningMessageBuffer` lags a delta. The message log does
    // not: apply appends each delta to `content` before the log is published, so
    // the headless path needs no END flush. Pin that divergence.
    const agent = agentOver(THINK_THEN_ANSWER)
    await agent.runAgent()

    const bubble = assistantBubble(toBubbles(agent.messages as ReadonlyArray<AgentMessageLike>))
    const thinking = bubble.parts[0]
    expect(thinking).toMatchObject({ kind: 'thinking' })
    // Both deltas, not just the first.
    expect((thinking as { text: string }).text).toBe('Checking the floor plan.')
  })
})

/**
 * The renderer half. `toBubbles` computes `done` carefully; before PLAT-32
 * `HeadlessChat.vue` discarded it, so the headless surface had no streaming
 * indicator at all while the bespoke `ChatInterface` did.
 */
const mocks = vi.hoisted(() => ({
  agentRef: { value: null as unknown as Record<string, unknown> },
}))

vi.mock('@copilotkit/vue/v2', () => ({
  useCopilotKit: () => ({ copilotkit: { value: { runAgent: vi.fn() } } }),
  useAgent: () => ({ agent: mocks.agentRef }),
}))

function mountWith(messages: unknown[], isRunning: boolean) {
  mocks.agentRef.value = {
    messages,
    addMessage: vi.fn(),
    abortRun: vi.fn(),
    setMessages: vi.fn(),
    isRunning,
  }
  return mount(HeadlessChat, { props: { agentId: 'default', a2uiTarget: 'panel' } })
}

describe('PLAT-32 the headless surface shows a streaming indicator on open thinking', () => {
  it('marks the thinking part streaming while the run is live', () => {
    const wrapper = mountWith([{ id: 'r1', role: 'reasoning', content: 'Planning a route' }], true)

    const thinking = wrapper.find('.thinking-part')
    expect(thinking.exists()).toBe(true)
    expect(thinking.text()).toBe('Planning a route')
    expect(thinking.classes()).toContain('streaming')
  })

  it('drops the indicator once the model moves on to its answer', () => {
    const wrapper = mountWith(
      [
        { id: 'r1', role: 'reasoning', content: 'Planning a route' },
        { id: 'a1', role: 'assistant', content: 'Turn left.' },
      ],
      true,
    )

    const thinking = wrapper.find('.thinking-part')
    expect(thinking.exists()).toBe(true)
    expect(thinking.classes()).not.toContain('streaming')
  })

  it('drops the indicator when the run ends on an unclosed thinking part', () => {
    // toBubbles cannot observe run end, so this part stays `done: false` for
    // good. Without the isRunning conjunct the caret would blink forever.
    const wrapper = mountWith([{ id: 'r1', role: 'reasoning', content: 'Pondering.' }], false)

    const thinking = wrapper.find('.thinking-part')
    expect(thinking.exists()).toBe(true)
    expect(thinking.classes()).not.toContain('streaming')
  })
})
