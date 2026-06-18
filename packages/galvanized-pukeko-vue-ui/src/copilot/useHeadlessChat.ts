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

/** An agent message as it appears on `AbstractAgent.messages`. */
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
 */
export function toBubbles(messages: ReadonlyArray<AgentMessageLike>): ChatBubble[] {
  const bubbles: ChatBubble[] = []
  // toolCallId -> the tool-call part, so a later `tool` message can fill result.
  const toolPartIndex = new Map<string, Extract<MessagePart, { kind: 'tool-call' }>>()

  for (const m of messages) {
    if (m.role === 'user') {
      // Skip the serialized-A2UI-action messages from cluttering the transcript?
      // Keep them visible — they're genuine user turns.
      bubbles.push({ kind: 'user', id: m.id, text: m.content ?? '' })
      continue
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
      if (parts.length > 0) bubbles.push({ kind: 'assistant', id: m.id, parts })
      continue
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

  return bubbles
}
