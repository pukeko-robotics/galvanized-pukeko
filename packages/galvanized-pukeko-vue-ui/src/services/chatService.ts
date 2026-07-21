import { ref, type Ref } from 'vue'
import { configService } from './configService'
import { HttpAgent } from '@ag-ui/client'
import type { AgentSubscriber } from '@ag-ui/client'
import type { Message, UserMessage, Tool } from '@ag-ui/client'

// @ag-ui/client (>=0.0.54) stores the fetch impl as `this.fetch` and invokes it
// as a method, which detaches the global `fetch` from its `window` receiver and
// throws "Illegal invocation" in browsers (Node is lenient, so it only fails in
// the UI). Hand HttpAgent an explicitly-bound fetch so the receiver is correct.
const boundFetch: typeof fetch = (...args) => globalThis.fetch(...args)

// Run-state machine. Surfaces the silent gap between TOOL_CALL_RESULT and the
// next REASONING_MESSAGE_START so the UI can show a progress indicator.
export type RunState = 'idle' | 'streaming' | 'running-tool' | 'waiting'

export const runState: Ref<RunState> = ref('idle')
export const statusText: Ref<string> = ref('')

function setRunState(state: RunState, text: string): void {
  runState.value = state
  statusText.value = text
}

export type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string; done: boolean }
  | {
      kind: 'tool-call'
      toolCallId: string
      toolCallName: string
      args: unknown
      argsRaw: string
      result?: string
      status: 'pending' | 'complete'
    }

/** A single tool-call part of an assistant message (call + optional result). */
export type ToolCallPart = Extract<MessagePart, { kind: 'tool-call' }>

export interface AssistantStreamingMessage {
  id: string
  parts: MessagePart[]
  done: boolean
}

/**
 * Attach a tool result to the matching tool-call part in `parts`, in place.
 * Returns whether anything changed. Skips parts that already carry a result
 * (the streaming TOOL_CALL_RESULT path got there first — this is then a no-op).
 *
 * Exists for the client-fulfilled tool path (RC-14): those handlers run in
 * `runLoop` *after* RUN_FINISHED and their result rides the next resume POST,
 * not a TOOL_CALL_RESULT event on the run's subscriber — so without an explicit
 * attach the stored part would never receive its result and a per-tool result
 * renderer (PLAT-17) could never mount for them.
 */
export function attachToolResult(parts: MessagePart[], toolCallId: string, content: string): boolean {
  let changed = false
  for (const part of parts) {
    if (part.kind === 'tool-call' && part.toolCallId === toolCallId && part.result == null) {
      part.result = content
      part.status = 'complete'
      changed = true
    }
  }
  return changed
}

export interface ChatCallbacks {
  onRunStart?: (runId: string) => void
  onMessageUpdate: (msg: AssistantStreamingMessage) => void
  onToolCallStart?: (toolCallId: string, toolCallName: string) => void
  onToolCallEnd?: (toolCallId: string, toolCallName: string, toolCallBuffer: string) => void
  onToolCallResult?: (toolCallId: string, toolCallName: string, content: string) => void
  onError: (error: string) => void
}

export type ClientToolHandler = (
  args: unknown,
  ctx: { toolCallId: string; signal: AbortSignal },
) => Promise<unknown> | unknown

export interface SendMessageOptions {
  tools?: Tool[]
  clientToolHandlers?: Record<string, ClientToolHandler>
}

