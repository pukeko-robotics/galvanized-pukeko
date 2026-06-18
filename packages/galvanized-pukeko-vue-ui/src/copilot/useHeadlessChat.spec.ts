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
