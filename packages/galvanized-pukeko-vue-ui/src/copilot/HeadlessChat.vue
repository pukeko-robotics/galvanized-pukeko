<script setup lang="ts">
/**
 * Headless chat surface (P2b increment 3). Must be mounted inside a
 * CopilotKitProvider. Renders the bespoke Pukeko chat primitives (PkInput,
 * PkButton, bubble styling, ToolCallBadge, A2UI surfaces) but sources every bit
 * of state and the entire run lifecycle from CopilotKit composables — no
 * bespoke `chatService`.
 *
 * Client tools (if any) are registered by the host via `useFrontendTool` before
 * mounting this; CopilotKit + the gsloth C-a server flow handle the
 * interrupt/resume (see useHeadlessChat.ts). This component just sends user
 * turns and renders the resulting message log.
 */
import { computed, ref, watch, nextTick } from 'vue'
import { useAgent } from '@copilotkit/vue/v2'
import { useCopilotKit } from '@copilotkit/vue/v2'
import PkInput from '../components/PkInput.vue'
import PkButton from '../components/PkButton.vue'
import ToolCallBadge from '../components/ToolCallBadge.vue'
import A2UIRenderToolBridge from './A2UIRenderToolBridge.vue'
import { toBubbles, type AgentMessageLike } from './useHeadlessChat'

const props = withDefaults(defineProps<{ agentId?: string }>(), { agentId: 'default' })

const { copilotkit } = useCopilotKit()
const { agent } = useAgent({ agentId: props.agentId })

const draft = ref('')
const sending = ref(false)
const errorText = ref<string | null>(null)
const messagesEl = ref<HTMLElement | null>(null)

const bubbles = computed(() =>
  toBubbles((agent.value?.messages ?? []) as ReadonlyArray<AgentMessageLike>),
)

const isRunning = computed(() => sending.value || agent.value?.isRunning === true)

function scrollToBottom() {
  nextTick(() => {
    const el = messagesEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(bubbles, scrollToBottom, { deep: true })

async function send() {
  const text = draft.value.trim()
  if (!text || isRunning.value) return
  const current = agent.value
  if (!current) {
    errorText.value = 'No agent available'
    return
  }
  draft.value = ''
  errorText.value = null
  current.addMessage({ id: crypto.randomUUID(), role: 'user', content: text })
  sending.value = true
  try {
    await copilotkit.value.runAgent({ agent: current })
  } catch (e) {
    errorText.value = String(e)
    console.error('[HeadlessChat] run failed:', e)
  } finally {
    sending.value = false
  }
}

function stop() {
  try {
    agent.value?.abortRun()
  } catch {
    // abortRun on an idle agent is a no-op.
  }
  sending.value = false
}
</script>

<template>
  <div class="pk-headless-chat" data-testid="pk-headless-chat">
    <A2UIRenderToolBridge :agent-id="agentId" />
    <div class="messages" ref="messagesEl">
      <template v-for="bubble in bubbles" :key="bubble.id">
        <div v-if="bubble.kind === 'user'" class="message user" data-testid="pk-headless-user">
          <div class="message-content">{{ bubble.text }}</div>
        </div>
        <div v-else class="message ai" data-testid="pk-headless-assistant">
          <div class="message-content">
            <template v-for="(part, i) in bubble.parts" :key="i">
              <span v-if="part.kind === 'text'" class="text-part">{{ part.text }}</span>
              <div v-else-if="part.kind === 'thinking'" class="thinking-part">{{ part.text }}</div>
              <ToolCallBadge v-else :part="part" />
            </template>
          </div>
        </div>
      </template>
    </div>
    <div v-if="errorText" class="error-banner" data-testid="pk-headless-error">{{ errorText }}</div>
    <div class="input-area">
      <PkInput
        v-model="draft"
        placeholder="Type a message..."
        name="pk-headless-input"
        data-testid="pk-headless-input"
        @keyup.enter="send"
      />
      <PkButton data-testid="pk-headless-send" @click="send">Send</PkButton>
      <PkButton v-if="isRunning" class="stop-button" title="Stop" @click="stop">Stop</PkButton>
    </div>
  </div>
</template>

<style scoped>
.pk-headless-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-input-idle, #fff);
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
.message-content {
  padding: 0.75rem 1rem;
  border-radius: 1rem;
  font-size: 0.95rem;
  line-height: 1.4;
  word-wrap: break-word;
}
.message.user .message-content {
  background-color: #3b82f6;
  color: #fff;
  border-bottom-right-radius: 0.25rem;
  white-space: pre-wrap;
}
.message.ai .message-content {
  background-color: #f3f4f6;
  color: #1f2937;
  border-bottom-left-radius: 0.25rem;
}
.text-part {
  white-space: pre-wrap;
}
.thinking-part {
  font-size: 0.8rem;
  color: #9ca3af;
  white-space: pre-wrap;
  font-style: italic;
}
.error-banner {
  padding: 0.5rem 1rem;
  color: #991b1b;
  background: #fee2e2;
  font-size: 0.85rem;
}
.input-area {
  padding: 1rem;
  border-top: 1px solid #e5e7eb;
  display: flex;
  gap: 0.5rem;
  background: #fff;
}
.input-area .stop-button {
  background: linear-gradient(#d32f2f, #b71c1c);
  color: #fff;
  border: 1px solid #b71c1c;
}
</style>
