<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const stream = ref<MediaStream | null>(null)
const error = ref<string | null>(null)
const isActive = ref(false)

async function startCamera() {
  try {
    error.value = null
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    })
    if (videoRef.value) {
      videoRef.value.srcObject = stream.value
      isActive.value = true
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to access camera'
    isActive.value = false
  }
}

function stopCamera() {
  if (stream.value) {
    stream.value.getTracks().forEach((track) => track.stop())
    stream.value = null
  }
  if (videoRef.value) {
    videoRef.value.srcObject = null
  }
  isActive.value = false
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image data URL'))
    img.src = dataUrl
  })
}

async function composeBeforeAfter(
  beforeDataUrl: string,
  afterDataUrl: string
): Promise<string | null> {
  if (!canvasRef.value) return null
  const [before, after] = await Promise.all([
    loadImage(beforeDataUrl),
    loadImage(afterDataUrl),
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

  const canvas = canvasRef.value
  canvas.width = totalW
  canvas.height = totalH

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

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

onMounted(() => {
  startCamera()
})

onUnmounted(() => {
  stopCamera()
})

defineExpose({
  captureFrame,
  composeBeforeAfter,
  startCamera,
  stopCamera,
  isActive,
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
    <div v-else class="webcam-view">
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
