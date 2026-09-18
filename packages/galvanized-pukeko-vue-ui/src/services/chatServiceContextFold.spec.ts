import { describe, it, expect, vi, afterEach } from 'vitest'
import { ChatService, type AssistantStreamingMessage, type MessagePart } from './chatService'
import { GauntSlothAgent } from './gauntSlothAgent'

/**
 * RC-68 — the context fold on the bespoke `chatService` surface.
 *
 * ## Where the event used to die, and why this spec drives the real client
 *
 * `buildSubscriber` returned an `AgentSubscriber` with no `onCustomEvent`
 * property, so `@ag-ui/client`'s `case EventType.CUSTOM` branch — which calls
 * `subscriber.onCustomEvent?.(…)` — short-circuited on the optional call and the
 * frame was gone. Nothing threw and nothing logged: exactly the RC-47 shape.
 *
 * A hand-rolled subscriber-caller could not have shown that, because it would
 * have called the handler the production code was missing. So these cases feed
 * literal AG-UI SSE bytes through a real `GauntSlothAgent` (the subclass every
 * surface constructs) with only `fetch` stubbed: `EventSchemas.parse` validates
 * the fixtures, the client's own dispatch decides what reaches the subscriber,
 * and `ChatService.runLoop` wires it exactly as it does in the browser.
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

const CONTEXT_COMPACTED_FRAME = {
  type: 'CUSTOM',
  name: 'context_compacted',
  value: { cause: 'context_overflow', compaction: COMPACTION, notice: NOTICE },
}

function sseFrom(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
}

/** A real GauntSlothAgent whose only stub is `fetch`, so the whole client runs. */
function agentOver(events: Array<Record<string, unknown>>): GauntSlothAgent {
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
  return new GauntSlothAgent({ url: 'http://agent.test/run', fetch: fetchStub })
}

/** Run one turn through the real ChatService and capture every bubble update. */
async function streamTurn(events: Array<Record<string, unknown>>): Promise<{
  updates: AssistantStreamingMessage[]
  final: AssistantStreamingMessage
}> {
  const svc = new ChatService()
  // Inject the agent so ensureAgent() short-circuits and never reads config.
  ;(svc as unknown as { agent: GauntSlothAgent }).agent = agentOver(events)
  const updates: AssistantStreamingMessage[] = []
  await svc.sendMessage('how long is the corridor?', {
    onMessageUpdate: (msg) => updates.push(msg),
    onError: () => {},
  })
  if (updates.length === 0) throw new Error('the stream produced no bubble updates')
  return { updates, final: updates[updates.length - 1] }
}

const kinds = (parts: MessagePart[]): string[] => parts.map((p) => p.kind)

function foldPart(parts: MessagePart[]): Extract<MessagePart, { kind: 'fold' }> {
  const part = parts.find((p) => p.kind === 'fold')
  if (!part || part.kind !== 'fold') throw new Error('no fold part in the turn')
  return part
}

function textOf(part: MessagePart): string {
  if (part.kind !== 'text') throw new Error(`expected a text part, got ${part.kind}`)
  return part.text
}

