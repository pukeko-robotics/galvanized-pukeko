<script setup lang="ts">
/**
 * Bridges our backend's `show_a2ui_surface` tool call into a CopilotKit mode
 * (stock or headless). P2b increment 2.
 *
 * Our agent emits A2UI as a server-side tool named `show_a2ui_surface` whose
 * result is a stream of A2UI JSONL operations (the @a2ui/web_core
 * ServerToClientMessage shape) — NOT CopilotKit's own `render_a2ui` tool nor an
 * AG-UI ActivityMessage, so CopilotKit's built-in A2UI renderer never fires for
 * it. Instead we register a custom tool-call renderer with `useRenderTool` and
 * render the surface through our own {@link A2UIToolSurface} (same catalog the
 * bespoke UI uses). The wire stays AG-UI; only the render path is CopilotKit's.
 *
 * When the user acts on the surface (button/textfield submit), we add a user
 * message to the agent and re-run it through CopilotKit core — same AG-UI POST
 * the stock chat composer issues, so the action lands in the existing thread.
 *
 * This component renders nothing itself; mount it once inside the provider.
 */
import { h } from 'vue'
import { useRenderTool, useAgent } from '@copilotkit/vue/v2'
import { useCopilotKit } from '@copilotkit/vue/v2'
import A2UIToolSurface from '../components/a2ui/A2UIToolSurface.vue'
import type { UserAction } from '../composables/useA2UI'

const props = withDefaults(
  defineProps<{
    /** Agent id whose A2UI surfaces we render + drive. Defaults to "default". */
    agentId?: string
  }>(),
  { agentId: 'default' },
)

const { copilotkit } = useCopilotKit()
const { agent } = useAgent({ agentId: props.agentId })

/**
 * Deliver an A2UI user action back to the agent as a follow-up user message,
 * then re-run. We send the serialized UserAction (the same JSON the bespoke
 * `chatService.submitToolResult` posts) so the server sees an identical payload
 * regardless of UI mode.
 */
async function deliverAction(action: UserAction): Promise<void> {
  const current = agent.value
  if (!current) {
    console.warn('[A2UIRenderToolBridge] No agent to deliver A2UI action to')
    return
  }
  current.addMessage({
    id: crypto.randomUUID(),
    role: 'user',
    content: JSON.stringify(action),
  })
  try {
    await copilotkit.value.runAgent({ agent: current })
  } catch (e) {
    console.error('[A2UIRenderToolBridge] Failed to deliver A2UI action:', e)
  }
}

// `name: '*'` would shadow every tool; scope strictly to show_a2ui_surface.
useRenderTool({
  name: 'show_a2ui_surface',
  // No client-side schema — the args are the server's; we only render the result.
  parameters: undefined as never,
  render: (toolProps: { toolCallId: string; status: string; result?: string }) => {
    // Only render once the result (the A2UI JSONL) has arrived.
    if (toolProps.status !== 'complete' || !toolProps.result) return null
    return h(A2UIToolSurface, {
      surfaceJsonl: toolProps.result,
      toolCallId: toolProps.toolCallId,
      onAction: (payload: { toolCallId: string | undefined; action: UserAction }) =>
        deliverAction(payload.action),
    })
  },
})
</script>

<template>
  <!-- Renderer-only: surfaces are mounted by CopilotKit inside the transcript. -->
  <span class="a2ui-render-tool-bridge" hidden />
</template>
