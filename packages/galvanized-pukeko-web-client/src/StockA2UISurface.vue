<script setup lang="ts">
/**
 * Stock-UI A2UI bridge (P2b, increment 2).
 *
 * Renders agent-driven A2UI surfaces INSIDE CopilotKit's stock chat thread.
 *
 * The seam is CopilotKit's `useRenderTool`: we register a renderer for the
 * `show_a2ui_surface` tool the gaunt-sloth / ADK backends emit. When that tool
 * call completes, its `result` is the same A2UI JSONL the bespoke UI consumes,
 * so we parse it with `parseA2UIJsonl` and feed it through the SAME `useA2UI`
 * processor + `A2UISurface` component catalog the bespoke mode uses — i.e. we
 * BRIDGE to `A2UIRenderer.vue` rather than duplicating an A2UI renderer.
 *
 * Each tool call gets its own `useA2UI` instance so concurrent / repeated
 * surfaces don't clobber one another, keyed by `toolCallId`.
 *
 * Scope note: this increment covers DISPLAY of agent surfaces. Interactive
 * A2UI actions (e.g. a Button submitting back) route through `useA2UI`'s
 * `sendAction`, which resumes via the bespoke `chatService` tool-result wire;
 * in stock mode no `pendingToolCallId` is set on that path, so submit-back is a
 * no-op for now. Reconciling client-tool interrupt/resume with CopilotKit's own
 * `useFrontendTool` / `use-interrupt` is increment 3 (headless). See
 * briefs/copilotkit-vue/PLAN.md.
 */
import { h, markRaw, reactive } from 'vue'
import { useRenderTool } from '@copilotkit/vue/v2'
import { z } from 'zod'
import { useA2UI, A2UISurface, parseA2UIJsonl } from '@galvanized-pukeko/vue-ui'

// One A2UI processor instance per tool call id, so multiple/repeated surfaces
// in a single thread stay isolated. `reactive` so newly added entries render.
const instances = reactive(
  new Map<string, ReturnType<typeof useA2UI>>(),
)

function ingest(toolCallId: string, result: string): ReturnType<typeof useA2UI> {
  let inst = instances.get(toolCallId)
  if (!inst) {
    inst = markRaw(useA2UI())
    instances.set(toolCallId, inst)
  }
  // Re-process from a clean slate each time the (idempotent) result is rendered.
  inst.clearSurfaces()
  inst.processBatch(parseA2UIJsonl(result))
  return inst
}

// `show_a2ui_surface` takes no meaningful client-side parameters (the payload
// arrives as the tool RESULT, not the call args), so an empty object schema is
// enough to satisfy the typed `useRenderTool` overload.
useRenderTool({
  name: 'show_a2ui_surface',
  parameters: z.object({}).passthrough(),
  render: (props) => {
    if (props.status !== 'complete' || !props.result) {
      return h(
        'div',
        { class: 'stock-a2ui-loading' },
        'Rendering surface…',
      )
    }

    let inst: ReturnType<typeof useA2UI>
    try {
      inst = ingest(props.toolCallId, props.result)
    } catch (e) {
      console.error('[StockA2UISurface] Failed to parse A2UI JSONL:', e)
      return h('div', { class: 'stock-a2ui-error' }, 'Failed to render surface.')
    }

    const surfaces = inst.surfaces.value
    if (surfaces.size === 0) return null

    return h(
      'div',
      { class: 'stock-a2ui-surfaces' },
      Array.from(surfaces.entries()).map(([id, surface]) =>
        h(A2UISurface, {
          key: id,
          surface,
          surfaceId: id,
          a2ui: inst,
        }),
      ),
    )
  },
})
</script>

<template>
  <!--
    Headless registration component: it has no visible output of its own.
    CopilotKit places the registered renderer's output inline in the chat
    thread; this empty span just satisfies the single-root-element rule.
  -->
  <span style="display: none" aria-hidden="true" />
</template>

<style>
.stock-a2ui-surfaces {
  margin: 0.5rem 0;
}
.stock-a2ui-loading {
  padding: 0.5rem;
  color: #6b7280;
  font-size: 0.9rem;
}
.stock-a2ui-error {
  padding: 0.5rem;
  color: #b91c1c;
  font-size: 0.9rem;
}
</style>
