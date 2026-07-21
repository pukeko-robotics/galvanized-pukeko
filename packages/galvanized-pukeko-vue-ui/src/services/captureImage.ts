/**
 * Generic single-frame webcam capture client-tool (PLAT-18).
 *
 * Promoted up from pukeko-robot-controller: a single-frame webcam capture is a
 * general capability, not robot-specific. This module is the shared "thin tool
 * layer" — the `capture_image` tool declaration, the capture-to-envelope
 * handler, and small capture-source helpers — so any host registers the tool
 * once and it works on BOTH UI surfaces:
 *
 *   - bespoke `ChatInterface`: spread {@link createCaptureImageClientTool} into
 *     its `clientTools` / `clientToolHandlers` props;
 *   - headless CopilotKit: pass `createCaptureImageFrontendTool()` (from the
 *     `./copilot` sub-export, which wraps {@link captureImageResult}) through
 *     the `frontendTools` prop of `HeadlessChatApp` / `PukekoCopilot`.
 *
 * ## Frozen contract (RC-14)
 * The tool NAME (`capture_image`) and the result envelope — a JSON string of
 * `{ mimeType, data }` on success or `{ error }` on failure — are load-bearing:
 * per-tool result renderers (PLAT-17; e.g. the robot's inline thumbnail) and
 * server-side middleware key on both. Do not change either shape here.
 *
 * ## Server side
 * No server-side stub is required for a gaunt-sloth AG-UI host: the server
 * binds any client-declared run-input tool as a `metadata.client = true`
 * interrupt stub (apiAgUiModule's `buildClientToolStub`), suspending the graph
 * for the browser to fulfil. Hosts that statically configure their agent's
 * tools may still declare their own equivalent stub server-side, but it is
 * redundant as soon as the client declares `capture_image` in the run input.
 */
import type { Tool } from '@ag-ui/client'

/** The frozen client-tool name (RC-14: renderers + middleware key on it). */
export const CAPTURE_IMAGE_TOOL_NAME = 'capture_image'

/**
 * Generic model-facing description. Hosts with a more specific camera (e.g.
 * the robot's overhead webcam) should override it via the factory options so
 * the model knows what the frame actually shows.
 */
export const CAPTURE_IMAGE_DEFAULT_DESCRIPTION =
  'Capture a single photo from the webcam. Returns the current image as seen by the camera.'

/** The success envelope: a base64 image + its mime type (RC-14 frozen shape). */
export interface ImageEnvelope {
  mimeType: string
  data: string
}

/**
 * Where frames come from. Structurally satisfied by the robot's injected
 * browser capabilities and by {@link webcamPanelCaptureSource} /
 * {@link createOnDemandCaptureSource}. `captureFrame` may be async (an
 * on-demand source has to open the camera first).
 */
export interface ImageCaptureSource {
  /** Whether the camera is usable yet (guards the "Webcam not initialized" case). */
  isReady(): boolean
  /** A `data:image/...;base64,` URL of the current frame, or null on failure. */
  captureFrame(): string | null | Promise<string | null>
}

/**
 * Parse a `{ mimeType, data }` image envelope out of a `data:` URL, or null if
 * the string isn't a well-formed base64 image data URL. Pure. Moved verbatim
 * from pukeko-robot-controller's interpreter (PLAT-18) — the robot re-exports
 * this one, and its badge-side envelope parser mirrors this grammar.
 */