const TEXT_THEN_FOLD_THEN_TEXT = [
  { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
  { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Let me check the plan.' },
  { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
  CONTEXT_COMPACTED_FRAME,
  { type: 'TEXT_MESSAGE_START', messageId: 'm2', role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'It is two metres.' },
  { type: 'TEXT_MESSAGE_END', messageId: 'm2' },
  { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RC-68 bespoke surface — the fold marker lands where the cut happened', () => {
  it('puts the marker BETWEEN the answer before the fold and the answer after it', async () => {
    const { final } = await streamTurn(TEXT_THEN_FOLD_THEN_TEXT)

    // The position IS the information: not "a fold part exists somewhere", but
    // that it sits between the two texts, in arrival order.
    expect(kinds(final.parts)).toEqual(['text', 'fold', 'text'])
    expect(textOf(final.parts[0])).toBe('Let me check the plan.')
    expect(textOf(final.parts[2])).toBe('It is two metres.')
  })

  it('shows the server’s own notice rather than wording invented here', async () => {
    const { final } = await streamTurn(TEXT_THEN_FOLD_THEN_TEXT)
    const fold = foldPart(final.parts)

    expect(fold.fold.title).toBe('Context overflowed — conversation compacted')
    expect(fold.fold.lines).toEqual(NOTICE.lines)
    expect(fold.fold.tone).toBe('warn')
    expect(fold.fold.compaction).toEqual(COMPACTION)
  })

  it('keeps the whole turn in ONE bubble when the fold arrives before any token', async () => {
    // The ordinary case: the provider rejected the FIRST attempt for size, so
    // nothing had streamed when the fold was announced. Without an id claimed
    // at that moment the bubble starts life with id '', TEXT_MESSAGE_START then
    // adopts a different one, and the consumer opens a SECOND bubble — drawing
    // the marker twice.
    const { updates, final } = await streamTurn([
      { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
      CONTEXT_COMPACTED_FRAME,
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Two metres.' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
      { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' },
    ])

    expect(kinds(final.parts)).toEqual(['fold', 'text'])
    expect(textOf(final.parts[1])).toBe('Two metres.')
    // One id for the whole turn, and never the empty one.
    const ids = new Set(updates.map((u) => u.id))
    expect([...ids]).toHaveLength(1)
    expect(final.id).not.toBe('')
    // Exactly one marker in the finished turn.
    expect(final.parts.filter((p) => p.kind === 'fold')).toHaveLength(1)
  })

  it('closes an open thinking part above the marker', async () => {
    const { final } = await streamTurn([
      { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
      { type: 'REASONING_MESSAGE_START', messageId: 'rz', role: 'reasoning' },
      { type: 'REASONING_MESSAGE_CONTENT', messageId: 'rz', delta: 'Weighing options.' },
      CONTEXT_COMPACTED_FRAME,
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Two metres.' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
      { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' },
    ])

    expect(kinds(final.parts)).toEqual(['thinking', 'fold', 'text'])
    expect(final.parts[0]).toMatchObject({ kind: 'thinking', done: true })
  })
})

describe('RC-68 bespoke surface — an unknown CUSTOM event', () => {
  const UNKNOWN_MID_STREAM = [
    { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Checking.' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    { type: 'CUSTOM', name: 'telemetry_ping', value: { seq: 1 } },
    { type: 'TEXT_MESSAGE_START', messageId: 'm2', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'Two metres.' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm2' },
    { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' },
  ]

  it('does not break the stream, and adds no marker', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const { final } = await streamTurn(UNKNOWN_MID_STREAM)

    // Positive half — the turn either side of the unknown event is intact.
    expect(kinds(final.parts)).toEqual(['text', 'text'])
    expect(textOf(final.parts[0])).toBe('Checking.')
    expect(textOf(final.parts[1])).toBe('Two metres.')
    expect(final.done).toBe(true)

    // Absence half — no part carries a fold, as an ABSENT property and not one
    // written as undefined. `toBeUndefined()` cannot tell those apart, and the
    // pairing above means a rename of `fold` cannot make this pass by vacuum.
    for (const part of final.parts) {
      expect(Object.prototype.hasOwnProperty.call(part, 'fold')).toBe(false)
      expect('fold' in part).toBe(false)
    }
  })

  it('logs the unhandled name exactly once, naming the surface', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await streamTurn([
      { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
      { type: 'CUSTOM', name: 'telemetry_ping', value: { seq: 1 } },
      { type: 'CUSTOM', name: 'telemetry_ping', value: { seq: 2 } },
      { type: 'CUSTOM', name: 'telemetry_ping', value: { seq: 3 } },
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Two metres.' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
      { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' },
    ])

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      '[ChatService] Ignoring unhandled AG-UI CUSTOM event:',
      'telemetry_ping',
      expect.stringContaining('not reported'),
    )
  })

  it('still renders a fold that follows unknown events on the same run', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const { final } = await streamTurn([
      { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
      { type: 'CUSTOM', name: 'telemetry_ping', value: { seq: 1 } },
      CONTEXT_COMPACTED_FRAME,
      { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Two metres.' },
      { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
      { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' },
    ])

    expect(kinds(final.parts)).toEqual(['fold', 'text'])
    expect(foldPart(final.parts).fold.title).toBe(NOTICE.title)
  })
})
