<script setup lang="ts">
/**
 * The camera tool's in-Chat element (RC-35): the tool-call indicator, the
 * transient live view with its countdown, and then the captured photo.
 *
 * One component serves every surface. Headless reaches it through the PLAT-17
 * registry's `renderPart` (in place of the collapsible ToolCallBadge); stock
 * reaches it through the CopilotKit frontend tool's `render`; the headless A2UI
 * pane mounts it directly with `placement="panel"`.
 *
 * It reads live state from the {@link CameraController} session keyed by the
 * tool-call id while the capture runs, and falls back to the tool result alone
 * (history replay, or a host that registered no controller).
 *
 * It sits in the message flow — never fixed or absolutely positioned against
 * the page — so it scrolls with the thread and cannot occlude the chat input
 * (D1).
 */
import { computed, ref, watchEffect } from 'vue'
import ToolResultGeneric from './ToolResultGeneric.vue'
import { parseImageEnvelope } from './toolDisplays/imageEnvelope'
import {
  CAMERA_UNAVAILABLE_MESSAGE,
  CAPTURE_CANCELLED_ERROR,
  DEFAULT_CAMERA_TOOL_CONFIG,
  LOADING_PHOTO_MESSAGE,
  isSessionActive,
  type CameraController,
  type InlinePreviewSize,
} from '../services/cameraController'
import type { ToolCallPart } from '../services/chatService'

const props = withDefaults(
  defineProps<{
    toolCallId: string
    /** The tool result envelope once it has landed. */
    result?: string | null
    camera?: CameraController | null
    /** `panel` = the A2UI-pane copy: no indicator row, no announcements. */
    placement?: 'chat' | 'panel'
    /**
     * The tool call's own status, as the surface reports it: `'pending' |
     * 'complete'` from the headless part, `'inProgress' | 'executing' |
     * 'complete'` from CopilotKit's stock render. Only `'complete'` is read: a
     * call that finished (or was abandoned) with no result and no running
     * session is over, not "Taking photo…". Omitted = not known, which keeps
     * the in-progress reading until a result or a session says otherwise.
     */
    status?: string | null
  }>(),
  { result: null, camera: null, placement: 'chat', status: null },
)

const config = computed(() => props.camera?.config ?? DEFAULT_CAMERA_TOOL_CONFIG)
const session = computed(() => props.camera?.session(props.toolCallId) ?? null)
const active = computed(() => isSessionActive(session.value))

/** The A2UI pane always shows the photo whole; it is a pane, not the thread. */
const size = computed<InlinePreviewSize>(() =>
  props.placement === 'panel' ? 'full' : config.value.inlinePreviewSize,
)
/** The live view is never folded away: `collapsed` shrinks it to `small`. */
const streamSize = computed(() => (size.value === 'collapsed' ? 'small' : size.value))

const parsed = computed(() => parseImageEnvelope(props.result ?? undefined))

/** The photo: the landed result, or the session's frame while it lands. */
const photoSrc = computed(() =>
  parsed.value.kind === 'image' ? parsed.value.src : (session.value?.photoSrc ?? null),
)

const errorMessage = computed(() =>
  parsed.value.kind === 'error' ? parsed.value.message : (session.value?.detail ?? null),
)

const outcome = computed<
  'photo' | 'unavailable' | 'cancelled' | 'failed' | 'ended' | 'pending' | 'other'
>(() => {
  if (photoSrc.value) return 'photo'
  const phase = session.value?.phase
  if (phase === 'cancelled' || errorMessage.value === CAPTURE_CANCELLED_ERROR) return 'cancelled'
  if (phase === 'unavailable') return 'unavailable'
  if (phase === 'failed') return 'failed'
  // No session (history, or no controller wired): every capture_image error is
  // a camera that could not deliver, so the plain message stands in for it.
  if (parsed.value.kind === 'error') return 'unavailable'
  if (props.result != null && parsed.value.kind === 'unrecognised') return 'other'
  // The call is over but left nothing to show: no result, and no session still
  // running it (a stopped run, a call that errored before any tool message, a
  // session held by another controller). Without this it would read
  // "Taking photo…" with a running dot for ever.
  if (props.status === 'complete' && !active.value) return 'ended'
  return 'pending'
})

/** Shown while the frame is still landing after the shutter (D4). */
const loading = computed(() => session.value?.phase === 'loading')

const headerLabel = computed(() => {
  if (outcome.value === 'photo') return 'Photo'
  if (outcome.value === 'unavailable') return 'Camera unavailable'
  if (outcome.value === 'cancelled') return 'Photo cancelled'
  if (outcome.value === 'failed' || outcome.value === 'ended') return 'Photo not taken'
  if (outcome.value === 'other') return 'Camera result'
  return config.value.toolCallLabel
})

const inProgress = computed(() => active.value || outcome.value === 'pending')

