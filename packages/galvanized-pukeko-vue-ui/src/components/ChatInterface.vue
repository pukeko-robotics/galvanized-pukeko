<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from 'vue'
import PkButton from './PkButton.vue'
import PkInput from './PkInput.vue'
import PkNewConversationButton from './PkNewConversationButton.vue'
import PkProgressBar from './PkProgressBar.vue'
import ToolCallBadge from './ToolCallBadge.vue'
import {chatService, runState, statusText} from '../services/chatService'
import type {
  AssistantStreamingMessage,
  ChatCallbacks,
  ClientToolHandler,
  MessagePart,
} from '../services/chatService'
import { parseA2UIJsonl } from '../composables/useA2UI'
import type { useA2UI } from '../composables/useA2UI'
import type { Tool } from '@ag-ui/client'

interface UserChatMessage {
  kind: 'user'
  id: number | string
  text: string
}

interface AssistantChatMessage {
  kind: 'assistant'
  id: string
  parts: MessagePart[]
  done: boolean
}

// A system-level notice (e.g. "stopped by you") — deliberately distinct from an
// error so the operator can tell a deliberate interrupt apart from a failure.
interface NoticeChatMessage {
  kind: 'notice'
  id: number | string
  text: string
}

type ChatMessage = UserChatMessage | AssistantChatMessage | NoticeChatMessage

const props = defineProps<{
  a2ui?: ReturnType<typeof useA2UI>
  clientTools?: Tool[]
  clientToolHandlers?: Record<string, ClientToolHandler>
}>()

const messages = ref<ChatMessage[]>([])
const newMessage = ref('')
const isLoading = ref(false)

const messagesEl = ref<HTMLElement | null>(null)
const userHasScrolledUp = ref(false)
const NEAR_BOTTOM_PX = 64

