<script setup lang="ts">
// RC-19: the `capture_image` tool-result renderer — the captured frame shown
// inline in the conversation, where the raw `{mimeType, data: <base64>}` blob
// used to be. Registered on the PLAT-17 per-tool display registry, which hands a
// renderer only `{ part }`.
//
// Rendered at close to natural size rather than as a click-to-enlarge thumbnail:
// the capture source caps the longest edge at 640px, so the frame already fits
// the chat column and a lightbox would add a modal for no extra detail. If a
// future source produces larger frames, zoom becomes worth adding back — it is a
// change to this component alone, not to the registration.
//
// Graceful degradation (never a broken <img>):
//   - `{ error }` envelope → a clear textual note;
//   - anything unrecognised (plain text, wrong shape, empty data) → the generic
//     JSON/text fallback, exactly as an unregistered tool renders.
//
// The base64 data goes straight into the <img> src and is never logged.
import { computed } from 'vue'
import ToolResultGeneric from '../ToolResultGeneric.vue'
import type { ToolCallPart } from '../../services/chatService'
import { parseImageEnvelope } from './imageEnvelope'

const props = defineProps<{ part: ToolCallPart }>()

const parsed = computed(() => parseImageEnvelope(props.part.result))
// Discrete narrowed views so the template needs no union narrowing.
const image = computed(() => (parsed.value.kind === 'image' ? parsed.value : null))
const error = computed(() => (parsed.value.kind === 'error' ? parsed.value : null))
</script>

<template>
  <figure v-if="image" class="pk-capture-result">
    <img class="pk-capture-image" :src="image.src" alt="Captured camera frame" />
    <figcaption v-if="image.motion" class="pk-capture-caption">{{ image.motion }}</figcaption>
  </figure>
  <div v-else-if="error" class="pk-capture-error" data-testid="pk-capture-error">
    ⚠ {{ error.message }}
  </div>
  <ToolResultGeneric v-else :part="part" />
</template>

<style scoped>
.pk-capture-result {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0;
}

.pk-capture-image {
  display: block;
  max-width: 100%;
  max-height: 24rem;
  width: auto;
  border: 1px solid var(--pk-color-code-border, #cbd5e1);
  border-radius: 0.375rem;
}

.pk-capture-caption {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
  font-size: 0.72rem;
  color: var(--pk-color-text-secondary, #64748b);
}

.pk-capture-error {
  font-size: 0.78rem;
  color: var(--pk-color-danger-text, #991b1b);
  background: var(--pk-color-code-surface, #f8fafc);
  border: 1px solid var(--pk-color-code-border, #cbd5e1);
  border-radius: 0.375rem;
  padding: 0.4rem 0.5rem;
  word-break: break-word;
}
</style>
