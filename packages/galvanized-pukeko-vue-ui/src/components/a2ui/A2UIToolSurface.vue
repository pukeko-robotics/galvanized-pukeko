<script setup lang="ts">
/**
 * Renders a single A2UI surface from the JSONL payload our backend returns as
 * the result of a `show_a2ui_surface` tool call.
 *
 * This is the rendering half of the CopilotKit stock/headless A2UI bridge
 * (P2b increment 2). The bespoke UI feeds `show_a2ui_surface` results into the
 * shared {@link useA2UI} processor via `ChatInterface`; the CopilotKit modes
 * have no `ChatInterface`, so this component owns its own processor instance and
 * parses the JSONL itself, then renders through the same {@link A2UISurface}
 * catalog the bespoke UI uses. Keeping the renderer identical is the whole point
 * of the bridge — A2UI surfaces look and behave the same in every UI mode.
 *
 * Interactivity: A2UI button/textfield actions call back through `useA2UI`'s
 * `sendAction`, which posts a follow-up user message via `chatService`. In the
 * CopilotKit modes the visible transcript is owned by CopilotKit, so the bridge
 * reports the action upward via `@action` instead of assuming the bespoke
 * chatService thread; the host decides how to deliver it.
 */
import { ref, watch } from 'vue'
import { useA2UI, buildUserAction, type UserAction } from '../../composables/useA2UI'
import A2UISurface from './A2UISurface.vue'

const props = defineProps<{
  /** The `show_a2ui_surface` tool-call result: concatenated A2UI JSONL objects. */
  surfaceJsonl: string
  /** The originating tool call id, echoed back with any user action. */
  toolCallId?: string
}>()

const emit = defineEmits<{
  (e: 'action', payload: { toolCallId: string | undefined; action: UserAction }): void
}>()

const a2ui = useA2UI()
const parseError = ref<string | null>(null)

/**
 * The backend concatenates A2UI server-to-client messages as back-to-back JSON
 * objects (not newline-delimited), so split on brace depth — the exact parser
 * `ChatInterface.onToolCallResult` uses for the bespoke path. Kept in lockstep
 * so both paths accept identical payloads.
 */
function parseJsonl(content: string): unknown[] {
  const out: unknown[] = []
  let depth = 0
  let start = -1
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (c === '{') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        out.push(JSON.parse(content.slice(start, i + 1)))
        start = -1
      }
    }
  }
  return out
}

function render(content: string): void {
  parseError.value = null
  a2ui.clearSurfaces()
  if (!content) return
  try {
    a2ui.processBatch(parseJsonl(content) as never[])
  } catch (e) {
    parseError.value = String(e)
    console.error('[A2UIToolSurface] Failed to parse A2UI JSONL:', e, content)
  }
}

// Mark the pending tool call so sendAction routes the user action back to us.
watch(
  () => props.toolCallId,
  (id) => {
    a2ui.pendingToolCallId.value = id ?? null
  },
  { immediate: true },
)

watch(() => props.surfaceJsonl, render, { immediate: true })

// useA2UI.sendAction posts the user action via chatService for the bespoke UI.
// The CopilotKit modes don't share that thread, so re-route sendAction to clear
// the surface and emit the action upward; the host delivers it to the agent.
// A2UISurface reads `a2ui.sendAction` live at click time, so overriding the
// property here takes effect for surfaces already provided below.
a2ui.sendAction = (surfaceId, action, sourceComponentId, node) => {
  const userAction: UserAction = buildUserAction(
    a2ui.processor,
    surfaceId,
    action,
    sourceComponentId,
    node,
  )
  a2ui.clearSurfaces()
  a2ui.pendingToolCallId.value = null
  emit('action', { toolCallId: props.toolCallId, action: userAction })
}
</script>

<template>
  <div class="a2ui-tool-surface">
    <div v-if="parseError" class="a2ui-tool-error">A2UI render error: {{ parseError }}</div>
    <A2UISurface
      v-for="[id, surface] in a2ui.surfaces.value"
      :key="id"
      :surface="surface"
      :surfaceId="id"
      :a2ui="a2ui"
    />
  </div>
</template>

<style scoped>
.a2ui-tool-surface {
  margin: 0.5rem 0;
}
.a2ui-tool-error {
  padding: 0.25rem 0.5rem;
  background: #fee2e2;
  border: 1px solid #ef4444;
  border-radius: 4px;
  font-size: 0.8rem;
  color: #991b1b;
}
</style>