const countdownNumbers = computed(() => {
  const from = session.value?.countdownFrom ?? 0
  return Array.from({ length: from }, (_, i) => from - i)
})
const showCountdown = computed(
  () =>
    !!session.value &&
    session.value.countdownFrom > 0 &&
    session.value.countdown !== null &&
    (session.value.phase === 'countdown' || session.value.phase === 'loading'),
)

const showMute = computed(() => props.placement === 'chat' && config.value.sounds && active.value)
const muted = computed(() => props.camera?.muted.value ?? false)
function toggleMute() {
  props.camera?.setMuted(!muted.value)
}

// The live view attaches the session's stream to its own element; capture
// itself reads from the controller's element, so this is display only.
const videoEl = ref<HTMLVideoElement | null>(null)
watchEffect(() => {
  const el = videoEl.value
  const stream = session.value?.stream ?? null
  if (el && 'srcObject' in el && el.srcObject !== stream) el.srcObject = stream
})

/** For the unrecognised-result fallback, which renders a ToolCallPart. */
const fallbackPart = computed(
  () =>
    ({
      kind: 'tool-call',
      toolCallId: props.toolCallId,
      toolCallName: 'capture_image',
      args: {},
      result: props.result ?? undefined,
      status: 'complete',
    }) as ToolCallPart,
)
</script>

<template>
  <div
    class="pk-camera-capture"
    :class="[`size-${size}`, `placement-${placement}`]"
    data-testid="pk-camera-capture"
  >
    <div v-if="placement === 'chat'" class="pk-camera-header">
      <span class="pk-camera-glyph" aria-hidden="true">📷</span>
      <span class="pk-camera-label" data-testid="pk-camera-label">{{ headerLabel }}</span>
      <span v-if="inProgress" class="pk-camera-dot" aria-label="running"></span>
      <button
        v-if="showMute"
        type="button"
        class="pk-camera-mute"
        data-testid="pk-camera-mute"
        :aria-pressed="muted"
        :aria-label="muted ? 'Unmute camera sounds' : 'Mute camera sounds'"
        :title="muted ? 'Unmute camera sounds' : 'Mute camera sounds'"
        @click="toggleMute"
      >{{ muted ? '🔇' : '🔊' }}</button>
    </div>

    <!-- D4 consequence 2: audio is never the only channel. Screen readers hear
         each number and the shutter through this polite live region. -->
    <div
      v-if="placement === 'chat'"
      class="pk-visually-hidden"
      role="status"
      aria-live="polite"
      data-testid="pk-camera-announcement"
    >{{ session?.announcement ?? '' }}</div>

    <div
      v-if="session?.streaming && !session.permanent"
      class="pk-camera-stream"
      :class="[`size-${streamSize}`, { flash: session.flash }]"
      data-testid="pk-camera-stream"
    >
      <video ref="videoEl" autoplay playsinline muted />
    </div>

    <!-- D4: `3 — 2 — 1 — 📷`, the current one highlighted in step with its
         beep. Informational tokens, never the danger/red family (DL-8). -->
    <ol v-if="showCountdown" class="pk-camera-countdown" data-testid="pk-camera-countdown">
      <li
        v-for="n in countdownNumbers"
        :key="n"
        :class="{ current: session?.countdown === n }"
        :aria-current="session?.countdown === n ? 'step' : undefined"
      >{{ n }}</li>
      <li
        :class="{ current: session?.countdown === 0 }"
        :aria-current="session?.countdown === 0 ? 'step' : undefined"
        aria-label="shutter"
      >📷</li>
    </ol>

    <div v-if="loading" class="pk-camera-loading" data-testid="pk-camera-loading">
      <span class="pk-camera-spinner" aria-hidden="true"></span>{{ LOADING_PHOTO_MESSAGE }}
    </div>

    <!--
      D5: the captured frame is shown UNCOLLAPSED by default. This is a
      deliberate exception to DL-2's collapsed tool detail: the photo is the
      artifact the user asked for, not tool internals. Do not "restore
      consistency" by moving it back behind the collapsed ToolCallBadge — that
      would quietly undo D5. Only a host that sets `inlinePreviewSize:
      'collapsed'` gets the disclosure below.
    -->
    <template v-if="outcome === 'photo' && photoSrc">
      <details v-if="size === 'collapsed'" class="pk-camera-photo-collapsed">
        <summary>Show photo</summary>
        <img class="pk-camera-photo size-small" :src="photoSrc" alt="Captured camera frame" />
      </details>
      <img
        v-else
        class="pk-camera-photo"
        :class="`size-${size}`"
        :src="photoSrc"
        alt="Captured camera frame"
        data-testid="pk-camera-photo"
      />
    </template>

    <template v-else-if="outcome === 'unavailable'">
      <!-- Plain explanatory copy, not an error artefact (no danger styling). -->
      <p class="pk-camera-message" data-testid="pk-camera-unavailable">{{ CAMERA_UNAVAILABLE_MESSAGE }}</p>
      <details v-if="errorMessage && placement === 'chat'" class="pk-camera-detail">
        <summary>Technical detail</summary>
        {{ errorMessage }}
      </details>
    </template>

    <p v-else-if="outcome === 'cancelled'" class="pk-camera-message" data-testid="pk-camera-cancelled">
      The photo was cancelled.
    </p>

    <template v-else-if="outcome === 'failed'">
      <p class="pk-camera-message" data-testid="pk-camera-failed">
        The camera opened, but the photo did not come through.
      </p>
      <details v-if="errorMessage && placement === 'chat'" class="pk-camera-detail">
        <summary>Technical detail</summary>
        {{ errorMessage }}
      </details>
    </template>

    <p v-else-if="outcome === 'ended'" class="pk-camera-message" data-testid="pk-camera-ended">
      The photo was not taken.
    </p>

    <ToolResultGeneric v-else-if="outcome === 'other'" :part="fallbackPart" />
  </div>
