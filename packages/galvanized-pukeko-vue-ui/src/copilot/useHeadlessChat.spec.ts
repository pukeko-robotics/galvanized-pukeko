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

  it('does not render system/developer messages', () => {
    const msgs: AgentMessageLike[] = [
      { id: 's1', role: 'system', content: 'be nice' },
      { id: 'u1', role: 'user', content: 'hi' },
    ]
    expect(toBubbles(msgs)).toEqual([{ kind: 'user', id: 'u1', text: 'hi' }])
  })
})