export function frameToEnvelope(frame: string | null): ImageEnvelope | null {
  if (!frame) return null
  const match = frame.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,([^"]*)$/)
  if (!match) return null
  return { mimeType: match[1], data: match[2] }
}

/**
 * The generic `capture_image` handler body: capture one frame from `source`
 * and return the JSON string handed back to the model — the success envelope
 * or an `{ error }` envelope. The error strings are part of the frozen
 * contract (the robot's UI and tests assert them verbatim).
 */
export async function captureImageResult(source: ImageCaptureSource): Promise<string> {
  if (!source.isReady()) {
    return JSON.stringify({ error: 'Webcam not initialized' })
  }
  const envelope = frameToEnvelope(await source.captureFrame())
  if (envelope) return JSON.stringify(envelope)
  return JSON.stringify({ error: 'Failed to capture frame. Is the camera active?' })
}

export interface CaptureImageToolOptions {
  /** Model-facing description override (default {@link CAPTURE_IMAGE_DEFAULT_DESCRIPTION}). */
  description?: string
}

/**
 * The AG-UI run-input tool declaration for `capture_image` (no parameters).
 * This is what a bespoke host passes in `ChatInterface`'s `clientTools` and
 * what the gaunt-sloth AG-UI server binds as a client interrupt stub.
 */
export function createCaptureImageToolDeclaration(opts: CaptureImageToolOptions = {}): Tool {
  return {
    name: CAPTURE_IMAGE_TOOL_NAME,
    description: opts.description ?? CAPTURE_IMAGE_DEFAULT_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  }
}

/**
 * Bespoke-path registration helper: everything `ChatInterface` needs to offer
 * `capture_image`, in its prop shapes. Spread into the host's arrays/maps:
 *
 * ```ts
 * const capture = createCaptureImageClientTool(source)
 * // <ChatInterface :client-tools="[capture.tool, ...]"
 * //                :client-tool-handlers="{ [capture.tool.name]: capture.handler, ... }" />
 * ```
 */
export function createCaptureImageClientTool(
  source: ImageCaptureSource,
  opts: CaptureImageToolOptions = {},
): { tool: Tool; handler: () => Promise<string> } {
  return {
    tool: createCaptureImageToolDeclaration(opts),
    handler: () => captureImageResult(source),
  }
}

/**
 * Adapt a mounted {@link PkWebcamPanel} (read lazily through a getter so the
 * panel need not exist yet at wiring time) into an {@link ImageCaptureSource}.
 * This is the shape hosts that already render a live webcam view use.
 */
export function webcamPanelCaptureSource(
  getPanel: () => { captureFrame(): string | null } | null | undefined,
): ImageCaptureSource {
  return {
    isReady: () => getPanel() != null,
    captureFrame: () => getPanel()?.captureFrame() ?? null,
  }
}

/** Options for {@link createOnDemandCaptureSource}. */
export interface OnDemandCaptureOptions {
  /** Longest frame edge after downscale (default 640, matching PkWebcamPanel). */
  maxSize?: number
  /** JPEG quality 0..1 (default 0.8, matching PkWebcamPanel). */
  quality?: number
}

/**
 * A self-contained capture source for hosts with no visible webcam panel (e.g.
 * the headless chat): on each capture it opens `getUserMedia`, waits for the
 * first real frame, downscales to `maxSize` (PkWebcamPanel parity), encodes a
 * JPEG data URL, and releases the camera again. Returns null (→ the standard
 * "Failed to capture frame" envelope) when the camera is denied or absent.
 */
export function createOnDemandCaptureSource(opts: OnDemandCaptureOptions = {}): ImageCaptureSource {
  const maxSize = opts.maxSize ?? 640
  const quality = opts.quality ?? 0.8

  async function grabFrame(): Promise<string | null> {
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices?.getUserMedia) return null
    let stream: MediaStream | null = null
    const video = document.createElement('video')
    video.muted = true
    // iOS Safari requires playsinline for an off-screen autoplaying video.
    video.playsInline = true
    try {
      stream = await mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      video.srcObject = stream
      await video.play()
      // Wait until the stream reports real dimensions (first decoded frame).
      if (video.videoWidth === 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('camera frame timeout')), 10_000)
          video.onloadedmetadata = () => {
            clearTimeout(timer)
            resolve()
          }
        })
      }

      let width = video.videoWidth
      let height = video.videoHeight
      if (width === 0 || height === 0) return null
      const scale = Math.min(1, maxSize / Math.max(width, height))
      width = Math.round(width * scale)
      height = Math.round(height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(video, 0, 0, width, height)
      return canvas.toDataURL('image/jpeg', quality)
    } catch (err) {
      console.warn('[captureImage] on-demand capture failed:', err)
      return null
    } finally {
      video.srcObject = null
      stream?.getTracks().forEach((track) => track.stop())
    }
  }

  return {
    // "Ready" here means capture is worth attempting: the browser has a camera
    // API at all. Permission/hardware failures surface as the capture-failed
    // envelope from grabFrame's null.
    isReady: () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    captureFrame: () => grabFrame(),
  }
}