function buildSubscriber(callbacks: ChatCallbacks): AgentSubscriber {
  const toolCallBuffers = new Map<string, string>()
  const toolCallNames = new Map<string, string>()

  let currentMsg: AssistantStreamingMessage = { id: '', parts: [], done: false }
  let currentTextPart: { kind: 'text'; text: string } | null = null
  let currentThinkingPart: { kind: 'thinking'; text: string; done: boolean } | null = null

  function emit() {
    callbacks.onMessageUpdate({
      id: currentMsg.id,
      parts: currentMsg.parts.map((p) => ({ ...p })),
      done: currentMsg.done,
    })
  }

  function findToolPart(toolCallId: string) {
    for (let i = currentMsg.parts.length - 1; i >= 0; i--) {
      const p = currentMsg.parts[i]
      if (p.kind === 'tool-call' && p.toolCallId === toolCallId) return p
    }
    return null
  }

  return {
    onRunStartedEvent({ event }) {
      currentMsg = { id: '', parts: [], done: false }
      currentTextPart = null
      currentThinkingPart = null
      setRunState('waiting', 'Waiting for model…')
      callbacks.onRunStart?.(event.runId)
    },
    onTextMessageStartEvent({ event }) {
      if (!currentMsg.id) currentMsg.id = event.messageId
      // Text always closes any open thinking block — model has stopped reasoning
      // and started answering.
      if (currentThinkingPart) {
        currentThinkingPart.done = true
        currentThinkingPart = null
      }
      currentTextPart = { kind: 'text', text: '' }
      currentMsg.parts.push(currentTextPart)
      setRunState('streaming', 'Responding…')
      emit()
    },
    onReasoningMessageStartEvent({ event }) {
      if (!currentMsg.id) currentMsg.id = event.messageId
      currentTextPart = null
      currentThinkingPart = { kind: 'thinking', text: '', done: false }
      currentMsg.parts.push(currentThinkingPart)
      setRunState('streaming', 'Thinking…')
      emit()
    },
    onReasoningMessageContentEvent({ reasoningMessageBuffer }) {
      if (!currentThinkingPart) {
        currentThinkingPart = { kind: 'thinking', text: '', done: false }
        currentMsg.parts.push(currentThinkingPart)
      }
      currentThinkingPart.text = reasoningMessageBuffer
      emit()
    },
    onReasoningMessageEndEvent({ reasoningMessageBuffer }) {
      if (currentThinkingPart) {
        // Same one-delta lag as text (see onTextMessageEndEvent): the streamed
        // reasoningMessageBuffer trails by one delta, and the END event carries
        // the fully-accumulated value. Flush it so thinking isn't clipped.
        currentThinkingPart.text = reasoningMessageBuffer
        currentThinkingPart.done = true
        currentThinkingPart = null
        emit()
      }
    },
    onTextMessageContentEvent({ textMessageBuffer }) {
      if (!currentTextPart) {
        currentTextPart = { kind: 'text', text: '' }
        currentMsg.parts.push(currentTextPart)
      }
      currentTextPart.text = textMessageBuffer
      emit()
    },
    onTextMessageEndEvent({ textMessageBuffer }) {
      // AG-UI delivers `textMessageBuffer` to onTextMessageContentEvent *before*
      // appending the current delta (the same one-delta lag the tool-call args
      // path documents in onToolCallEndEvent). The streamed text part therefore
      // always trails one delta behind; the END event carries the fully
      // accumulated text. Flush it so the finalized bubble keeps its last
      // token(s) — otherwise every assistant reply is clipped at the end.
      if (currentTextPart) {
        currentTextPart.text = textMessageBuffer
      }
      currentTextPart = null
      emit()
    },
    onToolCallStartEvent({ event }) {
      console.log('[ChatService] Tool call start:', event.toolCallId, event.toolCallName)
      toolCallBuffers.set(event.toolCallId, '')
      toolCallNames.set(event.toolCallId, event.toolCallName)
      setRunState('running-tool', `Running ${event.toolCallName}…`)
      if (!currentMsg.id) currentMsg.id = event.parentMessageId ?? event.toolCallId
      currentTextPart = null
      if (currentThinkingPart) {
        currentThinkingPart.done = true
        currentThinkingPart = null
      }
      currentMsg.parts.push({
        kind: 'tool-call',
        toolCallId: event.toolCallId,
        toolCallName: event.toolCallName,
        args: {},
        argsRaw: '',
        status: 'pending',
      })
      emit()
      callbacks.onToolCallStart?.(event.toolCallId, event.toolCallName)
    },
    onToolCallArgsEvent({ event, toolCallBuffer, toolCallName }) {
      console.log('[ChatService] Tool call args:', toolCallName, toolCallBuffer)
      toolCallBuffers.set(event.toolCallId, toolCallBuffer)
      const part = findToolPart(event.toolCallId)
      if (part && part.kind === 'tool-call') {
        part.argsRaw = toolCallBuffer
        emit()
      }
    },
    onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
      console.log('[ChatService] Tool call end:', toolCallName, toolCallArgs)
      const buffer = toolCallBuffers.get(event.toolCallId) ?? ''
      toolCallBuffers.delete(event.toolCallId)
      const part = findToolPart(event.toolCallId)
      if (part && part.kind === 'tool-call') {
        part.args = toolCallArgs ?? {}
        if (toolCallName) part.toolCallName = toolCallName
        // Stay 'pending' until the result arrives.
        emit()
      }
      // `toolCallArgs` is the fully-accumulated, parsed args. The streamed
      // `buffer` lags one delta behind — AG-UI fires onToolCallArgsEvent with
      // the buffer *before* appending the current delta, so for tool calls sent
      // as a single args delta (e.g. Ollama) the buffer is empty and the args
      // only ever materialise here. Forward the parsed args; fall back to the
      // raw buffer only when parsing produced nothing.
      const argsString =
        toolCallArgs && Object.keys(toolCallArgs).length > 0
          ? JSON.stringify(toolCallArgs)
          : buffer
      callbacks.onToolCallEnd?.(event.toolCallId, toolCallName ?? '', argsString)
    },
    onToolCallResultEvent({ event }) {
      console.log('[ChatService] Tool call result:', event.toolCallId)
      const toolCallName = toolCallNames.get(event.toolCallId) ?? ''
      const part = findToolPart(event.toolCallId)
      if (part && part.kind === 'tool-call') {
        part.result = event.content ?? ''
        part.status = 'complete'
        emit()
      }
      // Tool result is in; the model is about to (silently) chew on the new
      // image / text before its next token. Surface that gap.
      setRunState('waiting', 'Waiting for model…')
      callbacks.onToolCallResult?.(event.toolCallId, toolCallName, event.content ?? '')
    },
    onRunFinishedEvent() {
      currentMsg.done = true
      // Mark any still-pending tool calls as complete; the run is over.
      for (const part of currentMsg.parts) {
        if (part.kind === 'tool-call' && part.status === 'pending') {
          part.status = 'complete'
        } else if (part.kind === 'thinking' && !part.done) {
          part.done = true
        }
      }
      currentThinkingPart = null
      setRunState('idle', '')
      emit()
    },
    onRunErrorEvent({ event }) {
      console.error('[ChatService] Run error:', event.message)
      setRunState('idle', '')
      callbacks.onError(event.message)
    },
  }
}

