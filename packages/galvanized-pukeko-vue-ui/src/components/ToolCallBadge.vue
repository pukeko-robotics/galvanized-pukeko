<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolCallPart } from '../services/chatService'
import { getToolDisplay, toolDisplayLabel } from './toolDisplay'
import ToolResultGeneric from './ToolResultGeneric.vue'

const props = defineProps<{
  part: ToolCallPart
}>()

const expanded = ref(false)

function toggle() {
  expanded.value = !expanded.value
}

const hasArgs = computed(() => {
  const a = props.part.args
  if (a == null) return false
  if (typeof a === 'object') return Object.keys(a as object).length > 0
  return true
})

const prettyArgs = computed(() => {
  try {
    return JSON.stringify(props.part.args, null, 2)
  } catch {
    return props.part.argsRaw
  }
})

// Per-tool display entry (PLAT-17). Unregistered tools resolve to `undefined`
// and fall through to the default label / generic result renderer.
const display = computed(() => getToolDisplay(props.part.toolCallName))

const headerLabel = computed(() => toolDisplayLabel(props.part.toolCallName, display.value))

const paramSummary = computed(() => {
  try {
    return display.value?.summariseParams?.(props.part) ?? ''
  } catch {
    return ''
  }
})

// The component that renders the result: a registered custom renderer, else the
// generic JSON/text fallback. Custom renderers receive `{ part }`.
const resultRenderer = computed(() => display.value?.renderResult ?? ToolResultGeneric)
</script>

<template>
  <div class="tool-call-badge" :class="{ expanded }">
    <button class="tool-call-header" @click="toggle" :aria-expanded="expanded">
      <span class="tool-call-arrow" :class="{ expanded }">&#9658;</span>
      <span v-if="display?.glyph" class="tool-call-glyph" aria-hidden="true">{{ display.glyph }}</span>
      <span class="tool-call-label">{{ headerLabel }}</span>
      <span v-if="paramSummary" class="tool-call-summary">{{ paramSummary }}</span>
      <span v-if="props.part.status === 'pending'" class="tool-call-dot" aria-label="running"></span>
    </button>
    <div v-if="expanded" class="tool-call-body">
      <template v-if="hasArgs">
        <div class="tool-call-section-label">Arguments</div>
        <pre class="tool-call-pre">{{ prettyArgs }}</pre>
      </template>
      <template v-if="props.part.result != null">
        <div class="tool-call-section-label">Result</div>
        <component :is="resultRenderer" :part="props.part" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.tool-call-badge {
  display: inline-flex;
  flex-direction: column;
  vertical-align: middle;
  max-width: 100%;
  border-radius: 0.5rem;
  border: 1px solid #bfdbfe;
  background-color: #eff6ff;
  overflow: hidden;
  font-size: 0.85rem;
  margin: 0.15rem 0.25rem;
}

.tool-call-badge.expanded {
  display: block;
  width: 100%;
}

.tool-call-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.75rem;
  background: none;
  border: none;
  cursor: pointer;
  color: #1e40af;
  font-size: 0.85rem;
  font-weight: 500;
  text-align: left;
  width: 100%;
  font-family: inherit;
  border-radius: 0;
}

.tool-call-header:hover {
  background-color: #dbeafe;
}

.tool-call-arrow {
  display: inline-block;
  font-size: 0.7rem;
  transition: transform 0.15s ease;
  color: #3b82f6;
  flex-shrink: 0;
}

.tool-call-arrow.expanded {
  transform: rotate(90deg);
}

.tool-call-glyph {
  flex-shrink: 0;
  line-height: 1;
}

.tool-call-label {
  color: #1e40af;
}

.tool-call-summary {
  color: #3b82f6;
  font-weight: 400;
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.tool-call-dot {
  display: inline-block;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background-color: #3b82f6;
  margin-left: 0.15rem;
  animation: tool-call-pulse 0.9s ease-in-out infinite;
}

@keyframes tool-call-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.15); }
}

.tool-call-body {
  border-top: 1px solid #bfdbfe;
  padding: 0.5rem 0.75rem;
}

.tool-call-section-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: #1e40af;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.25rem;
}

.tool-call-section-label:not(:first-child) {
  margin-top: 0.6rem;
}

.tool-call-pre {
  margin: 0;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
  font-size: 0.75rem;
  line-height: 1.4;
  color: #334155;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  background-color: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 0.375rem;
  padding: 0.5rem;
}
</style>