</template>

<style scoped>
.pk-camera-capture {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-width: 100%;
  margin: 0.15rem 0;
  font-size: 0.85rem;
}

.pk-camera-header {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 0.4rem;
  padding: 0.3rem 0.65rem;
  border-radius: 0.5rem;
  border: 1px solid var(--pk-color-info-border, #bfdbfe);
  background-color: var(--pk-color-info-surface, #eff6ff);
  color: var(--pk-color-info-text, #1e40af);
  font-weight: 500;
}

.pk-camera-glyph {
  line-height: 1;
}

.pk-camera-dot {
  display: inline-block;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background-color: var(--pk-color-primary, #3b82f6);
  animation: pk-camera-pulse 0.9s ease-in-out infinite;
}

@keyframes pk-camera-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.15); }
}

.pk-camera-mute {
  margin-left: 0.25rem;
  padding: 0 0.3rem;
  border: 1px solid var(--pk-color-info-border, #bfdbfe);
  border-radius: 0.375rem;
  background: transparent;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1.4;
}

.pk-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* In-flow, size-capped: the live view scrolls with the thread (D1). */
.pk-camera-stream {
  position: relative;
  overflow: hidden;
  border-radius: 0.375rem;
  border: 1px solid var(--pk-color-info-border, #bfdbfe);
  background: var(--pk-color-surface-sunken, #f9fafb);
  align-self: flex-start;
  max-width: 100%;
}

.pk-camera-stream video {
  display: block;
  max-width: 100%;
  width: 100%;
  height: auto;
}

.pk-camera-stream.size-full {
  width: 24rem;
}

.pk-camera-stream.size-small {
  width: 12rem;
}

/* The shutter blink. */
.pk-camera-stream::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--pk-color-surface, #fff);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease-out;
}

.pk-camera-stream.flash::after {
  opacity: 0.85;
  transition: none;
}

.pk-camera-countdown {
  display: flex;
  gap: 0.35rem;
  list-style: none;
  margin: 0;
  padding: 0;
  align-self: flex-start;
}

.pk-camera-countdown li {
  min-width: 2rem;
  padding: 0.2rem 0.5rem;
  text-align: center;
  border-radius: 0.375rem;
  border: 1px solid var(--pk-color-info-border, #bfdbfe);
  background: var(--pk-color-info-surface, #eff6ff);
  color: var(--pk-color-info-text, #1e40af);
  opacity: 0.55;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.pk-camera-countdown li.current {
  opacity: 1;
  border-color: var(--pk-color-info-text, #1e40af);
  transform: scale(1.12);
}

.pk-camera-loading {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--pk-color-text-secondary, #64748b);
}

.pk-camera-spinner {
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  border: 2px solid var(--pk-color-info-border, #bfdbfe);
  border-top-color: var(--pk-color-info-text, #1e40af);
  animation: pk-camera-spin 0.8s linear infinite;
}

@keyframes pk-camera-spin {
  to { transform: rotate(360deg); }
}

.pk-camera-photo {
  display: block;
  max-width: 100%;
  width: auto;
  height: auto;
  border: 1px solid var(--pk-color-code-border, #cbd5e1);
  border-radius: 0.375rem;
  align-self: flex-start;
}

.pk-camera-photo.size-full {
  max-height: 24rem;
}

.pk-camera-photo.size-small {
  max-width: min(12rem, 100%);
  max-height: 9rem;
}

.pk-camera-photo-collapsed summary {
  cursor: pointer;
  color: var(--pk-color-info-text, #1e40af);
}

.pk-camera-message {
  margin: 0;
  color: var(--pk-color-text, #1f2937);
  line-height: 1.4;
}

.pk-camera-detail {
  color: var(--pk-color-text-secondary, #64748b);
  font-size: 0.75rem;
}

.pk-camera-detail summary {
  cursor: pointer;
}
</style>
