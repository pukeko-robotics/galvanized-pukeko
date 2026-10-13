/**
 * The camera tool as a configurable framework capability (RC-35).
 *
 * The tool LAYER (`capture_image`, its handler and the frozen `{mimeType, data}`
 * / `{error}` envelope, RC-14) already lives in `captureImage.ts`. This module
 * adds what a host configures around it — where the live view shows, whether a
 * countdown runs, whether it beeps, how big the photo is — and the capture flow
 * that honours that configuration. Nothing here changes the tool-call
 * signature: the configuration belongs to the host, never to the model.
 *
 * The flow, per capture:
 *   1. Is there a camera at all? (`getUserMedia` present, a `videoinput` listed.)
 *      If not, the session ends `unavailable` and the Chat shows a plain
 *      explanatory message — not an error artefact.
 *   2. Open the stream. `getUserMedia` does not settle until the user answers
 *      the browser's own permission prompt, so the agent's turn waits on it
 *      (D2, refined: the prompt is the native one).
 *   3. Countdown (when configured) with the stream already open, so by shutter
 *      time the sensor has been exposing for seconds (D4 consequence 1).
 *   4. Shutter: blink, shutter sound, then draw one frame from the streaming
 *      element and release the camera.
 *
 * With a permanent preview wired (the robot's Cockpit), steps 1–2 belong to the
 * host's own always-on element; the countdown and shutter still run here and the
 * host's preview is asked to blink.
 */
import { computed, markRaw, reactive, ref, shallowReactive, type ComputedRef, type Ref } from 'vue'
import {
  CAPTURE_IMAGE_FAILED_ERROR,
  DEFAULT_SETTLE_MS,
  captureFailureMessage,
  captureImageResult,
  frameToEnvelope,
  waitForPaintedFrame,
  webcamPanelCaptureSource,
  type ImageCaptureSource,
  type WebcamPanelLike,
} from './captureImage'
import { parseImageEnvelope } from '../components/toolDisplays/imageEnvelope'
import { webcamStatusFromError } from './webcamStatus'

// ---- Configuration ---------------------------------------------------------

/**
 * How big the captured photo (and the transient live view) is drawn inline in
 * the Chat. `collapsed` folds the photo behind a disclosure; it exists for a
 * host that deliberately chooses it and is never the default (D5).
 */
export type InlinePreviewSize = 'full' | 'small' | 'collapsed'

/** Every value {@link InlinePreviewSize} admits, for validation. */
export const INLINE_PREVIEW_SIZES: readonly InlinePreviewSize[] = ['full', 'small', 'collapsed']

/**
 * A host-owned, always-on camera view (the robot's Cockpit `PkWebcamPanel`).
 * When one is wired, captures read from `source` and the transient in-Chat
 * stream element is not shown; `blink` is called at roughly the moment of
 * capture so the host's own view acknowledges the shutter.
 */
export interface PermanentCameraPreview {
  source: ImageCaptureSource
  blink?: () => void
}

/**
 * Host-settable configuration of the camera tool (RC-35). Not part of the
 * tool-call signature: the model calls `capture_image` with no arguments and
 * gets the frozen envelope back whatever is set here.
 *
 * Defaults ({@link DEFAULT_CAMERA_TOOL_CONFIG}) and why:
 *
 * - `permanentPreview: null` — **D1, the preview lives in the Chat by default.**
 *   A message-shaped element in the thread cannot occlude the composer. A host
 *   with a standing camera view (the robot's Cockpit) wires its own here.
 * - `countdownSeconds: 3` — **D4, the photobooth countdown** (`3 — 2 — 1 — 📷`).
 *   The countdown is the decided form of the pause before the shutter; a host
 *   that wants an immediate shot (the robot) sets `0`, which turns it off.
 * - `renderToA2UI: false` — **D1 again**: the Chat is where the preview lives
 *   unless a host opts in to also showing it in the A2UI pane (the headless
 *   Workplane). Where no A2UI pane exists (`?ui=stock`, `a2uiTarget: 'chat'`)
 *   the setting is a documented no-op.
 * - `sounds: true` — **D4, sound and visual together**: three beeps then a
 *   shutter click. Never the only channel (the visual countdown plus an
 *   `aria-live` announcement carry the same information), always mutable by the
 *   user, and a beep the browser refuses never fails the capture.
 * - `inlinePreviewSize: 'full'` — **D5, the captured frame is NOT collapsed by
 *   default.** The photo is the artifact the user asked for, not tool internals.
 *   `collapsed` is available for a host that chooses it; it must not become the
 *   default again.
 * - `toolCallLabel: 'Taking photo…'` — the inline tool-call indicator text
 *   while a capture is in progress (flow step 1).
 */
