/**
 * Headless-path registration for the shared `capture_image` client tool
 * (PLAT-18). Produces a CopilotKit `FrontendTool` whose handler is the same
 * generic capture-to-envelope service the bespoke path uses
 * (services/captureImage.ts), so both engines return byte-identical envelopes.
 *
 * Registration: pass the returned object in the `frontendTools` array prop of
 * {@link HeadlessChatApp} / {@link PukekoCopilot} (forwarded to
 * `CopilotKitProvider`), or hand it to `useFrontendTool` yourself inside a
 * provider-scoped component. CopilotKit then declares the tool in every
 * run-input; the gaunt-sloth AG-UI server binds it as a client interrupt stub,
 * the graph suspends at the call, CopilotKit runs this handler and re-runs the
 * agent with the result as a trailing `tool` message, and the server translates
 * that into the LangGraph resume (apiAgUiModule's `isCopilotToolResume`).
 *
 * No `parameters` schema is declared: `capture_image` takes no arguments, and
 * CopilotKit serializes an omitted schema as the empty-object JSON schema —
 * matching the bespoke declaration's `{type:'object',properties:{}}`.
 */
import type { VueFrontendTool } from '@copilotkit/vue/v2'
import {
  CAPTURE_IMAGE_TOOL_NAME,
  CAPTURE_IMAGE_DEFAULT_DESCRIPTION,
  captureImageResult,
  createOnDemandCaptureSource,
  type CaptureImageToolOptions,
  type ImageCaptureSource,
} from '../services/captureImage'

export interface CaptureImageFrontendToolOptions extends CaptureImageToolOptions {
  /**
   * Where frames come from. Defaults to an on-demand `getUserMedia` source
   * (open camera → one frame → release) — the right default for the headless
   * surface, which renders no persistent webcam panel.
   */
  source?: ImageCaptureSource
}

/**
 * Build the `capture_image` CopilotKit frontend tool. The returned object is a
 * plain, stable value — safe for `CopilotKitProvider`'s stable-array
 * `frontendTools` contract when created once at module/setup scope.
 */
export function createCaptureImageFrontendTool(
  opts: CaptureImageFrontendToolOptions = {},
): VueFrontendTool {
  const source = opts.source ?? createOnDemandCaptureSource()
  return {
    name: CAPTURE_IMAGE_TOOL_NAME,
    description: opts.description ?? CAPTURE_IMAGE_DEFAULT_DESCRIPTION,
    handler: () => captureImageResult(source),
  }
}