// Walk the agent's message log and return tool calls (in order) that have no
// matching tool-result message and whose name the caller registered a handler
// for. The server-side LangGraph interrupt pauses at the first client tool, so
// in practice this returns 0 or 1 entries per run.
function findUnfulfilledClientToolCalls(
  messages: Message[],
  handlers: Record<string, ClientToolHandler> | undefined,
  afterMessageId?: string,
): Array<{ id: string; name: string; argsRaw: string }> {
  if (!handlers) return []
  // When a turn is started by a fresh user message (afterMessageId), only
  // fulfil tool calls the model emits AFTER it. A tool call left dangling
  // *before* it belongs to an earlier run the operator stopped/abandoned and
  // must NOT be silently replayed — otherwise continuing the conversation
  // re-issues e.g. a robot motion that was deliberately interrupted, and the
  // resume kicks the agent back into its old loop. See the stop() handler.
  let startIndex = 0
  if (afterMessageId) {
    const idx = messages.findIndex((m) => m.id === afterMessageId)
    if (idx >= 0) startIndex = idx + 1
  }
  const haveResultFor = new Set<string>()
  for (const m of messages) {
    if (m.role === 'tool') {
      const id = (m as { toolCallId?: string }).toolCallId
      if (id) haveResultFor.add(id)
    }
  }
  const unfulfilled: Array<{ id: string; name: string; argsRaw: string }> = []
  for (let i = startIndex; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    const toolCalls = (m as { toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }> }).toolCalls
    if (!toolCalls) continue
    for (const tc of toolCalls) {
      if (haveResultFor.has(tc.id)) continue
      if (!handlers[tc.function.name]) continue
      unfulfilled.push({ id: tc.id, name: tc.function.name, argsRaw: tc.function.arguments })
    }
  }
  return unfulfilled
}

export class ChatService {
  private agent: HttpAgent | null = null
  // Latched by stop(); blocks the tool-fulfilment loop from resuming the agent.
  // Cleared when a new message is sent or the thread is reset.
  private stopped = false
  // Plumbed into client tool handlers so an operator stop can cancel an
  // in-flight client tool call (e.g. a fetch), not just the next resume run.
  private runAbort: AbortController | null = null
  // Follow-up messages queued mid-task, drained into the next resume so the
  // agent sees them at its next decision point without aborting the in-flight
  // task.
  private messageQueue: string[] = []

  get isStopped(): boolean {
    return this.stopped
  }