export interface CameraToolConfig {
  permanentPreview: PermanentCameraPreview | null
  countdownSeconds: number
  renderToA2UI: boolean
  sounds: boolean
  inlinePreviewSize: InlinePreviewSize
  toolCallLabel: string
}

/** The defaults, documented at {@link CameraToolConfig}. */
export const DEFAULT_CAMERA_TOOL_CONFIG: Readonly<CameraToolConfig> = Object.freeze({
  permanentPreview: null,
  countdownSeconds: 3,
  renderToA2UI: false,
  sounds: true,
  inlinePreviewSize: 'full',
  toolCallLabel: 'Taking photo…',
})

/** The longest countdown accepted; anything above is clamped. */
export const MAX_COUNTDOWN_SECONDS = 10

/**
 * Fill a partial host configuration with the defaults and sanitise it: a
 * negative, fractional or non-numeric countdown is rounded and clamped to
 * `0..MAX_COUNTDOWN_SECONDS` (non-numeric falls back to the default), an unknown
 * size falls back to the default size, and a blank label to the default label.
 */
export function resolveCameraToolConfig(partial: Partial<CameraToolConfig> = {}): CameraToolConfig {
  const d = DEFAULT_CAMERA_TOOL_CONFIG
  const rawCountdown = partial.countdownSeconds
  const countdownSeconds =
    typeof rawCountdown === 'number' && Number.isFinite(rawCountdown)
      ? Math.min(MAX_COUNTDOWN_SECONDS, Math.max(0, Math.round(rawCountdown)))
      : d.countdownSeconds
  const inlinePreviewSize =
    partial.inlinePreviewSize && INLINE_PREVIEW_SIZES.includes(partial.inlinePreviewSize)
      ? partial.inlinePreviewSize
      : d.inlinePreviewSize
  const label = typeof partial.toolCallLabel === 'string' ? partial.toolCallLabel.trim() : ''
  return {
    permanentPreview: partial.permanentPreview ?? d.permanentPreview,
    countdownSeconds,
    renderToA2UI: partial.renderToA2UI ?? d.renderToA2UI,
    sounds: partial.sounds ?? d.sounds,
    inlinePreviewSize,
    toolCallLabel: label || d.toolCallLabel,
  }
}

/**
 * Wire a mounted `PkWebcamPanel` as the {@link PermanentCameraPreview}: frames
 * come from the panel (read lazily, so it need not exist yet) and the shutter
 * blinks it through its exposed `blink()`.
 */
export function webcamPanelPermanentPreview(
  getPanel: () => (WebcamPanelLike & { blink?: () => void }) | null | undefined,
): PermanentCameraPreview {
  return {
    source: webcamPanelCaptureSource(getPanel),
    blink: () => getPanel()?.blink?.(),
  }
}

// ---- Copy -----------------------------------------------------------------

/**
 * Shown in the Chat when the camera cannot be reached (flow step 2). Plain
 * copy, not an error artefact. One message for every cause on purpose:
 * telling "permission denied" from "no camera" from "busy" apart is RC-20.
 */
export const CAMERA_UNAVAILABLE_MESSAGE =
  "Sorry, we can't access the camera on this device. Is it disconnected or turned off? " +
  'Check the wires and the on-off switch first; if the camera is built-in, check your ' +
  "computer's privacy settings and this browser's site permissions for the camera."

/** Shown while the frame is still landing after the shutter (D4). */
export const LOADING_PHOTO_MESSAGE = 'Loading your photo'

/** The envelope message for a capture cancelled by the user stopping the run. */
export const CAPTURE_CANCELLED_ERROR = 'Failed to capture frame. The capture was cancelled.'

// ---- Sounds -----------------------------------------------------------------

/** Plays the countdown beep and the shutter click. Either may throw or reject. */
export interface CameraSoundPlayer {
  beep(): unknown
  shutter(): unknown
}

