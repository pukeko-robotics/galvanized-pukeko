/**
 * Headless-path registration for the shared `capture_image` client tool
 * (PLAT-18). Produces a CopilotKit `FrontendTool` whose handler runs the camera
 * tool's capture flow (RC-35, services/cameraController.ts) and resolves the
 * same frozen envelope the bespoke path returns (services/captureImage.ts).
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
 * ## Stock rendering (RC-35 O1)
 * The tool carries a `render` — the same {@link PkCameraCapture} element the
 * headless registry shows — so CopilotKit's own `CopilotChat` (`?ui=stock`)
 * renders the live view, countdown and photo too. CopilotKitProvider only turns
 * a frontend tool's `render` into a tool-call renderer when the tool also has a
 * `parameters` schema, so the tool declares {@link NO_ARGUMENTS_SCHEMA}: a
 * Standard Schema whose JSON Schema is exactly the `{type:'object',
 * properties:{}}` CopilotKit advertised for the omitted schema before — the
 * declaration on the wire is unchanged, and still matches the bespoke one.
 */
import { h, type VNodeChild } from 'vue'
import type { VueFrontendTool } from '@copilotkit/vue/v2'
import {
  CAPTURE_IMAGE_TOOL_NAME,
  CAPTURE_IMAGE_DEFAULT_DESCRIPTION,
  captureImageResult,
  type CaptureImageToolOptions,
  type ImageCaptureSource,
} from '../services/captureImage'
import { defaultCameraController, type CameraController } from '../services/cameraController'
import PkCameraCapture from '../components/PkCameraCapture.vue'

export interface CaptureImageFrontendToolOptions extends CaptureImageToolOptions {
  /**
   * The camera controller that runs captures and holds their live state
   * (RC-35). Pass the same one to `registerCaptureImageToolDisplay` so headless
   * renders the sessions this handler starts. Defaults to the shared default
   * controller.
   */
  camera?: CameraController
  /**
   * Legacy escape hatch: capture straight from this source, with no countdown,
   * sounds or live view. Ignored when `camera` is given. A host with its own
   * always-on view should prefer `camera` with a `permanentPreview`.
   */
  source?: ImageCaptureSource
}

/** The JSON Schema `capture_image` declares: no arguments. */
const EMPTY_OBJECT_JSON_SCHEMA = { type: 'object', properties: {} } as const

/**
 * A dependency-free Standard Schema (v1, with Standard JSON Schema) for a tool
 * that takes no arguments. Validation accepts anything — the tool reads no
 * arguments — and the JSON Schema is the empty object schema.
 */
export const NO_ARGUMENTS_SCHEMA = {
  '~standard': {
    version: 1 as const,
    vendor: 'galvanized-pukeko',
    validate: (value: unknown) => ({ value: (value ?? {}) as Record<string, unknown> }),
    jsonSchema: {
      // Same answer for every target CopilotKit asks for (it asks for draft-07).
      input: (_options?: { target?: string }) => ({ ...EMPTY_OBJECT_JSON_SCHEMA, properties: {} }),
      output: (_options?: { target?: string }) => ({ ...EMPTY_OBJECT_JSON_SCHEMA, properties: {} }),
    },
  },
}

/** The stock `render`: {@link PkCameraCapture} bound to `camera`. */
export function createStockCameraCaptureRender(camera: CameraController | null) {
  // A render function: CopilotChat mounts it as a functional component with
  // `{ name, toolCallId, args, status, result }` as its props, re-rendering it
  // as the call moves InProgress → Executing → Complete. The live state comes
  // from the camera session, keyed by the same tool-call id the handler got.
  return (props: { toolCallId: string; result?: string }): VNodeChild =>
    h(PkCameraCapture, {
      toolCallId: props.toolCallId,
      result: props.result ?? null,
      camera,
    })
}

/**
 * Build the `capture_image` CopilotKit frontend tool. The returned object is a
 * plain, stable value — safe for `CopilotKitProvider`'s stable-array
 * `frontendTools` contract when created once at module/setup scope.
 */
export function createCaptureImageFrontendTool(
  opts: CaptureImageFrontendToolOptions = {},
): VueFrontendTool {
  const legacySource = opts.camera ? undefined : opts.source
  const camera = legacySource ? null : (opts.camera ?? defaultCameraController())
  return {
    name: CAPTURE_IMAGE_TOOL_NAME,
    description: opts.description ?? CAPTURE_IMAGE_DEFAULT_DESCRIPTION,
    parameters: NO_ARGUMENTS_SCHEMA,
    handler: (_args, context) =>
      camera
        ? camera.capture(context?.toolCall?.id, context?.signal)
        : captureImageResult(legacySource as ImageCaptureSource),
    render: createStockCameraCaptureRender(camera),
  }
}
