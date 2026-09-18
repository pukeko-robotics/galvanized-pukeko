/**
 * Headless-mode glue (P2b increment 3).
 *
 * Drives the bespoke Pukeko chat components from CopilotKit composables instead
 * of the bespoke `chatService`. The contract that lets this work is the one
 * spike-1 nailed down: gsloth's server speaks the **C-a** client-tool flow —
 * the client fulfils a frontend tool, CopilotKit re-runs the agent with the
 * tool result appended as a trailing `tool` message, and the server's
 * `apiAgUiModule` translates that into the LangGraph interrupt resume. That is
 * exactly what `useFrontendTool` emits, so registering client tools with
 * CopilotKit reconciles the interrupt/resume the bespoke `chatService.runLoop`
 * hand-rolls — no bespoke resume loop needed in headless mode.
 *
 * This module only projects `agent.messages` into the render-friendly
 * `ChatBubble` shape the bespoke bubbles consume; the run lifecycle (send,
 * resume, abort) is owned by CopilotKit core.
 */
import type { MessagePart } from '../services/chatService'
import type { ContextFold } from '../services/contextCompaction'

/**
 * An agent message as it appears on `AbstractAgent.messages`.
 *
 * `role` covers `user` / `assistant` / `tool` / `system` and — RC-47 —
 * `reasoning`: `@ag-ui/client` keeps the model's thinking as a first-class
 * message of its own, whose `content` accumulates as REASONING_MESSAGE_CONTENT
 * arrives and is flushed to the full value on REASONING_MESSAGE_END. It is a
 * separate message from the assistant message of the same turn, and it arrives
 * ahead of it.
 */
export interface AgentMessageLike {
  id: string
  role: string
  content?: string | null
  toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>
  toolCallId?: string
}

export type ChatBubble =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; parts: MessagePart[] }
  // RC-68: the conversation was folded at this point in the stream.
  | { kind: 'fold'; id: string; fold: ContextFold }

/**
 * RC-68 — one context fold, positioned in a message LOG.
 *
 * The bespoke surface can hold the fold as a part of the turn it interrupted,
 * because it builds the turn from the event stream and the event arrives inside
 * it. This surface cannot: a `CUSTOM` event is not a message and never enters
 * `agent.messages` (measured against `@ag-ui/client` 0.0.59 — the log is the
 * same length before, during and after the event), so `toBubbles` cannot see it
 * at all. The position therefore has to be carried alongside the log.
 *
 * It is carried as a COUNT and not as the id of the message it followed.
 * `toBubbles` does not emit one bubble per message — a `tool` message emits
 * none, reasoning may still be held open, and reasoning merges into the
 * assistant bubble of its turn — so anchoring to a message id means a fold
 * whose anchor emitted no bubble has nowhere to land, and it would be dropped:
 * the exact failure this node exists to fix. A count always falls between two
 * messages, so every fold lands somewhere.
 */
export interface ContextFoldMarker {
  /** Stable key for the emitted bubble. */
  id: string
  /** `messages.length` when the event arrived — the fold's place in the log. */
  afterMessageCount: number
  fold: ContextFold
}

function parseArgs(raw: string): { args: unknown; argsRaw: string } {
  try {
    return { args: raw ? JSON.parse(raw) : {}, argsRaw: raw }
  } catch {
    return { args: {}, argsRaw: raw }
  }
}

/**
 * Fold a flat agent message log into chat bubbles. Assistant text + tool calls
 * for one turn are merged into a single assistant bubble (mirroring the bespoke
 * `AssistantStreamingMessage` shape), and `tool` messages are attached as the
 * matching tool-call's result so {@link ToolCallBadge} can show args+result.
 *
 * Reasoning (RC-47) rides the same bubble as the turn it belongs to: a
 * `reasoning` message becomes a `thinking` part held open until the assistant
 * message of that turn arrives, at which point thinking + text + tool calls
 * render as one AI bubble — the same grouping the bespoke `chatService` builds
 * from the event stream. While reasoning is still streaming there is no
 * assistant message yet, so the open thinking parts are emitted as a bubble of
 * their own, keyed by the first reasoning message's id so the bubble does not
 * remount when the assistant text later joins it.
 *
 * `done` mirrors `chatService`: a thinking part closes once the model has moved
 * on. The message log cannot observe REASONING_MESSAGE_END, so the rule here is
 * that anything appearing after a reasoning message closes it, and only the
 * last message in the log can leave one open.
 *
 * RC-68: `folds` are context-fold markers to splice into the stream at the
 * position each was recorded at (see {@link ContextFoldMarker}). They live
 * outside the message log because the event that produces them never enters it.
 */
