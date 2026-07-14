<script setup lang="ts">
/**
 * Headless chat surface (P2b increment 3; A2UI render target made configurable
 * in PLAT-19). Must be mounted inside a CopilotKitProvider. Renders the bespoke
 * Pukeko chat primitives (PkInput, PkButton, bubble styling, ToolCallBadge, A2UI
 * surfaces) but sources every bit of state and the entire run lifecycle from
 * CopilotKit composables — no bespoke `chatService`.
 *
 * Client tools (if any) are registered by the host via `useFrontendTool` before
 * mounting this; CopilotKit + the gsloth C-a server flow handle the
 * interrupt/resume (see useHeadlessChat.ts). This component just sends user
 * turns and renders the resulting message log.
 *
 * ## A2UI rendering (PLAT-19)
 * Our agent emits generative UI as a server-side `show_a2ui_surface` tool call
 * whose result is A2UI JSONL. In the headless transcript that part shows as a
 * {@link ToolCallBadge}; the surface itself renders at a configurable target:
 *
 *   - `chat`  — a per-part {@link A2UIToolSurface} (its OWN processor, ephemeral)
 *               rendered inline right after that part's badge.
 *   - `panel` (default) — a SINGLE SHARED {@link useA2UI} processor rendered in a
 *               split pane beside the transcript (bespoke `CoreApp` parity). Every
 *               `show_a2ui_surface` result is fed into that one processor, so a
 *               later `surfaceUpdate`/`dataModelUpdate` to an existing surfaceId
 *               updates it in place (persistent/updatable) — which a per-part
 *               surface with a fresh processor could never do.
 *
 * Both targets deliver A2UI user actions back to the agent through the same
 * CopilotKit round-trip ({@link deliverAction}: `agent.addMessage` +
 * `copilotkit.runAgent`) — never through `useA2UI().sendAction`/chatService,
 * which the headless mode does not use. (This is why the stock-mode
 * `A2UIRenderToolBridge`, whose `useRenderTool` renderer only fires inside
 * CopilotKit's own chat transcript, is NOT mounted here.)
 */
import { computed, ref, watch, nextTick } from 'vue'
import { useAgent } from '@copilotkit/vue/v2'
import { useCopilotKit } from '@copilotkit/vue/v2'
import PkInput from '../components/PkInput.vue'
import PkButton from '../components/PkButton.vue'
import PkNewConversationButton from '../components/PkNewConversationButton.vue'
import PkLogoLarge from '../components/PkLogoLarge.vue'
import ToolCallBadge from '../components/ToolCallBadge.vue'
import A2UIToolSurface from '../components/a2ui/A2UIToolSurface.vue'
import A2UISurface from '../components/a2ui/A2UISurface.vue'
import { useA2UI, buildUserAction, parseA2UIJsonl, type UserAction } from '../composables/useA2UI'
import type { MessagePart } from '../services/chatService'
import { toBubbles, type AgentMessageLike } from './useHeadlessChat'
import type { A2UITarget } from './types'

const props = withDefaults(
  defineProps<{ agentId?: string; a2uiTarget?: A2UITarget }>(),
  { agentId: 'default', a2uiTarget: 'panel' },
)

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

/** A completed `show_a2ui_surface` tool-call part whose JSONL result is present. */
type A2UISurfacePart = Extract<MessagePart, { kind: 'tool-call' }> & { result: string }

/** A tool-call part is an A2UI surface once its JSONL result has arrived. */
function isA2uiSurfacePart(part: MessagePart): part is A2UISurfacePart {
  return (
    part.kind === 'tool-call' &&
    part.toolCallName === 'show_a2ui_surface' &&
    part.status === 'complete' &&
    !!part.result
  )
}