/**
 * Run a sound without letting it fail anything (D4 consequence 2). Browser
 * autoplay policy gates audio on a recent user gesture an agent-initiated
 * capture may not have, so `play()` rejecting — or a sound API throwing
 * outright — is expected, and it must never take the capture with it.
 */
export function playSafely(play: () => unknown): void {
  try {
    const result = play()
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      ;(result as PromiseLike<unknown>).then(undefined, (err: unknown) => {
        console.warn('[camera] sound was refused:', err)
      })
    }
  } catch (err) {
    console.warn('[camera] sound was refused:', err)
  }
}

type AudioContextCtor = new () => AudioContext

/** How long a sound waits for a suspended audio context to resume. */
const RESUME_WAIT_MS = 100

/**
 * The default sound player: synthesised tones through Web Audio, so the
 * library ships no audio assets. A short 880 Hz beep per countdown number and
 * a brief noise burst for the shutter. Where Web Audio is absent it is silent.
 */
export function createWebAudioSoundPlayer(): CameraSoundPlayer {
  let ctx: AudioContext | null = null
  function context(): AudioContext | null {
    if (ctx) return ctx
    const g = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
    const Ctor = g.AudioContext ?? g.webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    return ctx
  }
  async function ready(): Promise<AudioContext | null> {
    const c = context()
    if (!c) return null
    // Without a user gesture `resume()` may reject, or stay pending until one
    // arrives. Wait briefly, and skip this sound if audio is still not running,
    // so a late gesture cannot release a burst of stale beeps. A rejection ends
    // in playSafely.
    if (c.state === 'suspended') {
      await Promise.race([c.resume(), new Promise((resolve) => setTimeout(resolve, RESUME_WAIT_MS))])
    }
    return c.state === 'running' ? c : null
  }
  return {
    async beep() {
      const c = await ready()
      if (!c) return
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.15, c.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12)
      osc.connect(gain).connect(c.destination)
      osc.start()
      osc.stop(c.currentTime + 0.12)
    },
    async shutter() {
      const c = await ready()
      if (!c) return
      const length = Math.floor(c.sampleRate * 0.08)
      const buffer = c.createBuffer(1, length, c.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length)
      const src = c.createBufferSource()
      const gain = c.createGain()
      gain.gain.value = 0.25
      src.buffer = buffer
      src.connect(gain).connect(c.destination)
      src.start()
    },
  }
}

// ---- Streaming element ------------------------------------------------------

/** Draws frames from an open stream. */
export interface FrameGrabber {
  /**
   * One JPEG data URL of the current frame, or null. `warm` says the stream has
   * been open for a while (a countdown ran), so no sensor-settle wait is needed.
   */
  captureFrame(opts: { warm: boolean }): Promise<string | null>
  close(): void
}

/** Longest frame edge, matching PkWebcamPanel and the on-demand source. */
const MAX_FRAME_EDGE = 640
const JPEG_QUALITY = 0.8
const METADATA_TIMEOUT_MS = 10_000

/**
 * The default {@link FrameGrabber}: a muted, inline `<video>` element playing
 * the stream from the moment the camera opens. The visible in-Chat preview
 * attaches the same `MediaStream` to its own element; this one is the capture
 * surface, so a capture works whether or not any preview is mounted.
 */
export function createVideoFrameGrabber(stream: MediaStream): FrameGrabber {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  // Playback starting late, or refused, surfaces as the metadata wait below.
  Promise.resolve()
    .then(() => video.play())
    .catch(() => undefined)
  return {
    async captureFrame({ warm }) {
      if (video.videoWidth === 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('camera frame timeout')), METADATA_TIMEOUT_MS)
          video.onloadedmetadata = () => {
            clearTimeout(timer)
            resolve()
          }
        })
      }
      await waitForPaintedFrame(video)
      // A countdown already gave the sensor seconds to settle (D4 consequence 1);
      // an immediate shot still pays the settle RC-19 measured.
      if (!warm) await new Promise((resolve) => setTimeout(resolve, DEFAULT_SETTLE_MS))
      const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight))
      const width = Math.round(video.videoWidth * scale)
      const height = Math.round(video.videoHeight * scale)
      if (width === 0 || height === 0) return null
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(video, 0, 0, width, height)
      return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    },
    close() {
      video.srcObject = null
    },
  }
}