  /** True while a run loop is in flight (a task that can accept queued input). */
  get isRunning(): boolean {
    return this.runAbort !== null
  }

  /**
   * Queue a follow-up message mid-task. If a run is in flight the text rides
   * along with the next resume (delivered to the agent on its next decision
   * turn — no abort, no dangling tool call). If the agent is idle it falls back
   * to a normal {@link sendMessage}.
   */
  async queueMessage(
    text: string,
    callbacks: ChatCallbacks,
    opts?: SendMessageOptions,
  ): Promise<void> {
    if (!this.isRunning || this.stopped) {
      return this.sendMessage(text, callbacks, opts)
    }
    console.log('[ChatService] Queuing follow-up message:', text)
    this.messageQueue.push(text)
  }

  /**
   * Operator interrupt ("emergency stop"). Aborts any in-flight model stream
   * and latches `stopped` so the client-tool resume loop won't restart the
   * agent. An in-flight client tool can't be interrupted mid-call, but no
   * further turns will run. Re-armed by sendMessage()/resetThread().
   */
  stop(): void {
    this.stopped = true
    // Drop any queued messages — they belonged to the task being stopped.
    this.messageQueue = []
    // Cancel an in-flight client tool handler (e.g. a fetch).
    this.runAbort?.abort()
    if (this.agent) {
      try {
        this.agent.abortRun()
      } catch {
        // abortRun() on an idle agent is a no-op; ignore.
      }
    }
    setRunState('idle', 'Stopped by operator')
  }

  private ensureAgent(): HttpAgent {
    if (!this.agent) {
      const config = configService.get()
      this.agent = new HttpAgent({
        url: config.agUiUrl,
        fetch: boundFetch,
      })
    }
    return this.agent
  }

  resetThread(): void {
    // Deliberately do NOT clear `stopped` here. "New conversation" calls stop()
    // and then resetThread() back-to-back; the stop() aborts the in-flight
    // fetch, whose rejection arrives a tick later and is suppressed only while
    // `stopped` is latched (see ChatInterface onError / sendMessage catch). The
    // next sendMessage() re-arms the agent, so leaving it latched is safe.
    this.messageQueue = []
    const config = configService.get()
    this.agent = new HttpAgent({
      url: config.agUiUrl,
      fetch: boundFetch,
    })
  }

  getThreadId(): string {
    return this.ensureAgent().threadId
  }

  async sendMessage(text: string, callbacks: ChatCallbacks, opts?: SendMessageOptions): Promise<void> {
    // A fresh user message re-arms the agent after an operator stop.
    this.stopped = false
    const agent = this.ensureAgent()

    console.log('[ChatService] Sending message:', text)

    const userMessage: UserMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    }
    agent.addMessage(userMessage)

    console.log('[ChatService] AG-UI request to:', agent.url)