// ---- Action round-trip (shared by both targets) --------------------------
/**
 * Deliver an A2UI user action back to the agent as a follow-up user message,
 * then re-run — the exact CopilotKit round-trip `A2UIRenderToolBridge` uses for
 * stock mode. We send the serialized UserAction (the same JSON the bespoke
 * `chatService.submitToolResult` posts) so the server sees an identical payload
 * regardless of UI mode.
 */
async function deliverAction(action: UserAction): Promise<void> {
  const current = agent.value
  if (!current) {
    console.warn('[HeadlessChat] No agent to deliver A2UI action to')
    return
  }
  current.addMessage({ id: crypto.randomUUID(), role: 'user', content: JSON.stringify(action) })
  try {
    await copilotkit.value.runAgent({ agent: current })
  } catch (e) {
    console.error('[HeadlessChat] Failed to deliver A2UI action:', e)
  }
}

/** `chat`-target A2UIToolSurface `@action` handler (typed here, not in template). */
function onChatSurfaceAction(payload: { toolCallId: string | undefined; action: UserAction }): void {
  void deliverAction(payload.action)
}

// ---- Panel target: single shared, persistent/updatable A2UI feed ---------
const panelA2ui = useA2UI()
// Route panel surface actions through the CopilotKit round-trip instead of the
// bespoke chatService `sendAction`. A2UISurface reads `panelA2ui.sendAction`
// live at click time, so overriding it here applies to every rendered surface.
panelA2ui.sendAction = (surfaceId, action, sourceComponentId, node) => {
  void deliverAction(buildUserAction(panelA2ui.processor, surfaceId, action, sourceComponentId, node))
}

// Every completed A2UI part, in order. Feeds the shared panel processor and (in
// `chat` mode) drives the inline per-part surfaces.
const a2uiSurfaceParts = computed(() =>
  bubbles.value.flatMap((b) =>
    b.kind === 'assistant' ? b.parts.filter(isA2uiSurfacePart) : [],
  ),
)

// Feed each NEW surface result into the one shared processor exactly once
// (dedupe by toolCallId), so a later update batch to an existing surfaceId
// updates in place rather than reprocessing everything.
const fedToolCallIds = new Set<string>()
watch(
  a2uiSurfaceParts,
  (parts) => {
    if (props.a2uiTarget !== 'panel') return
    for (const part of parts) {
      if (fedToolCallIds.has(part.toolCallId)) continue
      fedToolCallIds.add(part.toolCallId)
      try {
        panelA2ui.processBatch(parseA2UIJsonl(part.result))
      } catch (e) {
        console.error('[HeadlessChat] Failed to parse A2UI JSONL for panel:', e, part.result)
      }
    }
  },
  { immediate: true, deep: true },
)

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

/**
 * Start a fresh conversation — the CopilotKit analogue of the bespoke
 * `ChatInterface.newConversation()` (`chatService.stop()` → `resetThread()` →
 * clear messages). Here there is no bespoke `chatService`: first abort any
 * in-flight run (as {@link stop} does), then clear the CopilotKit agent thread
 * via the idiomatic `AbstractAgent.setMessages([])` (HttpAgent inherits it) so
 * the shared message log — the single source of `bubbles` and the per-part
 * `chat`-target surfaces — is emptied through the real API rather than by
 * hand-mutating the reactive internals.
 *
 * The `panel`-target A2UI surface does NOT derive from `bubbles`: it lives in the
 * shared `panelA2ui` processor, fed once per toolCallId. Clearing messages drives
 * `a2uiSurfaceParts` to `[]`, but the feed watcher only ever ADDS surfaces (never
 * removes), so the stale surface would persist (PLAT-21). Reset it explicitly:
 * `panelA2ui.clearSurfaces()` empties the processor (the placeholder returns) and
 * `fedToolCallIds.clear()` drops the dedupe memory so a later identical
 * toolCallId re-feeds a fresh surface.
 */
