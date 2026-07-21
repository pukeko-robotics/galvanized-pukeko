import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  attachToolResult,
  ChatService,
  type ChatCallbacks,
  type ClientToolHandler,
  type MessagePart,
} from './chatService'

// A scripted stand-in for @ag-ui/client's HttpAgent. runLoop only reads
// `agent.messages` after each `runAgent`, so each script step mutates the
// message log the way a real server round-trip would (append the assistant
// tool call, or — on resume of a normal tool — append its tool-result
// message). A `returnDirect` tool leaves NO tool-result message, which is the
// exact condition RC-6 is about.
type Msg = {
  id: string
  role: string
  content?: string
  toolCallId?: string
  toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>
}

class FakeAgent {
  url = 'http://test.invalid/agents/default/run'
  threadId = 'thread-test'
  messages: Msg[] = []
  runAgentCalls = 0
  constructor(private readonly script: Array<(msgs: Msg[]) => void>) {}
  addMessage(m: Msg) {
    this.messages.push(m)
  }
  async detachActiveRun() {}
  async runAgent(_input: unknown, _subscriber: unknown) {
    const step = this.script[this.runAgentCalls]
    this.runAgentCalls += 1
    step?.(this.messages)
  }
  abortRun() {}
}

const noopCallbacks: ChatCallbacks = {
  onMessageUpdate: () => {},
  onError: () => {},
}

function makeService(agent: FakeAgent): ChatService {
  const svc = new ChatService()
  // Inject the fake so ensureAgent() short-circuits and never touches configService.
  ;(svc as unknown as { agent: FakeAgent }).agent = agent
  return svc
}

function assistantToolCall(id: string, name: string, args = '{}'): Msg {
  return { id: `a-${id}`, role: 'assistant', toolCalls: [{ id, function: { name, arguments: args } }] }
}

function toolResult(toolCallId: string, content = 'ok'): Msg {
  return { id: `t-${toolCallId}`, role: 'tool', toolCallId, content }
}

describe('ChatService.runLoop — returnDirect termination (RC-6)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stops cleanly after a returnDirect tool: handler fires once, no re-POST flood, no cap warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const finishHandler = vi.fn<ClientToolHandler>(() => ({ done: true }))

    // Step 0 = initial POST → model emits finish_task (returnDirect).
    // Step 1 = resume POST → graph ends WITHOUT recording a tool-result message.
    const agent = new FakeAgent([
      (msgs) => msgs.push(assistantToolCall('tc-finish', 'finish_task')),
      () => {
        /* returnDirect: no tool-result message appears */
      },
    ])
    const svc = makeService(agent)

    await svc.sendMessage('finish up', noopCallbacks, {
      tools: [],
      clientToolHandlers: { finish_task: finishHandler },
    })

    expect(finishHandler).toHaveBeenCalledTimes(1)
    // Exactly two POSTs: the initial run + the single resume that delivers the
    // result. Pre-fix this ran until the 64-iteration cap.
    expect(agent.runAgentCalls).toBe(2)
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('runLoop exceeded iteration cap'),
    )
  })

  it('still resumes across a multi-client-tool turn, then terminates on the returnDirect tool', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const moveHandler = vi.fn<ClientToolHandler>(() => 'moved')
    const finishHandler = vi.fn<ClientToolHandler>(() => ({ done: true }))

    const agent = new FakeAgent([
      // Initial POST → model emits move_forward (a normal client tool).
      (msgs) => msgs.push(assistantToolCall('tc-move', 'move_forward')),
      // Resume of move_forward → server records its result AND the model emits
      // finish_task next.
      (msgs) => {
        msgs.push(toolResult('tc-move'))
        msgs.push(assistantToolCall('tc-finish', 'finish_task'))
      },
      // Resume of finish_task (returnDirect) → graph ends, no result message.
      () => {},
    ])
    const svc = makeService(agent)

    await svc.sendMessage('move then finish', noopCallbacks, {
      tools: [],
      clientToolHandlers: { move_forward: moveHandler, finish_task: finishHandler },
    })

    expect(moveHandler).toHaveBeenCalledTimes(1)
    expect(finishHandler).toHaveBeenCalledTimes(1)
    // initial + resume(move) + resume(finish) = 3 POSTs, then a clean stop.
    expect(agent.runAgentCalls).toBe(3)
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('runLoop exceeded iteration cap'),
    )
  })
})

describe('ChatService.runLoop — client-fulfilled results reach onToolCallResult (RC-14)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards a string handler result verbatim, with the tool call id and name', async () => {
    const envelope = JSON.stringify({ mimeType: 'image/png', data: 'abc123' })
    const moveHandler = vi.fn<ClientToolHandler>(() => envelope)
    const onToolCallResult = vi.fn()

    const agent = new FakeAgent([
      (msgs) => msgs.push(assistantToolCall('tc-move', 'move_forward')),
      (msgs) => msgs.push(toolResult('tc-move')),
    ])
    const svc = makeService(agent)

    await svc.sendMessage(
      'move',
      { ...noopCallbacks, onToolCallResult },
      { tools: [], clientToolHandlers: { move_forward: moveHandler } },
    )

    expect(onToolCallResult).toHaveBeenCalledWith('tc-move', 'move_forward', envelope)
  })

  it('JSON-stringifies a non-string handler result', async () => {
    const finishHandler = vi.fn<ClientToolHandler>(() => ({ done: true }))
    const onToolCallResult = vi.fn()

    const agent = new FakeAgent([
      (msgs) => msgs.push(assistantToolCall('tc-finish', 'finish_task')),
      () => {},
    ])
    const svc = makeService(agent)

    await svc.sendMessage(
      'finish',
      { ...noopCallbacks, onToolCallResult },
      { tools: [], clientToolHandlers: { finish_task: finishHandler } },
    )

    expect(onToolCallResult).toHaveBeenCalledWith('tc-finish', 'finish_task', '{"done":true}')
  })
})

describe('attachToolResult (RC-14)', () => {
  function toolPart(overrides: Partial<Extract<MessagePart, { kind: 'tool-call' }>> = {}): MessagePart {
    return {
      kind: 'tool-call',
      toolCallId: 'tc-1',
      toolCallName: 'capture_image',
      args: {},
      argsRaw: '{}',
      status: 'pending',
      ...overrides,
    }
  }

  it('attaches the result to the matching tool-call part and completes it', () => {
    const part = toolPart()
    const parts: MessagePart[] = [{ kind: 'text', text: 'hi' }, part]
    expect(attachToolResult(parts, 'tc-1', 'the-result')).toBe(true)
    expect(part).toMatchObject({ result: 'the-result', status: 'complete' })
  })

  it('does not clobber a result the streaming TOOL_CALL_RESULT path already set', () => {
    const part = toolPart({ result: 'from-stream', status: 'complete' })
    expect(attachToolResult([part], 'tc-1', 'late-duplicate')).toBe(false)
    expect((part as { result?: string }).result).toBe('from-stream')
  })

  it('leaves non-matching ids and non-tool parts untouched', () => {
    const other = toolPart({ toolCallId: 'tc-2' })
    const parts: MessagePart[] = [{ kind: 'text', text: 'hi' }, other]
    expect(attachToolResult(parts, 'tc-1', 'x')).toBe(false)
    expect((other as { result?: string }).result).toBeUndefined()
  })
})
