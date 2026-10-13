<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import {
  webcamStatusFromError,
  webcamErrorFrom,
  type WebcamStatus,
  type WebcamError,
} from '../services/webcamStatus'

const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const stream = ref<MediaStream | null>(null)
const error = ref<string | null>(null)
const isActive = ref(false)

/**
 * Why this panel does or does not have frames (RC-55) — see `WebcamStatus` for
 * what each value means and, for each, whether waiting will help.
 *
 * `cameraStatus` tracks the `getUserMedia` CALL; `isActive` tracks whether the
 * stream reached the video element and a frame can be drawn. They are separate
 * because they answer separate questions — "did the camera open?" and "can a
 * frame be drawn right now?" — and only the first is what a consumer deciding
 * whether to keep waiting needs.
 */
const cameraStatus = ref<WebcamStatus>('idle')
const cameraError = ref<WebcamError | null>(null)

/**
 * Which start attempt is the current one.
 *
 * A `getUserMedia` call cannot be cancelled, so one begun before `stopCamera()`
 * is still running afterwards and will settle regardless. Every start takes a
 * generation and `stopCamera` bumps it; a start whose generation is stale when
 * it settles is ABANDONED — it does not touch the status, does not reach the
 * video element, and releases the tracks of the stream it was handed. Without
 * that, a stopped panel drove itself from `idle` back to `live` with no
 * `startCamera()` in between, so the `idle` it published was not true.
 */
let startGeneration = 0

async function startCamera() {
  const generation = ++startGeneration
  /** Whether this attempt is still the one the panel is waiting on. */
  const superseded = () => generation !== startGeneration
  try {
    error.value = null
    cameraError.value = null
    cameraStatus.value = 'starting'
    const opened = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    })
    if (superseded()) {
      // The caller has since asked for no camera, so this stream must not reach
      // component state at all — release it here, where it is still in hand.
      opened.getTracks().forEach((track) => track.stop())
      return
    }
    stream.value = opened
    // The camera is open as of THIS line, and `cameraStatus` reports the call,
    // so it is reported here rather than inside the `videoRef` guard below,
    // which reports the separate question of whether a frame can be drawn yet.
    cameraStatus.value = 'live'
    if (videoRef.value) {
      videoRef.value.srcObject = stream.value
      isActive.value = true
    }
  } catch (err) {
    // A refusal the caller is no longer waiting on is not news: it stopped the
    // camera, and the `idle` it asked for is what should stand.
    if (superseded()) return
    error.value = err instanceof Error ? err.message : 'Failed to access camera'
    // Read structurally rather than through `instanceof Error`, because a
    // DOMException is not an Error subclass under jsdom. `error` above keeps its
    // own existing computation: it is the banner's text, and this is a separate,
    // additive signal. In a real browser the two agree.
    cameraError.value = webcamErrorFrom(err)
    cameraStatus.value = webcamStatusFromError(err)
    isActive.value = false
  }
}

function stopCamera() {
  // Abandon any start still in flight before touching anything else: the call
  // cannot be cancelled, so this bump is the only thing that stops it settling
  // later and driving a stopped panel back to `live`.
  startGeneration += 1
  if (stream.value) {
    stream.value.getTracks().forEach((track) => track.stop())
    stream.value = null
  }
  if (videoRef.value) {
    videoRef.value.srcObject = null
  }
  isActive.value = false
  // Stopping a camera that never opened does not erase why it never opened, so
  // a failure keeps naming its cause. The guard is written on `error` itself to
  // hold the invariant literally: the status reports a failure exactly while the
  // error banner is showing one.
  if (error.value === null) {
    cameraStatus.value = 'idle'
    cameraError.value = null
  }
}

/**
 * Decode one frame of the composite, naming WHICH frame if it cannot be decoded.
 *
 * `frame` is in the rejection message rather than only in a debugger: the two
 * calls below are awaited together, so without it a caller learns that a frame
 * failed but not which of the two it supplied — and the two come from different
 * places, so that is the first thing it needs in order to act.
 */
function loadImage(dataUrl: string, frame: 'Before' | 'After'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(new Error(`The ${frame} frame could not be decoded from its data URL.`))
    img.src = dataUrl
  })
}

/**
 * Compose the two supplied frames side by side and resolve the encoded result.
 *
 * EVERY failure path rejects with an `Error` naming its cause, and the return
 * type admits no failure value. That is deliberate, and it is about who reads
 * the result: an agent reading a tool result, not a human reading a log.
 * Downstream, the robot's `robotSession/interpreter.ts` wraps this `await` in
 * try/catch and turns a rejection into
 * `{error: 'Failed to compose Before/After image: <message>'}`, then abandons
 * the remaining steps. A silent `null` instead leaves the slot empty, lets the
 * sequence carry on, and delivers a blank frame the model can neither explain
 * nor act on. The model deserves to be told what happened, so a cause it can
 * read beats one it has to infer.
 *
 * The causes are told apart by their MESSAGES, because at the call site an
 * `Error` from one path is otherwise indistinguishable from an `Error` from any
 * other — which would trade a silence for a different silence.
 */