function newConversation() {
  try {
    agent.value?.abortRun()
  } catch {
    // abortRun on an idle agent is a no-op.
  }
  sending.value = false
  errorText.value = null
  agent.value?.setMessages([])
  // PLAT-21: reset the shared panel surface + its feed-dedupe (not bubble-derived).
  panelA2ui.clearSurfaces()
  fedToolCallIds.clear()
}
</script>

<template>
  <div
    class="pk-headless-chat"
    :class="{ 'has-panel': a2uiTarget === 'panel' }"
    data-testid="pk-headless-chat"
  >
    <div class="chat-column">
      <!-- New-Conversation reset (bespoke ChatInterface parity, PLAT-20). -->
      <div class="chat-toolbar">
        <PkNewConversationButton data-testid="pk-headless-new-conversation" @click="newConversation" />
      </div>
      <div class="messages" ref="messagesEl">
        <!-- UI-only greeting empty-state: rendered only while the agent thread is
             empty; NEVER injected into agent.messages (would pollute CK state). -->
        <div
          v-if="bubbles.length === 0"
          class="message ai"
          data-testid="pk-headless-greeting"
        >
          <div class="message-content">Hello! How can I help you today?</div>
        </div>
        <template v-for="bubble in bubbles" :key="bubble.id">
          <div v-if="bubble.kind === 'user'" class="message user" data-testid="pk-headless-user">
            <div class="message-content">{{ bubble.text }}</div>
          </div>
          <div v-else class="message ai" data-testid="pk-headless-assistant">
            <div class="message-content">
              <template v-for="(part, i) in bubble.parts" :key="i">
                <span v-if="part.kind === 'text'" class="text-part">{{ part.text }}</span>
                <div v-else-if="part.kind === 'thinking'" class="thinking-part">{{ part.text }}</div>
                <template v-else>
                  <ToolCallBadge :part="part" />
                  <!-- chat target: ephemeral inline surface, its own processor. -->
                  <A2UIToolSurface
                    v-if="a2uiTarget === 'chat' && isA2uiSurfacePart(part)"
                    :surface-jsonl="part.result || ''"
                    :tool-call-id="part.toolCallId"
                    @action="onChatSurfaceAction"
                  />
                </template>
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
      <div class="helper-text">Click Send or press Enter to send your message</div>
    </div>

    <!-- panel target: single shared, persistent/updatable surfaces beside chat. -->
    <div v-if="a2uiTarget === 'panel'" class="a2ui-panel" data-testid="pk-headless-a2ui-panel">
      <A2UISurface
        v-for="[id, surface] in panelA2ui.surfaces.value"
        :key="id"
        :surface="surface"
        :surfaceId="id"
        :a2ui="panelA2ui"
      />
      <!-- Empty-workplane placeholder (bespoke CoreApp parity): the big Pukeko
           logo shown until the first A2UI surface arrives. -->
      <div
        v-if="panelA2ui.surfaces.value.size === 0"
        class="waiting-placeholder"
        data-testid="pk-headless-waiting-placeholder"
      >
        <PkLogoLarge />
      </div>
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
/* Panel target: chat + surfaces side by side (CoreApp split-screen parity). */
.pk-headless-chat.has-panel {
  flex-direction: row;
}
.chat-column {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100%;
}
.chat-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
}
.pk-headless-chat.has-panel .chat-column {
  flex: 0 0 40%;
  min-width: 300px;
}
.a2ui-panel {
  flex: 1;
  height: 100%;
  overflow-y: auto;
  padding: 1rem;
  background: #f9fafb;
  border-left: 1px solid #e5e7eb;
}
.waiting-placeholder {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 40%;
  margin: 0 auto;
  opacity: 0.2;
  padding: 2rem 0;
}
.waiting-placeholder :deep(svg) {
  height: 70vh;
  aspect-ratio: auto;
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
.helper-text {
  padding: 0 1rem 1rem 1rem;
  font-size: 0.8rem;
  color: #9ca3af;
  text-align: center;
  background: #fff;
}
</style>