// ---- Session state ----------------------------------------------------------

/**
 * Where one capture is. `unavailable` is the no-camera / no-access outcome
 * (plain message in the Chat); `failed` is a camera that opened but yielded no
 * frame; `cancelled` is the run being stopped mid-capture.
 */
export type CameraSessionPhase =
  | 'checking'
  | 'requesting'
  | 'countdown'
  | 'loading'
  | 'done'
  | 'unavailable'
  | 'failed'
  | 'cancelled'

/**
 * Reactive state of one capture, keyed by its tool-call id.
 *
 * **D3 — "allowed" and "streaming" are separate state.** `access` answers
 * "could this page reach the camera for this capture?" and `streaming` answers
 * "is the live view active right now?". A granted capture streams during the
 * countdown and stops streaming once the frame is drawn, while `access` stays
 * `granted`; a single boolean could not say that. The persisted "camera
 * allowed" preference itself is the settings panel's (EXT-4), not this.
 */
export interface CameraSession {
  readonly id: string
  phase: CameraSessionPhase
  access: 'unknown' | 'granted' | 'unavailable'
  streaming: boolean
  /** The open stream while `streaming`; the in-Chat preview attaches to it. */
  stream: MediaStream | null
  /** Seconds the countdown started from (0 = no countdown). */
  countdownFrom: number
  /** The number currently shown, `0` at the shutter, null outside a countdown. */
  countdown: number | null
  /** True for a moment at the shutter: the stream element blinks. */
  flash: boolean
  /** The captured frame as a data URL, shown before the tool result lands. */
  photoSrc: string | null
  /** The envelope message behind an `unavailable`/`failed` outcome. */
  detail: string | null
  /** Text for the `aria-live` region: each number, then the shutter. */
  announcement: string
  /** Whether a permanent preview took this capture (no in-Chat stream). */
  permanent: boolean
}

/** Phases in which a capture is still running. */
export function isSessionActive(session: Pick<CameraSession, 'phase'> | null | undefined): boolean {
  return (
    !!session &&
    (session.phase === 'checking' ||
      session.phase === 'requesting' ||
      session.phase === 'countdown' ||
      session.phase === 'loading')
  )
}

// ---- Controller ----------------------------------------------------------------

/** The slice of `navigator.mediaDevices` the controller uses. */
export type MediaDevicesLike = Partial<Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>>

/** Minimal storage used to remember the user's mute choice. */
export type MuteStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Injectable environment, for tests and unusual hosts. Every field defaults. */
export interface CameraControllerDeps {
  mediaDevices?: () => MediaDevicesLike | undefined
  createFrameGrabber?: (stream: MediaStream) => FrameGrabber
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  sounds?: CameraSoundPlayer
  storage?: () => MuteStorage | undefined
  /** How long the shutter blink lasts. */
  flashMs?: number
}

/** The camera tool's runtime: configuration, user mute, and capture sessions. */
export interface CameraController {
  readonly config: Readonly<CameraToolConfig>
  /** The user-facing mute (D4). Remembered per browser where storage allows. */
  readonly muted: Readonly<Ref<boolean>>
  setMuted(muted: boolean): void
  /** The session for a tool-call id, if this controller ran one. */
  session(id: string): CameraSession | undefined
  /** The most recently started session, for the A2UI pane. */
  readonly latestSession: ComputedRef<CameraSession | null>
  /**
   * Run one capture and resolve the frozen `capture_image` envelope string.
   * Never rejects. `id` is the tool-call id (one is generated when absent);
   * `signal` aborts the countdown and releases the camera.
   */
  capture(id?: string, signal?: AbortSignal): Promise<string>
  /** Forget every session (new conversation). Does not stop a running one. */
  clear(): void
}

const MUTE_STORAGE_KEY = 'pk-camera-sounds-muted'
const SECOND_MS = 1000
const DEFAULT_FLASH_MS = 200

class CaptureAbortedError extends Error {
  constructor() {
    super('capture aborted')
    this.name = 'AbortError'
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CaptureAbortedError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new CaptureAbortedError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function defaultMediaDevices(): MediaDevicesLike | undefined {
  return typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
}

function defaultStorage(): MuteStorage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined
  } catch {
    return undefined
  }
}

let generatedIds = 0