async function composeBeforeAfter(
  beforeDataUrl: string,
  afterDataUrl: string
): Promise<string> {
  if (!canvasRef.value) {
    throw new Error('The compositing canvas is not mounted.')
  }
  const [before, after] = await Promise.all([
    loadImage(beforeDataUrl, 'Before'),
    loadImage(afterDataUrl, 'After'),
  ])

  const targetH = Math.max(before.height, after.height)
  const scale = (img: HTMLImageElement) => targetH / img.height
  const wB = Math.round(before.width * scale(before))
  const wA = Math.round(after.width * scale(after))

  const LABEL_H = 28
  const GAP = 12
  const PAD = 8
  const totalW = PAD + wB + GAP + wA + PAD
  const totalH = LABEL_H + targetH + PAD

  // Re-read and re-check AFTER the await. This function is a
  // check-then-await-then-use: the guard at the top ran BEFORE the two frames
  // decoded, and a parent can unmount the panel while they are in flight — a
  // route change or a `v-if` flip is enough — which nulls the template ref. The
  // annotation is load-bearing: TypeScript's narrowing from the top guard
  // survives the `await` unsoundly, so without it this guard is dead code to the
  // compiler and reads as redundant to the next human. No gate can see this
  // path; only the cell that holds both decodes open across an unmount can.
  //
  // A DISTINCT message from the top guard, deliberately. Both are the same
  // predicate, but not the same thing to tell the agent reading the result:
  // there the call was made against a panel that was already gone, here both
  // frames decoded fine and the panel lost its surface mid-compose, so a retry
  // against a live panel is the sensible next step. The same test the other
  // messages were settled on: does the consumer have inputs it could act on
  // differently.
  const canvas: HTMLCanvasElement | null = canvasRef.value
  if (!canvas) {
    throw new Error('The compositing canvas was unmounted while the frames were decoding.')
  }
  canvas.width = totalW
  canvas.height = totalH

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('The compositing canvas has no 2D drawing context.')
  }

  // Neutral mid-grey background so the composite reads on light or dark chat bg.
  ctx.fillStyle = '#3a3a3a'
  ctx.fillRect(0, 0, totalW, totalH)

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 18px sans-serif'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  ctx.fillText('Before', PAD + wB / 2, 6)
  ctx.fillText('After', PAD + wB + GAP + wA / 2, 6)

  ctx.drawImage(before, PAD, LABEL_H, wB, targetH)
  ctx.drawImage(after, PAD + wB + GAP, LABEL_H, wA, targetH)

  ctx.fillStyle = '#ff9800'
  ctx.fillRect(PAD + wB + GAP / 2 - 1, LABEL_H, 2, targetH)

  return canvas.toDataURL('image/jpeg', 0.8)
}

function captureFrame(): string | null {
  if (!videoRef.value || !canvasRef.value || !isActive.value) {
    return null
  }

  const video = videoRef.value
  const canvas = canvasRef.value

  const MAX_SIZE = 640
  let width = video.videoWidth
  let height = video.videoHeight

  if (width > height) {
    if (width > MAX_SIZE) {
      height = Math.round(height * (MAX_SIZE / width))
      width = MAX_SIZE
    }
  } else {
    if (height > MAX_SIZE) {
      width = Math.round(width * (MAX_SIZE / height))
      height = MAX_SIZE
    }
  }

  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(video, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.8)
}

/**
 * RC-35: blink the view once, as a shutter acknowledgement. This is what a
 * host wiring this panel as the camera tool's permanent preview gets at the
 * moment of capture (`webcamPanelPermanentPreview`). Purely visual.
 */
const blinking = ref(false)
let blinkTimer: ReturnType<typeof setTimeout> | null = null
const BLINK_MS = 200
function blink() {
  blinking.value = true
  if (blinkTimer) clearTimeout(blinkTimer)
  blinkTimer = setTimeout(() => {
    blinking.value = false
    blinkTimer = null
  }, BLINK_MS)
}

onMounted(() => {
  startCamera()
})

onUnmounted(() => {
  stopCamera()
  if (blinkTimer) clearTimeout(blinkTimer)
})

// RC-55 additions (`cameraStatus`, `cameraError`) are strictly APPENDED: this is
// a published component's public API, and every member above it is what existing
// consumers — including a robot still on an older pin — already bind to.
defineExpose({
  captureFrame,
  composeBeforeAfter,
  startCamera,
  stopCamera,
  isActive,
  cameraStatus,
  cameraError,
  // RC-35, appended for the same reason as the RC-55 members above.
  blink,
})
</script>

<template>
  <div class="pk-webcam-panel">
    <!--
      The compositing canvas is an offscreen drawing surface, not part of the camera
      view: it is never shown, it never reads the stream, and `composeBeforeAfter`
      only ever draws two supplied data URLs onto it. It therefore sits OUTSIDE the
      error/view branches so it exists whenever the component is mounted (RC-45).
      Inside the `v-else` it was destroyed along with the video whenever getUserMedia
      rejected, which broke compositing for the simulated, no-hardware path (RC-5).
    -->
    <canvas ref="canvasRef" style="display: none" />
    <div v-if="error" class="webcam-error">
      <p>{{ error }}</p>
      <button @click="startCamera">Retry</button>
    </div>
    <div v-else class="webcam-view" :class="{ blinking }" data-testid="pk-webcam-view">
      <video ref="videoRef" autoplay playsinline muted />
      <div v-if="!isActive" class="webcam-loading">Connecting to camera...</div>
    </div>
  </div>
</template>

<style scoped>
.pk-webcam-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--grey-13);
  overflow: hidden;
}

.webcam-view {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* RC-35: the shutter blink. */
.webcam-view::after {
  content: '';
  position: absolute;
  inset: 0;
  background: #fff;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease-out;
}

.webcam-view.blinking::after {
  opacity: 0.85;
  transition: none;
}

.webcam-view video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.webcam-loading {
  position: absolute;
  color: var(--grey-70);
  font-size: 0.9rem;
}

.webcam-error {
  text-align: center;
  padding: var(--padding-full);
  color: var(--main-text-color);
}

.webcam-error button {
  margin-top: var(--padding-twothird);
  padding: var(--padding-third) var(--padding-twothird);
  background: var(--bg-button-sec-idle);
  color: var(--text-button-sec-idle);
  border: 1px solid var(--grey-70);
  border-radius: var(--border-radius-small-box);
  cursor: pointer;
}
</style>