function scrollToBottom() {
  const el = messagesEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function onScroll() {
  const el = messagesEl.value
  if (!el) return
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  userHasScrolledUp.value = distance > NEAR_BOTTOM_PX
}

watch(
  messages,
  () => {
    nextTick(() => {
      if (!userHasScrolledUp.value) scrollToBottom()
    })
  },
  { deep: true }
)

onMounted(() => {
  messages.value.push({
    kind: 'assistant',
    id: `greeting-${Date.now()}`,
    parts: [{ kind: 'text', text: 'Hello! How can I help you today?' }],
    done: true,
  })
  nextTick(scrollToBottom)
})

function upsertAssistantMessage(msg: AssistantStreamingMessage) {
  const last = messages.value[messages.value.length - 1]
  const next: AssistantChatMessage = {
    kind: 'assistant',
    id: msg.id,
    parts: msg.parts,
    done: msg.done,
  }
  if (last && last.kind === 'assistant' && last.id === msg.id && !last.done) {
    messages.value.splice(messages.value.length - 1, 1, next)
  } else {
    messages.value.push(next)
  }
}

function createStreamCallbacks(): ChatCallbacks {
  const callbacks: ChatCallbacks = {
    onMessageUpdate(msg) {
      upsertAssistantMessage(msg)
    },
    onToolCallStart(toolCallId: string, toolCallName: string) {
      if (toolCallName === 'show_a2ui_surface' && props.a2ui) {
        props.a2ui.pendingToolCallId.value = toolCallId
      }
    },
    onToolCallEnd(_toolCallId: string, _toolCallName: string, _toolCallBuffer: string) {
      // Client-tool fulfilment is owned by chatService.runLoop now (it walks
      // the message log after RUN_FINISHED). Firing the handler here would
      // race the still-open SSE stream against the resume POST.
    },
    onToolCallResult(toolCallId: string, toolCallName: string, content: string) {
      if (toolCallName === 'show_a2ui_surface' && props.a2ui) {
        try {
          props.a2ui.processBatch(parseA2UIJsonl(content))
        } catch (e) {
          console.error('[ChatInterface] Failed to parse A2UI JSONL:', e, content)
        }
      }
    },
    onError(error: string) {
      // A deliberate stop aborts the in-flight fetch, which surfaces here as a
      // "BodyStreamBuffer was aborted" (or similar) error. That's not a failure
      // — the stop notice already covers it — so don't render an error bubble.
      if (chatService.isStopped) return
      messages.value.push({
        kind: 'assistant',
        id: `error-${Date.now()}`,
        parts: [{ kind: 'text', text: `Error: ${error}` }],
        done: true,
      })
    }
  }

  if (props.a2ui) {
    props.a2ui.setCallbacks(callbacks)
  }

  return callbacks
}

// While a run is in flight the composer becomes a queue channel: the message is
// queued and the agent picks it up at its next decision point, rather than the
// input being blocked.
const isQueueing = computed(() => isLoading.value)
const inputPlaceholder = computed(() =>
  isQueueing.value ? 'Queue a message… (applied at next step)' : 'Type a message...',
)
const sendButtonLabel = computed(() => (isQueueing.value ? 'Queue' : 'Send'))

const sendMessage = async () => {
  if (!newMessage.value.trim()) return

  const text = newMessage.value
  newMessage.value = ''
  messages.value.push({
    kind: 'user',
    id: Date.now(),
    text: text,
  })
  userHasScrolledUp.value = false

  // Mid-run: queue the message; the active run loop delivers it at the next step.
  if (isLoading.value) {
    void chatService.queueMessage(text, createStreamCallbacks(), {
      tools: props.clientTools,
      clientToolHandlers: props.clientToolHandlers,
    })
    return
  }

  isLoading.value = true

  try {
    await chatService.sendMessage(text, createStreamCallbacks(), {
      tools: props.clientTools,
      clientToolHandlers: props.clientToolHandlers,
    })
  } catch (error) {
    // A deliberate operator stop aborts the stream; that's not an error.
    if (chatService.isStopped) return
    console.error('Failed to send message:', error)
    const last = messages.value[messages.value.length - 1]
    const lastIsError =
      last?.kind === 'assistant' &&
      last.parts[0]?.kind === 'text' &&
      last.parts[0].text.startsWith('Error:')
    if (!lastIsError) {
      messages.value.push({
        kind: 'assistant',
        id: `error-${Date.now()}`,
        parts: [{ kind: 'text', text: 'Error sending message. Please try again.' }],
        done: true,
      })
    }
  } finally {
    isLoading.value = false
  }
}

const sendFormMessage = async (text: string) => {
  if (isLoading.value) return

  messages.value.push({
    kind: 'user',
    id: Date.now(),
    text: text,
  })

  isLoading.value = true
  userHasScrolledUp.value = false

  try {
    await chatService.sendMessage(text, createStreamCallbacks(), {
      tools: props.clientTools,
      clientToolHandlers: props.clientToolHandlers,
    })
  } catch (error) {
    if (chatService.isStopped) return
    console.error('Failed to send form message:', error)
    const last = messages.value[messages.value.length - 1]
    const lastIsError =
      last?.kind === 'assistant' &&
      last.parts[0]?.kind === 'text' &&
      last.parts[0].text.startsWith('Error:')
    if (!lastIsError) {
      messages.value.push({
        kind: 'assistant',
        id: `error-${Date.now()}`,
        parts: [{ kind: 'text', text: 'Error sending message. Please try again.' }],
        done: true,
      })
    }
  } finally {
    isLoading.value = false
  }
}

function stop() {
  chatService.stop()
  isLoading.value = false
  // Acknowledge the interrupt in-chat. Rendered as a muted notice, not the red
  // error bubble — a deliberate stop isn't a failure, and the conversation can
  // continue from here.
  messages.value.push({
    kind: 'notice',
    id: `notice-${Date.now()}`,
    text: 'Stopped by you. You can continue the conversation below.',
  })
}

// Start a fresh conversation. A plain clear leaves the server still generating
// (and the model streaming prose into the now-empty thread), so halt the
// in-flight run with the operator stop first, then reset.
function newConversation() {
  chatService.stop()
  isLoading.value = false
  clearHistory()
}

function clearHistory() {
  chatService.resetThread()
  messages.value = []
  // Restore the friendly greeting after a reset so the UI doesn't look empty.
  messages.value.push({
    kind: 'assistant',
    id: `greeting-${Date.now()}`,
    parts: [{ kind: 'text', text: 'Hello! How can I help you today?' }],
    done: true,
  })
}

defineExpose({
  sendFormMessage,
  clearHistory,
  newConversation,
  stop,
})
</script>

<template>
  <div class="chat-interface">
    <div class="chat-toolbar">
      <PkNewConversationButton @click="newConversation" />
    </div>
    <div class="messages" ref="messagesEl" @scroll="onScroll">
      <template v-for="item in messages" :key="item.id">
        <div
          v-if="item.kind === 'user'"
          class="message user"
        >
          <div class="message-content">{{ item.text }}</div>
        </div>
        <div
          v-else-if="item.kind === 'notice'"
          class="message notice"
        >
          <div class="message-content">{{ item.text }}</div>
        </div>
        <div
          v-else
          class="message ai"
          :class="{ streaming: !item.done }"
        >
          <div class="message-content">
            <template v-for="(part, i) in item.parts" :key="i">
              <span v-if="part.kind === 'text'" class="text-part">{{ part.text }}</span>
              <div
                v-else-if="part.kind === 'thinking'"
                class="thinking-part"
                :class="{ streaming: !part.done }"
              >{{ part.text }}</div>
              <ToolCallBadge v-else :part="part" />
            </template>
            <span v-if="!item.done" class="typing-indicator"></span>
          </div>
        </div>
      </template>
    </div>
    <PkProgressBar :run-state="runState" :status-text="statusText" />
    <div class="input-area">
      <PkInput
        v-model="newMessage"
        :placeholder="inputPlaceholder"
        @keyup.enter="sendMessage"
        name="chat-input"
      />
      <PkButton @click="sendMessage">{{ sendButtonLabel }}</PkButton>
      <PkButton
        v-if="isLoading"
        class="stop-button"
        title="Stop"
        @click="stop"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <rect x="1" y="1" width="10" height="10" rx="1" fill="currentColor" />
        </svg>
      </PkButton>
    </div>
    <div class="helper-text">
      {{
        isQueueing
          ? 'The agent is working — your message is queued for the next step.'
          : 'Click Send or press Enter to send your message'
      }}
    </div>
  </div>
</template>

<style scoped>
.chat-interface {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-right: var(--line-separator-subtle);
  background: var(--bg-input-idle);
  position: relative;
}

.chat-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 0.5rem 1rem;
  border-bottom: var(--line-separator-subtle);
  background: var(--pk-color-surface, #fff);
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.message {
  display: flex;
  max-width: 80%;
}

.message.user {
  align-self: flex-end;
}

.message.ai {
  align-self: flex-start;
}

.message.notice {
  align-self: center;
  max-width: 90%;
}

.message.notice .message-content {
  background-color: var(--pk-color-surface-muted, #f3f4f6);
  color: var(--pk-color-text-muted, #6b7280);
  font-size: 0.8rem;
  font-style: italic;
  text-align: center;
  border-radius: 0.75rem;
  padding: 0.4rem 0.9rem;
}

.message-content {
  padding: 0.75rem 1rem;
  border-radius: 1rem;
  font-size: 0.95rem;
  line-height: 1.4;
  word-wrap: break-word;
}

.message.user .message-content {
  background-color: var(--pk-color-primary, #3b82f6);
  color: var(--pk-color-on-primary, #fff);
  border-bottom-right-radius: 0.25rem;
  white-space: pre-wrap;
}

.message.ai .message-content {
  background-color: var(--pk-color-surface-muted, #f3f4f6);
  color: var(--pk-color-text, #1f2937);
  border-bottom-left-radius: 0.25rem;
}

.text-part {
  white-space: pre-wrap;
}

.thinking-part {
  font-size: 0.8rem;
  color: var(--pk-color-text-dim, #9ca3af);
  white-space: pre-wrap;
  font-style: italic;
  border-left: 2px solid var(--pk-color-border, #e5e7eb);
  padding: 0.25rem 0 0.25rem 0.6rem;
  margin: 0.4rem 0;
  line-height: 1.35;
}

.thinking-part.streaming::after {
  content: "▍";
  display: inline-block;
  margin-left: 1px;
  color: var(--pk-color-text-dim, #9ca3af);
  animation: blink 0.7s infinite;
}

.typing-indicator {
  display: inline-block;
  width: 0.5em;
  height: 1em;
  background-color: var(--pk-color-text-muted, #6b7280);
  margin-left: 2px;
  animation: blink 0.7s infinite;
  vertical-align: text-bottom;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.input-area {
  padding: 1rem;
  border-top: 1px solid var(--pk-color-border, #e5e7eb);
  display: flex;
  gap: 0.5rem;
  background: var(--pk-color-surface, #fff);
}

/* Small square interrupt button: just the rect glyph, shown only while running.
   The class lands on PkButton's root <button>, so target it directly (a
   descendant `:deep(button)` would match nothing). `.input-area` prefix lifts
   specificity above PkButton's own `.pk-button` rule. */
.input-area .stop-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: calc(calc(var(--nice-spacing-unit) + var(--padding-twothird)) + 2px);
  padding: 0;
  background: linear-gradient(var(--pk-color-danger, #d32f2f), var(--pk-color-danger-strong, #b71c1c));
  color: var(--pk-color-on-primary, #fff);
  border: 1px solid var(--pk-color-danger-strong, #b71c1c);
  border-radius: var(--border-radius-small-box);
}

.input-area .stop-button:hover {
  background: linear-gradient(var(--pk-color-danger-hover, #e53935), var(--pk-color-danger-hover-strong, #c62828));
  padding: 0;
}

.helper-text {
  padding: 0 1rem 1rem 1rem;
  font-size: 0.8rem;
  color: var(--pk-color-text-dim, #9ca3af);
  text-align: center;
  background: var(--pk-color-surface, #fff);
}
</style>
