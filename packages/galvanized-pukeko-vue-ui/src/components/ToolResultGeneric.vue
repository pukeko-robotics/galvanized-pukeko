<script setup lang="ts">
/**
 * Generic JSON/text result renderer (PLAT-17) — the fallback used for any tool
 * without a registered custom `renderResult` component. Pretty-prints JSON when
 * the result parses, otherwise shows it verbatim. Honours progressive
 * disclosure (DL-2): collapsed to a first-N-lines / char-cap preview with an
 * overflow marker, expandable per call.
 */
import { computed, ref } from 'vue'
import type { ToolCallPart } from '../services/chatService'

const props = defineProps<{ part: ToolCallPart }>()

// Preview budget for the collapsed state. Whichever limit trips first wins.
const PREVIEW_LINES = 8
const PREVIEW_CHARS = 600

const expanded = ref(false)

const formatted = computed(() => {
  const r = props.part.result
  if (r == null) return ''
  try {
    return JSON.stringify(JSON.parse(r), null, 2)
  } catch {
    return r
  }
})

const lines = computed(() => formatted.value.split('\n'))

const overflows = computed(
  () => lines.value.length > PREVIEW_LINES || formatted.value.length > PREVIEW_CHARS,
)

const hiddenLineCount = computed(() =>
  overflows.value ? Math.max(lines.value.length - PREVIEW_LINES, 0) : 0,
)

const preview = computed(() => {
  let text = lines.value.slice(0, PREVIEW_LINES).join('\n')
  if (text.length > PREVIEW_CHARS) text = text.slice(0, PREVIEW_CHARS)
  return text
})

const shown = computed(() => (expanded.value || !overflows.value ? formatted.value : preview.value))
</script>

<template>
  <div class="tool-result-generic" data-testid="tool-result-generic">
    <pre class="tool-call-pre">{{ shown }}</pre>
    <div v-if="overflows" class="tool-result-overflow">
      <span v-if="!expanded" class="tool-result-marker" data-testid="tool-result-overflow-marker">
        … {{ hiddenLineCount > 0 ? `${hiddenLineCount} more line${hiddenLineCount === 1 ? '' : 's'}` : 'truncated' }}
      </span>
      <button
        type="button"
        class="tool-result-toggle"
        data-testid="tool-result-toggle"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? 'Show less' : 'Show more' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tool-result-generic {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.tool-call-pre {
  margin: 0;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--pk-color-code-text, #334155);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  background-color: var(--pk-color-code-surface, #f8fafc);
  border: 1px solid var(--pk-color-code-border, #cbd5e1);
  border-radius: 0.375rem;
  padding: 0.5rem;
}

.tool-result-overflow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tool-result-marker {
  font-size: 0.7rem;
  color: var(--pk-color-text-secondary, #64748b);
  font-style: italic;
}

.tool-result-toggle {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--pk-color-link, #2563eb);
  text-decoration: underline;
}

.tool-result-toggle:hover {
  color: var(--pk-color-info-text, #1e40af);
}
</style>
