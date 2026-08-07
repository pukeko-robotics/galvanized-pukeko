// RC-19: shared tool-result displays, registered on the PLAT-17 per-tool
// registry. A host opts in by calling the registrar once at app init — the
// registry is not reactive, so register before any chat badge mounts.
//
// Only `capture_image` lives here today: it is the one tool whose result is a
// shared capability (PLAT-18 promoted the tool itself into vue-ui), so every
// host that registers the tool wants the same rendering. Robot-specific
// renderers stay in the robot repo (RC-14), and anything unregistered keeps the
// generic JSON/text fallback on purpose.
import { registerToolDisplay } from '../toolDisplay'
import { CAPTURE_IMAGE_TOOL_NAME } from '../../services/captureImage'
import CaptureImageResult from './CaptureImageResult.vue'

/**
 * Register the shared `capture_image` result renderer (inline captured frame).
 *
 * Idempotent — re-registering a name replaces the entry. Returns an unregister
 * function, mirroring {@link registerToolDisplay}.
 *
 * @param toolName - override when the tool was declared under another name
 *   (`createCaptureImageToolDeclaration({ name })`).
 */
export function registerCaptureImageToolDisplay(
  toolName: string = CAPTURE_IMAGE_TOOL_NAME
): () => void {
  return registerToolDisplay(toolName, {
    glyph: '📷',
    renderResult: CaptureImageResult,
  })
}

export { CaptureImageResult }
export { parseImageEnvelope } from './imageEnvelope'
export type { ParsedToolResult } from './imageEnvelope'
