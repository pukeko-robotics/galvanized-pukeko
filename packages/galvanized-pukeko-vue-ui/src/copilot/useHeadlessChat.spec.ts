import { describe, it, expect } from 'vitest'
import { toBubbles, type AgentMessageLike } from './useHeadlessChat'

describe('toBubbles (headless message projection)', () => {
  it('renders a user message as a user bubble', () => {
    const msgs: AgentMessageLike[] = [{ id: 'u1', role: 'user', content: 'hello' }]
    expect(toBubbles(msgs)).toEqual([{ kind: 'user', id: 'u1', text: 'hello' }])
  })

  it('renders assistant text as one assistant bubble', () => {
    const msgs: AgentMessageLike[] = [{ id: 'a1', role: 'assistant', content: 'hi there' }]
    const bubbles = toBubbles(msgs)
    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]).toMatchObject({
      kind: 'assistant',
      id: 'a1',
      parts: [{ kind: 'text', text: 'hi there' }],
    })
  })

  it('merges assistant text + tool call into one bubble with parsed args', () => {
    const msgs: AgentMessageLike[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'let me check',
        toolCalls: [
          { id: 'tc1', function: { name: 'get_weather', arguments: '{"city":"Auckland"}' } },
        ],
      },
    ]
    const [bubble] = toBubbles(msgs)
    expect(bubble.kind).toBe('assistant')
    if (bubble.kind !== 'assistant') throw new Error('expected assistant')
    expect(bubble.parts[0]).toEqual({ kind: 'text', text: 'let me check' })
    expect(bubble.parts[1]).toMatchObject({
      kind: 'tool-call',
      toolCallId: 'tc1',
      toolCallName: 'get_weather',
      args: { city: 'Auckland' },
      status: 'pending',
    })
  })

  it('attaches a tool message result to its tool-call part and marks it complete', () => {
    const msgs: AgentMessageLike[] = [
      {
        id: 'a1',
        role: 'assistant',
        toolCalls: [{ id: 'tc1', function: { name: 'ping', arguments: '{}' } }],
      },
      { id: 't1', role: 'tool', toolCallId: 'tc1', content: 'pong' },
    ]
    const [bubble] = toBubbles(msgs)
    if (bubble.kind !== 'assistant') throw new Error('expected assistant')
    expect(bubble.parts[0]).toMatchObject({
      kind: 'tool-call',
      result: 'pong',
      status: 'complete',
    })
  })

  // PLAT-18: the headless analogue of RC-14's bespoke attachToolResult. A
  // CLIENT-fulfilled tool's result never arrives as a TOOL_CALL_RESULT event —
  // CopilotKit's processAgentResult runs the frontend-tool handler after
  // RUN_FINISHED and splices the result into `agent.messages` as a `tool`
  // message right after the calling assistant message. toBubbles must attach
  // that message to the stored part so ToolCallBadge can show the result (and a
  // PLAT-17 renderer can mount) on the headless path too.
  it('attaches a client-fulfilled (spliced tool message) capture_image envelope to its part', () => {
    const envelope = JSON.stringify({ mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRg==' })
    const msgs: AgentMessageLike[] = [
      { id: 'u1', role: 'user', content: 'take a photo' },
      {
        id: 'a1',
        role: 'assistant',
        toolCalls: [{ id: 'tc1', function: { name: 'capture_image', arguments: '{}' } }],
      },
      // CopilotKit-spliced client-tool result (no streamed TOOL_CALL_RESULT).
      { id: 't1', role: 'tool', toolCallId: 'tc1', content: envelope },
      // The resume run's follow-up text.
      { id: 'a2', role: 'assistant', content: 'I can see the desk.' },
    ]
    const bubbles = toBubbles(msgs)
    expect(bubbles).toHaveLength(3)
    const assistant = bubbles[1]
    if (assistant.kind !== 'assistant') throw new Error('expected assistant')
    expect(assistant.parts[0]).toMatchObject({
      kind: 'tool-call',
      toolCallName: 'capture_image',
      result: envelope,
      status: 'complete',
    })
  })

  it('tolerates malformed tool-call arguments without throwing', () => {
    const msgs: AgentMessageLike[] = [
      {
        id: 'a1',
        role: 'assistant',
        toolCalls: [{ id: 'tc1', function: { name: 'x', arguments: 'not-json{' } }],
      },
    ]
    const [bubble] = toBubbles(msgs)
    if (bubble.kind !== 'assistant') throw new Error('expected assistant')
    expect(bubble.parts[0]).toMatchObject({ kind: 'tool-call', args: {}, argsRaw: 'not-json{' })
  })

  // RC-47: reasoning ("thinking") is retained by @ag-ui/client as its own
  // `role: 'reasoning'` message on AbstractAgent.messages, ahead of the
  // assistant message for the same turn. Before this node nothing projected it,
  // so HeadlessChat.vue's `thinking-part` renderer never had a part to mount.
  describe('reasoning projection', () => {
    it('projects a reasoning message into a thinking part ahead of the assistant text', () => {
      const msgs: AgentMessageLike[] = [
        { id: 'u1', role: 'user', content: 'where is the robot?' },
        { id: 'r1', role: 'reasoning', content: 'Checking the floor plan.' },
        { id: 'a1', role: 'assistant', content: 'It is by the window.' },
      ]
      const bubbles = toBubbles(msgs)
      expect(bubbles).toHaveLength(2)
      expect(bubbles[0]).toEqual({ kind: 'user', id: 'u1', text: 'where is the robot?' })
      const assistant = bubbles[1]
      if (assistant.kind !== 'assistant') throw new Error('expected assistant')
      expect(assistant.parts).toEqual([
        { kind: 'thinking', text: 'Checking the floor plan.', done: true },
        { kind: 'text', text: 'It is by the window.' },
      ])
      // Keyed by the reasoning message that opened the bubble, so the bubble
      // rendered while thinking streams is the same one the answer lands in
      // (a changing key would remount it and make the thinking flicker away).
      expect(assistant.id).toBe('r1')
    })

    it('holds thinking open across an assistant message that contributes no parts', () => {
      const msgs: AgentMessageLike[] = [
        { id: 'r1', role: 'reasoning', content: 'Considering.' },
        { id: 'a1', role: 'assistant', content: '' },
        { id: 'a2', role: 'assistant', content: 'Done.' },
      ]
      const bubbles = toBubbles(msgs)
      expect(bubbles).toHaveLength(1)
      expect(bubbles[0]).toEqual({
        kind: 'assistant',
        id: 'r1',
        parts: [
          { kind: 'thinking', text: 'Considering.', done: true },
          { kind: 'text', text: 'Done.' },
        ],
      })
    })

    it('marks a thinking part done when a tool call follows it', () => {
      const msgs: AgentMessageLike[] = [
        { id: 'r1', role: 'reasoning', content: 'I should look it up.' },
        {
          id: 'a1',
          role: 'assistant',
          toolCalls: [
            { id: 'tc1', function: { name: 'get_weather', arguments: '{"city":"Auckland"}' } },
          ],
        },
      ]
      const [bubble] = toBubbles(msgs)
      if (bubble.kind !== 'assistant') throw new Error('expected assistant')
      expect(bubble.parts[0]).toEqual({
        kind: 'thinking',
        text: 'I should look it up.',
        done: true,
      })
      expect(bubble.parts[1]).toMatchObject({
        kind: 'tool-call',
        toolCallId: 'tc1',
        toolCallName: 'get_weather',
        status: 'pending',
      })
    })

    it('leaves a still-streaming trailing reasoning message open in its own bubble', () => {
      const msgs: AgentMessageLike[] = [
        { id: 'u1', role: 'user', content: 'go home' },
        { id: 'r1', role: 'reasoning', content: 'Planning a route' },
      ]
      const bubbles = toBubbles(msgs)
      expect(bubbles).toHaveLength(2)
      expect(bubbles[1]).toEqual({
        kind: 'assistant',
        id: 'r1',
        parts: [{ kind: 'thinking', text: 'Planning a route', done: false }],
      })
    })

    it('keeps consecutive reasoning messages as separate parts, closing all but the last', () => {
      const msgs: AgentMessageLike[] = [
        { id: 'r1', role: 'reasoning', content: 'First thought.' },
        { id: 'r2', role: 'reasoning', content: 'Second thought' },
      ]
      const bubbles = toBubbles(msgs)
      expect(bubbles).toHaveLength(1)
      expect(bubbles[0]).toEqual({
        kind: 'assistant',
        id: 'r1',
        parts: [
          { kind: 'thinking', text: 'First thought.', done: true },
          { kind: 'thinking', text: 'Second thought', done: false },
        ],
      })
    })

    it('closes a thinking part when the user speaks again without an assistant turn', () => {
      const msgs: AgentMessageLike[] = [
        { id: 'r1', role: 'reasoning', content: 'Half a thought' },
        { id: 'u2', role: 'user', content: 'never mind' },
      ]
      expect(toBubbles(msgs)).toEqual([
        {
          kind: 'assistant',
          id: 'r1',
          parts: [{ kind: 'thinking', text: 'Half a thought', done: true }],
        },
        { kind: 'user', id: 'u2', text: 'never mind' },
      ])
    })

    it('still attaches tool results across a turn that reasoned first', () => {
      const msgs: AgentMessageLike[] = [
        { id: 'r1', role: 'reasoning', content: 'Ping it.' },
        {
          id: 'a1',
          role: 'assistant',
          toolCalls: [{ id: 'tc1', function: { name: 'ping', arguments: '{}' } }],
        },
        { id: 't1', role: 'tool', toolCallId: 'tc1', content: 'pong' },
        { id: 'r2', role: 'reasoning', content: 'It answered.' },
        { id: 'a2', role: 'assistant', content: 'The robot is up.' },
      ]
      const bubbles = toBubbles(msgs)
      expect(bubbles).toHaveLength(2)
      const first = bubbles[0]
      const second = bubbles[1]
      if (first.kind !== 'assistant' || second.kind !== 'assistant') {
        throw new Error('expected two assistant bubbles')
      }
      expect(first.parts[0]).toEqual({ kind: 'thinking', text: 'Ping it.', done: true })
      expect(first.parts[1]).toMatchObject({
        kind: 'tool-call',
        toolCallId: 'tc1',
        result: 'pong',
        status: 'complete',
      })
      expect(second.parts).toEqual([
        { kind: 'thinking', text: 'It answered.', done: true },
        { kind: 'text', text: 'The robot is up.' },
      ])
    })

    it('renders an empty reasoning message as an empty open thinking part', () => {
      const msgs: AgentMessageLike[] = [{ id: 'r1', role: 'reasoning', content: '' }]
      expect(toBubbles(msgs)).toEqual([
        {
          kind: 'assistant',
          id: 'r1',
          parts: [{ kind: 'thinking', text: '', done: false }],
        },
      ])
    })
  })

  it('does not render system/developer messages', () => {
    const msgs: AgentMessageLike[] = [
      { id: 's1', role: 'system', content: 'be nice' },
      { id: 'u1', role: 'user', content: 'hi' },
    ]
    expect(toBubbles(msgs)).toEqual([{ kind: 'user', id: 'u1', text: 'hi' }])
  })
})