    try {
      await this.runLoop(agent, callbacks, opts ?? {}, userMessage.id)
    } catch (error) {
      console.error('[ChatService] Error sending message:', error)
      agent.messages = agent.messages.filter((m: Message) => m.id !== userMessage.id)
      throw error
    }
  }

  /**
   * Submit a user action (e.g. form submission) as a user message and stream the follow-up response.
   * User actions are NOT sent as tool messages — the show_a2ui_surface tool call is already resolved
   * once the surfaceJsonl is returned. A second tool message for the same toolCallId would be invalid.
   */
  async submitToolResult(
    _toolCallId: string,
    content: string,
    callbacks?: ChatCallbacks,
  ): Promise<void> {
    if (this.stopped) return
    const agent = this.ensureAgent()

    console.log('[ChatService] submitUserAction:', content)

    const userMessage: UserMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content,
    }
    agent.addMessage(userMessage)

    if (!callbacks) return

    await this.runLoop(agent, callbacks, {}, userMessage.id)
  }

  /**
   * Drives one user turn end-to-end: send the prompt, await runAgent (which
   * resolves on RUN_FINISHED — the server pauses at the first client-tool
   * interrupt), then walk the message log for any unfulfilled client tool
   * call, run its handler, and resume. Repeat until no client tool calls are
   * outstanding.
   *
   * Mirrors CopilotKit's `run-handler.ts:runAgent` + `processAgentResult`
   * loop. The key invariant is that the prior run is fully torn down before a
   * new POST is issued — so concurrent SSE streams over the same thread_id
   * can't race on the langgraph checkpoint.
   */
  private async runLoop(
    agent: HttpAgent,
    callbacks: ChatCallbacks,
    opts: SendMessageOptions,
    boundaryMessageId?: string,
  ): Promise<void> {
    this.runAbort = new AbortController()
    let forwardedProps: Record<string, unknown> | undefined
    // Client tool calls whose handler has already run this turn. A
    // `returnDirect` tool (e.g. `finish_task`) ends the server-side graph
    // without leaving a matching tool-result message in `agent.messages`, so
    // `findUnfulfilledClientToolCalls` keeps reporting it as unfulfilled on
    // every later pass. Tracking the ids we've fulfilled lets us tell that
    // reappearance (turn is finalized, stop) apart from a genuinely new tool
    // call (fresh id, keep resuming).
    const fulfilledIds = new Set<string>()
    try {
      // Bounded so a buggy handler/server can't spin us forever.
      for (let i = 0; i < 64; i++) {
        if (this.stopped) return

        // Tear down any previous run's RxJS pipeline before starting a new
        // POST. detachActiveRun() is a no-op if nothing is in flight.
        await agent.detachActiveRun()

        await agent.runAgent(
          {
            tools: opts.tools,
            ...(forwardedProps ? { forwardedProps } : {}),
          },
          buildSubscriber(callbacks),
        )

        if (this.stopped) return

        const unfulfilled = findUnfulfilledClientToolCalls(
          agent.messages,
          opts.clientToolHandlers,
          boundaryMessageId,
        )
        // Only tools we haven't already fulfilled this turn are outstanding
        // work — this is what stops a `returnDirect` tool from re-POSTing
        // forever (its id lingers "unfulfilled" but is already handled). The
        // server interrupts at the first client tool, so in practice at most
        // one genuinely-new call appears per pass.
        const next = unfulfilled.find((tc) => !fulfilledIds.has(tc.id))
        if (!next) {
          // No new client tools to fulfil. If a message was queued after the
          // agent's last decision (so it never rode a resume), deliver it now
          // as a fresh, non-resume turn so the agent still acts on it.
          if (this.messageQueue.length > 0 && !this.stopped) {
            for (const text of this.messageQueue.splice(0)) {
              agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: text })
            }
            forwardedProps = undefined
            continue
          }
          return
        }
        const handler = opts.clientToolHandlers![next.name]
        let args: unknown = {}
        try {
          args = next.argsRaw ? JSON.parse(next.argsRaw) : {}
        } catch (e) {
          console.warn('[ChatService] Failed to parse tool args', e)
        }

        let resumeValue: unknown
        try {
          resumeValue = await handler(args, {
            toolCallId: next.id,
            signal: this.runAbort.signal,
          })
        } catch (error) {
          console.error('[ChatService] Client tool handler error', error)
          resumeValue = JSON.stringify({ error: String(error) })
        }

        if (this.stopped) return

        // Handler has run; don't fulfil this id again even if the server never
        // records a tool-result message for it (the returnDirect case).
        fulfilledIds.add(next.id)

        // Surface the client-fulfilled result to the UI (RC-14). This runs
        // after RUN_FINISHED — the result rides the resume POST below, never a
        // TOOL_CALL_RESULT event on this run's subscriber — so this callback is
        // the badge's only path to a client tool's result. Consumers (e.g.
        // ChatInterface) attach it to the stored tool-call part.
        const resultContent =
          typeof resumeValue === 'string' ? resumeValue : (JSON.stringify(resumeValue) ?? '')
        callbacks.onToolCallResult?.(next.id, next.name, resultContent)

        // Drain any queued messages onto this resume so the agent sees them
        // alongside the tool result, before it decides the next action.
        const queuedMessages = this.messageQueue.splice(0)
        forwardedProps = {
          command: {
            resume: resumeValue,
            interruptEvent: { toolCallId: next.id },
            ...(queuedMessages.length > 0 ? { queuedMessages } : {}),
          },
        }
      }
      console.warn('[ChatService] runLoop exceeded iteration cap; bailing out.')
    } finally {
      this.runAbort = null
    }
  }
}

export const chatService = new ChatService()
// Re-export the @ag-ui/client types that are part of this library's public API
// (chatService.sendMessage takes `Tool[]`; messages are `Message`/`UserMessage`)
// so consumers depend on vue-ui rather than reaching past it to @ag-ui/client.
export type { Message, Tool, UserMessage }