export function toBubbles(
  messages: ReadonlyArray<AgentMessageLike>,
  folds: ReadonlyArray<ContextFoldMarker> = [],
): ChatBubble[] {
  const bubbles: ChatBubble[] = []
  // toolCallId -> the tool-call part, so a later `tool` message can fill result.
  const toolPartIndex = new Map<string, Extract<MessagePart, { kind: 'tool-call' }>>()

  // Thinking parts awaiting the assistant message of their turn.
  let openThinking: Array<Extract<MessagePart, { kind: 'thinking' }>> = []
  let openThinkingId: string | null = null

  /** Close every held thinking part — something has followed them. */
  function closeThinking(): void {
    for (const part of openThinking) part.done = true
  }

  /** Emit the held thinking parts as a bubble of their own, in log order. */
  function flushThinking(): void {
    if (openThinking.length > 0 && openThinkingId !== null) {
      bubbles.push({ kind: 'assistant', id: openThinkingId, parts: openThinking })
    }
    openThinking = []
    openThinkingId = null
  }

  // RC-68: folds in position order. `sort` is stable, so two folds recorded at
  // the same count keep the order they arrived in.
  const pendingFolds = [...folds].sort((a, b) => a.afterMessageCount - b.afterMessageCount)
  let nextFold = 0

  /** Emit every fold recorded at or before `count` consumed messages. */
  function flushFoldsThrough(count: number): void {
    while (nextFold < pendingFolds.length && pendingFolds[nextFold].afterMessageCount <= count) {
      const marker = pendingFolds[nextFold]
      nextFold += 1
      // The server ends any open reasoning before it sends the fold, so
      // thinking held at this point belongs above the marker, not below it.
      closeThinking()
      flushThinking()
      bubbles.push({ kind: 'fold', id: marker.id, fold: marker.fold })
    }
  }

  function consume(m: AgentMessageLike): void {
    if (m.role === 'reasoning') {
      // A new reasoning message means the previous one finished.
      closeThinking()
      const part: Extract<MessagePart, { kind: 'thinking' }> = {
        kind: 'thinking',
        text: m.content ?? '',
        done: false,
      }
      openThinking.push(part)
      openThinkingId ??= m.id
      return
    }

    if (m.role === 'user') {
      closeThinking()
      flushThinking()
      // Skip the serialized-A2UI-action messages from cluttering the transcript?
      // Keep them visible — they're genuine user turns.
      bubbles.push({ kind: 'user', id: m.id, text: m.content ?? '' })
      return
    }

    if (m.role === 'assistant') {
      const parts: MessagePart[] = []
      if (m.content) parts.push({ kind: 'text', text: m.content })
      for (const tc of m.toolCalls ?? []) {
        const { args, argsRaw } = parseArgs(tc.function.arguments)
        const part: Extract<MessagePart, { kind: 'tool-call' }> = {
          kind: 'tool-call',
          toolCallId: tc.id,
          toolCallName: tc.function.name,
          args,
          argsRaw,
          status: 'pending',
        }
        parts.push(part)
        toolPartIndex.set(tc.id, part)
      }
      if (parts.length > 0) {
        // The turn moved on to text or a tool call: close the thinking that led
        // to it and render both in one bubble, thinking first (log order).
        closeThinking()
        const id = openThinkingId ?? m.id
        bubbles.push({ kind: 'assistant', id, parts: [...openThinking, ...parts] })
        openThinking = []
        openThinkingId = null
      }
      return
    }

    if (m.role === 'tool' && m.toolCallId) {
      const part = toolPartIndex.get(m.toolCallId)
      if (part) {
        part.result = m.content ?? ''
        part.status = 'complete'
      }
    }
    // system/developer messages are not rendered.
  }

  // A fold recorded against an empty log belongs before everything.
  flushFoldsThrough(0)
  for (let i = 0; i < messages.length; i++) {
    consume(messages[i])
    flushFoldsThrough(i + 1)
  }

  // Reasoning that is still streaming (or that ended the log) has no assistant
  // message to join yet — show it, still open, so thinking is visible live.
  flushThinking()

  // Any fold recorded past the end of the log — the event arrived before the
  // message that follows it was recorded, which is the ordinary case while a
  // turn is still streaming. It still belongs on screen, at the end.
  flushFoldsThrough(Number.POSITIVE_INFINITY)

  return bubbles
}