/**
 * Create the camera tool's controller. Pass it to `createCaptureImageFrontendTool`
 * (the handler), `registerCaptureImageToolDisplay` (headless rendering) and the
 * headless chat's `camera` prop (the A2UI pane), so all three share one set of
 * sessions.
 */
export function createCameraController(
  config: Partial<CameraToolConfig> = {},
  deps: CameraControllerDeps = {},
): CameraController {
  const resolved = Object.freeze(resolveCameraToolConfig(config))
  const mediaDevices = deps.mediaDevices ?? defaultMediaDevices
  const createGrabber = deps.createFrameGrabber ?? createVideoFrameGrabber
  const sleep = deps.sleep ?? defaultSleep
  const storage = deps.storage ?? defaultStorage
  const flashMs = deps.flashMs ?? DEFAULT_FLASH_MS
  let sounds = deps.sounds ?? null

  const sessions = shallowReactive(new Map<string, CameraSession>())
  const latestId = ref<string | null>(null)

  function readMuted(): boolean {
    try {
      return storage()?.getItem(MUTE_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  }
  const muted = ref(readMuted())

  function setMuted(value: boolean) {
    muted.value = value
    try {
      storage()?.setItem(MUTE_STORAGE_KEY, String(value))
    } catch {
      // Storage refused (private window, blocked site data): the mute still
      // holds for this page, it just is not remembered.
    }
  }

  function play(which: 'beep' | 'shutter') {
    if (!resolved.sounds || muted.value) return
    playSafely(() => {
      sounds ??= createWebAudioSoundPlayer()
      return sounds[which]()
    })
  }

  function newSession(id: string): CameraSession {
    const session = reactive<CameraSession>({
      id,
      phase: 'checking',
      access: 'unknown',
      streaming: false,
      stream: null,
      countdownFrom: resolved.countdownSeconds,
      countdown: null,
      flash: false,
      photoSrc: null,
      detail: null,
      announcement: '',
      permanent: !!resolved.permanentPreview,
    }) as CameraSession
    sessions.set(id, session)
    latestId.value = id
    return session
  }

  /** The D4 countdown: one number per second, a beep on each, then the shutter. */
  async function runCountdown(session: CameraSession, signal?: AbortSignal) {
    if (resolved.countdownSeconds > 0) {
      session.phase = 'countdown'
      for (let n = resolved.countdownSeconds; n >= 1; n--) {
        session.countdown = n
        session.announcement = String(n)
        play('beep')
        await sleep(SECOND_MS, signal)
      }
    }
    if (signal?.aborted) throw new CaptureAbortedError()
    session.countdown = 0
    session.announcement = 'Taking photo now'
  }

  function shutter(session: CameraSession) {
    session.flash = true
    setTimeout(() => {
      session.flash = false
    }, flashMs)
    play('shutter')
    if (resolved.permanentPreview?.blink) {
      try {
        resolved.permanentPreview.blink()
      } catch (err) {
        console.warn('[camera] permanent preview blink failed:', err)
      }
    }
  }

  function unavailable(session: CameraSession, message: string): string {
    session.phase = 'unavailable'
    session.access = 'unavailable'
    session.detail = message
    session.announcement = CAMERA_UNAVAILABLE_MESSAGE
    return JSON.stringify({ error: message })
  }

  function cancelled(session: CameraSession): string {
    session.phase = 'cancelled'
    session.detail = CAPTURE_CANCELLED_ERROR
    session.announcement = ''
    session.countdown = null
    return JSON.stringify({ error: CAPTURE_CANCELLED_ERROR })
  }

  /** Finish from an envelope string: a photo (`done`) or a failure. */
  function settle(session: CameraSession, envelope: string, failedPhase: CameraSessionPhase): string {
    const parsed = parseImageEnvelope(envelope)
    session.countdown = null
    if (parsed.kind === 'image') {
      session.photoSrc = parsed.src
      session.phase = 'done'
      session.announcement = 'Photo taken'
    } else {
      session.phase = failedPhase
      session.detail = parsed.kind === 'error' ? parsed.message : CAPTURE_IMAGE_FAILED_ERROR
      if (failedPhase === 'unavailable') {
        session.access = 'unavailable'
        session.announcement = CAMERA_UNAVAILABLE_MESSAGE
      }
    }
    return envelope
  }

  async function captureWithPermanentPreview(
    session: CameraSession,
    preview: PermanentCameraPreview,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!preview.source.isReady()) {
      return unavailable(session, 'Webcam not initialized')
    }
    session.access = 'granted'
    try {
      await runCountdown(session, signal)
    } catch {
      return cancelled(session)
    }
    shutter(session)
    session.phase = 'loading'
    const envelope = await captureImageResult(preview.source)
    // The host's camera yielded nothing: from the Chat's side that is the
    // camera being unreachable, so it gets the plain message (RC-20 refines).
    return settle(session, envelope, 'unavailable')
  }

  async function captureWithOwnStream(session: CameraSession, signal?: AbortSignal): Promise<string> {
    const devices = mediaDevices()
    if (!devices?.getUserMedia) {
      // Same message the on-demand source's `isReady() === false` produced.
      return unavailable(session, 'Webcam not initialized')
    }
    if (devices.enumerateDevices) {
      try {
        const list = await devices.enumerateDevices()
        if (!list.some((d) => d.kind === 'videoinput')) {
          return unavailable(session, captureFailureMessage('no-device'))
        }
      } catch {
        // Enumeration is only a fast path to the no-camera answer;
        // getUserMedia below gives the authoritative one.
      }
    }
    session.phase = 'requesting'
    let stream: MediaStream
    try {
      // Blocks on the browser's native permission prompt (D2): the turn waits.
      stream = await devices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
    } catch (err) {
      return unavailable(session, captureFailureMessage(webcamStatusFromError(err)))
    }
    const stopTracks = () => stream.getTracks().forEach((track) => track.stop())
    if (signal?.aborted) {
      stopTracks()
      return cancelled(session)
    }
    session.access = 'granted'
    session.stream = markRaw(stream)
    session.streaming = true
    const grabber = createGrabber(stream)
    let frame: string | null = null
    try {
      await runCountdown(session, signal)
      shutter(session)
      session.phase = 'loading'
      frame = await grabber.captureFrame({ warm: resolved.countdownSeconds > 0 })
    } catch (err) {
      if (signal?.aborted || (err as Error)?.name === 'AbortError') {
        return cancelled(session)
      }
      console.warn('[camera] capture failed after the camera opened:', err)
      frame = null
    } finally {
      // The inline stream element disappears just before the photo appears.
      grabber.close()
      stopTracks()
      session.stream = null
      session.streaming = false
    }
    const envelope = frameToEnvelope(frame)
    if (envelope) return settle(session, JSON.stringify(envelope), 'failed')
    // A camera that opened was provably not refused: the frozen message.
    return settle(session, JSON.stringify({ error: CAPTURE_IMAGE_FAILED_ERROR }), 'failed')
  }

  async function capture(id?: string, signal?: AbortSignal): Promise<string> {
    const session = newSession(id ?? `camera-capture-${++generatedIds}`)
    try {
      return resolved.permanentPreview
        ? await captureWithPermanentPreview(session, resolved.permanentPreview, signal)
        : await captureWithOwnStream(session, signal)
    } catch (err) {
      // The handler never rejects: an unexpected throw is a failed capture.
      console.warn('[camera] capture failed:', err)
      return settle(session, JSON.stringify({ error: CAPTURE_IMAGE_FAILED_ERROR }), 'failed')
    }
  }

  return {
    config: resolved,
    muted,
    setMuted,
    session: (id: string) => sessions.get(id),
    latestSession: computed(() => (latestId.value ? (sessions.get(latestId.value) ?? null) : null)),
    capture,
    clear() {
      sessions.clear()
      latestId.value = null
    },
  }
}

// ---- Shared default ------------------------------------------------------------

const DEFAULT_CONTROLLER_KEY = Symbol.for('galvanized-pukeko.vue-ui.defaultCameraController')

type GlobalWithController = typeof globalThis & { [DEFAULT_CONTROLLER_KEY]?: CameraController }

/**
 * The controller used when a host registers the tool and its display without
 * creating one, so the two still share sessions. Anchored on `globalThis` for
 * the same reason as the tool-display registry: vue-ui ships as two bundles,
 * and a module-level singleton would be two singletons.
 */
export function defaultCameraController(): CameraController {
  const g = globalThis as GlobalWithController
  return (g[DEFAULT_CONTROLLER_KEY] ??= createCameraController())
}
