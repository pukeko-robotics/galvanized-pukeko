// RC-19: shared tool-result displays, registered on the PLAT-17 per-tool
// registry. A host opts in by calling the registrar once at app init — the
// registry is not reactive, so register before any chat badge mounts.
//
// Only `capture_image` lives here today: it is the one tool whose result is a
// shared capability (PLAT-18 promoted the tool itself into vue-ui), so every
// host that registers the tool wants the same rendering. Robot-specific
// renderers stay in the robot repo (RC-14), and anything unregistered keeps the
// generic JSON/text fallback on purpose.
import { defineComponent, h, type Component, type PropType } from 'vue'
import { registerToolDisplay } from '../toolDisplay'
import { CAPTURE_IMAGE_TOOL_NAME } from '../../services/captureImage'
import { defaultCameraController, type CameraController } from '../../services/cameraController'
import type { ToolCallPart } from '../../services/chatService'
import CaptureImageResult from './CaptureImageResult.vue'
import PkCameraCapture from '../PkCameraCapture.vue'

/** Options for {@link registerCaptureImageToolDisplay}. */
export interface CaptureImageToolDisplayOptions {
  /** Override when the tool was declared under another name. */
  toolName?: string
  /**
   * The camera controller whose sessions drive the live view, countdown and
   * configured photo size (RC-35). Pass the same one given to
   * `createCaptureImageFrontendTool`. Defaults to the shared default controller.
   */
  camera?: CameraController
}

/**
 * A registry `renderPart` component bound to `camera`: renders the whole
 * `capture_image` part as {@link PkCameraCapture}, uncollapsed (RC-35 D5).
 */
export function createCameraCapturePartRenderer(camera: CameraController | null): Component {
  return defineComponent({
    name: 'PkCameraCapturePart',
    props: { part: { type: Object as PropType<ToolCallPart>, required: true } },
    setup(props) {
      return () =>
        h(PkCameraCapture, {
          toolCallId: props.part.toolCallId,
          result: props.part.result ?? null,
          camera,
        })
    },
  })
}

/**
 * Register the shared `capture_image` display: the camera element in the Chat
 * (RC-35) — live view, countdown, then the photo shown uncollapsed.
 *
 * Idempotent — re-registering a name replaces the entry. Returns an unregister
 * function, mirroring {@link registerToolDisplay}.
 *
 * @param options - the tool name as a string (the original signature), or
 *   {@link CaptureImageToolDisplayOptions}.
 */
export function registerCaptureImageToolDisplay(
  options: string | CaptureImageToolDisplayOptions = {},
): () => void {
  const opts = typeof options === 'string' ? { toolName: options } : options
  return registerToolDisplay(opts.toolName ?? CAPTURE_IMAGE_TOOL_NAME, {
    glyph: '📷',
    // Kept for any host reading the entry directly; ToolCallBadge renders
    // `renderPart` in preference, so this is not what the Chat shows.
    renderResult: CaptureImageResult,
    renderPart: createCameraCapturePartRenderer(opts.camera ?? defaultCameraController()),
  })
}

export { CaptureImageResult }
export { parseImageEnvelope } from './imageEnvelope'
export type { ParsedToolResult } from './imageEnvelope'
