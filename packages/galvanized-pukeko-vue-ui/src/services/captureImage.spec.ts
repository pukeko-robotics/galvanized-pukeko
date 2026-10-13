import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CAPTURE_IMAGE_TOOL_NAME,
  CAPTURE_IMAGE_DEFAULT_DESCRIPTION,
  frameToEnvelope,
  captureImageResult,
  createCaptureImageToolDeclaration,
  createCaptureImageClientTool,
  webcamPanelCaptureSource,
  createOnDemandCaptureSource,
  createHttpSnapshotCaptureSource,
  captureFailureMessage,
  drawVideoFrame,
  CAPTURE_IMAGE_FAILED_ERROR,
  type ImageCaptureSource,
} from './captureImage'
import type { WebcamStatus } from './webcamStatus'

const JPEG_FRAME = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

function source(overrides: Partial<ImageCaptureSource> = {}): ImageCaptureSource {
  return {
    isReady: () => true,
    captureFrame: () => JPEG_FRAME,
    ...overrides,
  }
}

describe('frameToEnvelope', () => {
  it('parses a jpeg data URL into { mimeType, data }', () => {
    expect(frameToEnvelope(JPEG_FRAME)).toEqual({
      mimeType: 'image/jpeg',
      data: '/9j/4AAQSkZJRg==',
    })
  })

  it('parses other image mime types (png, svg+xml)', () => {
    expect(frameToEnvelope('data:image/png;base64,AAAA')).toEqual({
      mimeType: 'image/png',
      data: 'AAAA',
    })
    expect(frameToEnvelope('data:image/svg+xml;base64,BBBB')?.mimeType).toBe('image/svg+xml')
  })

  it('returns null for null, non-data-URL, and non-image inputs', () => {
    expect(frameToEnvelope(null)).toBeNull()
    expect(frameToEnvelope('')).toBeNull()
    expect(frameToEnvelope('not a data url')).toBeNull()
    expect(frameToEnvelope('data:text/plain;base64,AAAA')).toBeNull()
  })
})

describe('createCaptureImageToolDeclaration', () => {
  it('declares the frozen tool name with an empty-object parameter schema', () => {
    const tool = createCaptureImageToolDeclaration()
    expect(tool.name).toBe(CAPTURE_IMAGE_TOOL_NAME)
    expect(tool.name).toBe('capture_image') // RC-14: the name is load-bearing.
    expect(tool.description).toBe(CAPTURE_IMAGE_DEFAULT_DESCRIPTION)
    expect(tool.parameters).toEqual({ type: 'object', properties: {}, required: [] })
  })

  it('lets the host override the model-facing description', () => {
    const tool = createCaptureImageToolDeclaration({ description: 'Overhead robot cam.' })
    expect(tool.description).toBe('Overhead robot cam.')
    expect(tool.name).toBe('capture_image')
  })
})

describe('captureImageResult', () => {
  it('returns the success envelope JSON for a valid frame', async () => {
    const result = await captureImageResult(source())
    expect(JSON.parse(result)).toEqual({ mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRg==' })
  })

  it('supports async captureFrame sources', async () => {
    const result = await captureImageResult(
      source({ captureFrame: () => Promise.resolve(JPEG_FRAME) }),
    )
    expect(JSON.parse(result)).toEqual({ mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRg==' })
  })

  // The two error strings are frozen: robot-controller UI/tests assert them.
  it('returns the exact not-initialized error when the source is not ready', async () => {
    const result = await captureImageResult(source({ isReady: () => false }))
    expect(result).toBe(JSON.stringify({ error: 'Webcam not initialized' }))
  })

  it('returns the exact capture-failed error for a null or malformed frame', async () => {
    expect(await captureImageResult(source({ captureFrame: () => null }))).toBe(
      JSON.stringify({ error: 'Failed to capture frame. Is the camera active?' }),
    )
    expect(await captureImageResult(source({ captureFrame: () => 'garbage' }))).toBe(
      JSON.stringify({ error: 'Failed to capture frame. Is the camera active?' }),
    )
  })
})

/**
 * RC-55: a failed capture names its cause when the source can report one.
 *
 * The measured problem: after a caller had already waited out a five-second
 * readiness deadline, the envelope still asked `Is the camera active?` — a
 * question the model cannot answer and cannot act on.
 *
 * The hook is OPT-IN, and that is what keeps the RC-14 frozen contract intact:
 * a source with no `cameraStatus()` produces the previous bytes exactly, so no
 * existing consumer's behaviour moved.
 */
describe('captureImageResult — naming the cause of a failed capture (RC-55)', () => {
  /** A source that fails to produce a frame and reports why. */
  function failingSourceWithStatus(status: WebcamStatus | null): ImageCaptureSource {
    return source({ captureFrame: () => null, cameraStatus: () => status })
  }

  const errorOf = async (s: ImageCaptureSource) =>
    (JSON.parse(await captureImageResult(s)) as { error: string }).error

  it('leaves the frozen message byte-identical for a source with no status hook', async () => {
    // The control on the whole design: `source()` builds the pre-RC-55 shape.
    const before = await captureImageResult(source({ captureFrame: () => null }))
    expect(before).toBe(JSON.stringify({ error: 'Failed to capture frame. Is the camera active?' }))
    expect(before).toBe(JSON.stringify({ error: CAPTURE_IMAGE_FAILED_ERROR }))
  })

  it.each([
    ['denied', 'Failed to capture frame. Camera permission was denied.'],
    ['no-device', 'Failed to capture frame. No camera device was found.'],
    ['busy', 'Failed to capture frame. The camera is in use by another application.'],
    ['starting', 'Failed to capture frame. The camera has not finished starting.'],
    ['idle', 'Failed to capture frame. The camera is not running.'],
  ] as ReadonlyArray<readonly [WebcamStatus, string]>)(
    'names a %s camera in the failure envelope',
    async (status, expected) => {
      expect(await errorOf(failingSourceWithStatus(status))).toBe(expected)
      // Each cause reads differently from the frozen default — the point of RC-55.
      expect(expected).not.toBe(CAPTURE_IMAGE_FAILED_ERROR)
    },
  )

  it('keeps the frozen message for statuses that name no cause', async () => {
    // `live` (open camera, capture failed anyway) and `error` (the catch-all
    // for a rejection this vocabulary does not name, recognised ones such as
    // OverconstrainedError included) are both "we do not know" as far as the
    // message is concerned, which is what the question already says. A null
    // status — a source whose panel has unmounted — is the same.
    expect(await errorOf(failingSourceWithStatus('live'))).toBe(CAPTURE_IMAGE_FAILED_ERROR)
    expect(await errorOf(failingSourceWithStatus('error'))).toBe(CAPTURE_IMAGE_FAILED_ERROR)
    expect(await errorOf(failingSourceWithStatus(null))).toBe(CAPTURE_IMAGE_FAILED_ERROR)
  })

  it('keeps `Failed to capture frame.` as the leading sentence in every case', async () => {
    // Result renderers and log scrapes key on this prefix; only the trailing
    // question is replaced.
    for (const status of ['denied', 'no-device', 'busy', 'starting', 'idle', 'live', 'error'] as const) {
      expect(await errorOf(failingSourceWithStatus(status))).toMatch(/^Failed to capture frame\. /)
    }
  })

  it('does not consult the status when the capture SUCCEEDS', async () => {
    const cameraStatus = vi.fn(() => 'denied' as WebcamStatus)
    const result = await captureImageResult(source({ cameraStatus }))

    expect(JSON.parse(result)).toEqual({ mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRg==' })
    expect(cameraStatus).not.toHaveBeenCalled()
  })

  it('leaves the not-initialized envelope alone even when a status is available', async () => {
    // `isReady()` semantics are untouched: a not-ready source keeps its own
    // frozen message rather than being re-routed through the capture-failed one.
    const result = await captureImageResult(
      source({ isReady: () => false, cameraStatus: () => 'denied' }),
    )
    expect(result).toBe(JSON.stringify({ error: 'Webcam not initialized' }))
  })
})

describe('captureFailureMessage', () => {
  it('falls back to the frozen message for an absent status', () => {
    expect(captureFailureMessage(null)).toBe(CAPTURE_IMAGE_FAILED_ERROR)
    expect(captureFailureMessage(undefined)).toBe(CAPTURE_IMAGE_FAILED_ERROR)
  })

  it('exports the frozen string as the RC-14 bytes, not a paraphrase', () => {
    expect(CAPTURE_IMAGE_FAILED_ERROR).toBe('Failed to capture frame. Is the camera active?')
  })
})

describe('createCaptureImageClientTool (bespoke ChatInterface helper)', () => {
  it('returns the declaration plus a handler wired to the source', async () => {
    const { tool, handler } = createCaptureImageClientTool(source())
    expect(tool.name).toBe('capture_image')
    expect(JSON.parse(await handler())).toEqual({
      mimeType: 'image/jpeg',
      data: '/9j/4AAQSkZJRg==',
    })
  })

  it('passes description overrides through to the declaration', () => {
    const { tool } = createCaptureImageClientTool(source(), { description: 'robot cam' })
    expect(tool.description).toBe('robot cam')
  })
})

describe('webcamPanelCaptureSource', () => {
  it('is not ready until the panel getter returns an instance', () => {
    let panel: { captureFrame(): string | null } | null = null
    const s = webcamPanelCaptureSource(() => panel)
    expect(s.isReady()).toBe(false)
    panel = { captureFrame: () => JPEG_FRAME }
    expect(s.isReady()).toBe(true)
    expect(s.captureFrame()).toBe(JPEG_FRAME)
  })

  it('captures null when the panel has unmounted again', () => {
    const s = webcamPanelCaptureSource(() => null)
    expect(s.captureFrame()).toBeNull()
  })

  // RC-55: the adapter is what carries the panel's status into the envelope.
  it('reports the mounted panel’s status, read fresh on every capture', () => {
    const panel = { captureFrame: () => null, cameraStatus: 'starting' as WebcamStatus }
    const s = webcamPanelCaptureSource(() => panel)

    expect(s.cameraStatus?.()).toBe('starting')
    panel.cameraStatus = 'denied'
    // Re-read, not cached at construction: the panel's status moves underneath it.
    expect(s.cameraStatus?.()).toBe('denied')
  })

  it('reports a null status for a panel too old to expose one, or none at all', () => {
    // A panel on an older pin satisfies the shape without `cameraStatus`, and must
    // keep producing the frozen message rather than throwing.
    const oldPanel = { captureFrame: () => null }
    expect(webcamPanelCaptureSource(() => oldPanel).cameraStatus?.()).toBeNull()
    expect(webcamPanelCaptureSource(() => null).cameraStatus?.()).toBeNull()
  })

  it('turns a denied panel into a failure envelope that names the denial', async () => {
    const panel = { captureFrame: () => null, cameraStatus: 'denied' as WebcamStatus }
    const result = await captureImageResult(webcamPanelCaptureSource(() => panel))

    expect(JSON.parse(result)).toEqual({
      error: 'Failed to capture frame. Camera permission was denied.',
    })
  })

  it('still produces the frozen message for a panel that cannot report a status', async () => {
    const oldPanel = { captureFrame: () => null }
    const result = await captureImageResult(webcamPanelCaptureSource(() => oldPanel))

    expect(result).toBe(JSON.stringify({ error: CAPTURE_IMAGE_FAILED_ERROR }))
  })
})

describe('createOnDemandCaptureSource', () => {
  // jsdom has no getUserMedia: the source must degrade to not-ready (so the
  // handler returns the standard not-initialized envelope) rather than throw.
  // The happy path is exercised in the real-browser headless e2e with
  // Chromium's fake camera (chat-gth-headless.spec.ts).
  it('reports not-ready when the browser has no camera API', () => {
    const s = createOnDemandCaptureSource()
    expect(s.isReady()).toBe(false)
  })

  it('produces the standard not-initialized envelope through captureImageResult', async () => {
    const result = await captureImageResult(createOnDemandCaptureSource())
    expect(result).toBe(JSON.stringify({ error: 'Webcam not initialized' }))
  })
})

/**
 * RC-57: the on-demand source held the rejection and threw it away.
 *
 * `getUserMedia` rejects with the exact object that says why the camera has no
 * frames, and `grabFrame` caught it, logged it, and returned an undifferentiated
 * null — so the envelope fell back to the frozen question and asked the model
 * something we already knew the answer to. This source is the DEFAULT for both
 * CopilotKit surfaces (`captureImageFrontendTool`), so that was the common path.
 *
 * Every cell asserts on the MESSAGE that reaches `captureImageResult`, never
 * merely that a capture failed: one cause's failure would otherwise stand in for
 * another's, which is an assertion that cannot fail in the way that matters.
 */
describe('createOnDemandCaptureSource — naming the cause of a failed capture (RC-57)', () => {
  const DATA_URL = 'data:image/jpeg;base64,PAINTED'
  const restores: Array<() => void> = []
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // The catch logs deliberately; keep the suite output clean.
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    while (restores.length) restores.pop()!()
    warn.mockRestore()
  })

  /** Install a `navigator.mediaDevices` whose `getUserMedia` runs `impl`. */
  function stubGetUserMedia(impl: () => Promise<unknown>) {
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(impl) },
      configurable: true,
    })
    restores.push(() => {
      if (original) Object.defineProperty(navigator, 'mediaDevices', original)
      else delete (navigator as unknown as Record<string, unknown>).mediaDevices
    })
  }

  function patch(proto: object, key: string, value: unknown) {
    const target = proto as Record<string, unknown>
    const original = Object.getOwnPropertyDescriptor(target, key)
    Object.defineProperty(target, key, { value, configurable: true, writable: true })
    restores.push(() => {
      if (original) Object.defineProperty(target, key, original)
      else delete target[key]
    })
  }

  function patchGetter(proto: object, key: string, get: () => unknown) {
    const target = proto as Record<string, unknown>
    const original = Object.getOwnPropertyDescriptor(target, key)
    Object.defineProperty(target, key, { get, configurable: true })
    restores.push(() => {
      if (original) Object.defineProperty(target, key, original)
      else delete target[key]
    })
  }

  /**
   * Stub the DOM the capture path walks once the camera IS open. `context` is
   * what `getContext('2d')` yields — null fails the draw WITHOUT throwing, the
   * one failure shape that must not name a cause.
   */
  function stubCaptureDom(context: { drawImage: () => void } | null) {
    patch(HTMLMediaElement.prototype, 'play', vi.fn().mockResolvedValue(undefined))
    patchGetter(HTMLVideoElement.prototype, 'videoWidth', () => 640)
    patchGetter(HTMLVideoElement.prototype, 'videoHeight', () => 480)
    patch(HTMLVideoElement.prototype, 'requestVideoFrameCallback', (cb: () => void) => {
      cb()
      return 1
    })
    patch(HTMLCanvasElement.prototype, 'getContext', () => context)
    patch(HTMLCanvasElement.prototype, 'toDataURL', () => DATA_URL)
  }

  /** A camera that refuses to open, with the browser's own rejection. */
  function rejectingCamera(err: unknown): ImageCaptureSource {
    stubGetUserMedia(() => Promise.reject(err))
    return createOnDemandCaptureSource({ settleMs: 0 })
  }

  const errorOf = async (s: ImageCaptureSource) =>
    (JSON.parse(await captureImageResult(s)) as { error: string }).error

  it.each([
    ['NotAllowedError', 'Failed to capture frame. Camera permission was denied.'],
    ['NotFoundError', 'Failed to capture frame. No camera device was found.'],
    ['NotReadableError', 'Failed to capture frame. The camera is in use by another application.'],
    ['SecurityError', 'Failed to capture frame. Camera permission was denied.'],
    // The legacy aliases pass only because the mapping is RC-55's shared table
    // rather than a switch hand-written here, which would have listed the modern
    // names and stopped.
    ['PermissionDismissedError', 'Failed to capture frame. Camera permission was denied.'],
    ['TrackStartError', 'Failed to capture frame. The camera is in use by another application.'],
  ])('names a %s rejection in the failure envelope', async (name, expected) => {
    const source = rejectingCamera(new DOMException('camera unavailable', name))

    expect(await errorOf(source)).toBe(expected)
    // Not a self-comparison: `expected` is this table's literal, but
    // CAPTURE_IMAGE_FAILED_ERROR is imported from production. This goes red if
    // the frozen "we do not know" message is ever changed to read like one of
    // the causes, which the assertion above would not catch — it would keep
    // passing with both sides moved to the same wrong string.
    expect(expected).not.toBe(CAPTURE_IMAGE_FAILED_ERROR)
  })

  it('does NOT name a cause for a failure after the camera has opened', async () => {
    // The measured defect this split closes. `getUserMedia` RESOLVES — the user
    // granted permission — and `play()` then rejects under autoplay policy with
    // `NotAllowedError`, the name the table maps to `denied`. Classifying
    // anything past `getUserMedia` therefore reported a refusal for a camera
    // that had just been allowed. `stop` having been called is what proves the
    // camera really opened, rather than this being any old failure.
    const stop = vi.fn()
    stubGetUserMedia(async () => ({ getTracks: () => [{ stop }] }))
    stubCaptureDom({ drawImage: vi.fn() })
    // After stubCaptureDom, which patches `play` to resolve; restores are LIFO.
    patch(
      HTMLMediaElement.prototype,
      'play',
      vi.fn().mockRejectedValue(new DOMException('autoplay blocked', 'NotAllowedError')),
    )
    const source = createOnDemandCaptureSource({ settleMs: 0 })

    expect(await errorOf(source)).toBe(CAPTURE_IMAGE_FAILED_ERROR)
    expect(source.cameraStatus?.()).toBe('error')
    expect(stop).toHaveBeenCalled()
  })

  it('keeps the frozen message for an OverconstrainedError', async () => {
    // RC-55 maps this to `error` on purpose (webcamStatus.ts): the name means an
    // ATTACHED camera could not meet the requested constraints, not that no
    // camera exists. The vocabulary has no word for that, so the honest report
    // is the frozen "we do not know" question. Naming it here would take a
    // second, divergent mapping — the failure this pair of nodes exists to close.
    const source = rejectingCamera(new DOMException('width unsupported', 'OverconstrainedError'))

    expect(await errorOf(source)).toBe('Failed to capture frame. Is the camera active?')
    expect(await errorOf(source)).toBe(CAPTURE_IMAGE_FAILED_ERROR)
  })

  it('keeps the frozen message for a rejection the vocabulary does not recognise', async () => {
    const source = rejectingCamera(new Error('camera frame timeout'))

    expect(await errorOf(source)).toBe('Failed to capture frame. Is the camera active?')
  })

  it('reports a null status before any capture has been attempted', () => {
    stubGetUserMedia(() => Promise.reject(new DOMException('refused', 'NotAllowedError')))
    const source = createOnDemandCaptureSource({ settleMs: 0 })

    // Null, not undefined — the same "nothing to report" the panel adapter's
    // `?? null` yields for an unmounted panel.
    expect(source.cameraStatus?.()).toBeNull()
  })

  it('does not claim a status after a capture SUCCEEDS', async () => {
    // The camera is released in `finally`, so `live` would be false the moment
    // it was read. Nothing to report is the truthful answer.
    stubGetUserMedia(async () => ({ getTracks: () => [{ stop: vi.fn() }] }))
    stubCaptureDom({ drawImage: vi.fn() })
    const source = createOnDemandCaptureSource({ settleMs: 0 })

    expect(await source.captureFrame()).toBe(DATA_URL)
    expect(source.cameraStatus?.()).toBeNull()
  })

  it('does not carry a status from one capture to the next', async () => {
    // The sharpest case this guards: a denial the user has SINCE GRANTED.
    // Capture 1 is refused. Capture 2 opens the camera and fails at the draw
    // instead — a failure with no nameable cause. Without the per-attempt reset,
    // capture 2 blames a permission that is no longer denied.
    let attempt = 0
    stubGetUserMedia(async () => {
      if (attempt++ === 0) throw new DOMException('refused', 'NotAllowedError')
      return { getTracks: () => [{ stop: vi.fn() }] }
    })
    stubCaptureDom(null)
    const source = createOnDemandCaptureSource({ settleMs: 0 })

    expect(await errorOf(source)).toBe('Failed to capture frame. Camera permission was denied.')
    expect(await errorOf(source)).toBe('Failed to capture frame. Is the camera active?')
  })

  it('leaves a source that omits the hook producing the frozen bytes', async () => {
    // The RC-14 contract, unmoved: supplying `cameraStatus` is what turns
    // cause-naming on, so a source without it is byte-identical to before.
    const hookless: ImageCaptureSource = { isReady: () => true, captureFrame: () => null }

    expect(hookless.cameraStatus).toBeUndefined()
    expect(await captureImageResult(hookless)).toBe(
      JSON.stringify({ error: 'Failed to capture frame. Is the camera active?' }),
    )
  })

  it('still logs the rejection, the only place its own name and message survive', async () => {
    const err = new DOMException('width unsupported', 'OverconstrainedError')

    await captureImageResult(rejectingCamera(err))

    // The status vocabulary is closed, so it collapses this to `error`. Without
    // the log the browser's own reason would be lost to a developer entirely,
    // which is why the warn stays.
    expect(warn).toHaveBeenCalledWith('[captureImage] on-demand capture failed:', err)
  })
})

// RC-19: the capture used to draw as soon as the stream reported its DIMENSIONS
// (`loadedmetadata`), which does not mean a frame has been decoded and painted —
// so it encoded a well-formed JPEG of pure black. These specs pin the wait for a
// real painted frame. They are discriminating: with the draw moved back above the
// wait, the first one fails on `drawImage` having already run.
describe('createOnDemandCaptureSource — waits for a painted frame', () => {
  const DATA_URL = 'data:image/jpeg;base64,PAINTED'
  const restores: Array<() => void> = []

  afterEach(() => {
    while (restores.length) restores.pop()!()
    vi.useRealTimers()
  })

  /** Stub just enough DOM for the capture path; returns the drawImage spy and,
   *  when `announceFrame` is false, the withheld frame callback. */
  function stubCaptureDom(options: { announceFrame: boolean; hasFrameCallback?: boolean }) {
    const hasFrameCallback = options.hasFrameCallback ?? true
    const drawImage = vi.fn()
    let pendingFrameCallback: (() => void) | null = null

    const stop = vi.fn()
    const mediaDevices = { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) }
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices, configurable: true })
    restores.push(() => {
      if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
      else delete (navigator as unknown as Record<string, unknown>).mediaDevices
    })

    // Dimensions are available immediately — exactly the case that skipped the old
    // `loadedmetadata` wait entirely and drew a blank canvas.
    const videoProto = HTMLVideoElement.prototype as unknown as Record<string, unknown>
    const mediaProto = HTMLMediaElement.prototype as unknown as Record<string, unknown>
    const patch = (proto: Record<string, unknown>, key: string, value: unknown) => {
      const original = Object.getOwnPropertyDescriptor(proto, key)
      Object.defineProperty(proto, key, { value, configurable: true, writable: true })
      restores.push(() => {
        if (original) Object.defineProperty(proto, key, original)
        else delete proto[key]
      })
    }
    const patchGetter = (proto: Record<string, unknown>, key: string, get: () => unknown) => {
      const original = Object.getOwnPropertyDescriptor(proto, key)
      Object.defineProperty(proto, key, { get, configurable: true })
      restores.push(() => {
        if (original) Object.defineProperty(proto, key, original)
        else delete proto[key]
      })
    }

    patch(mediaProto, 'play', vi.fn().mockResolvedValue(undefined))
    patchGetter(videoProto, 'videoWidth', () => 640)
    patchGetter(videoProto, 'videoHeight', () => 480)

    if (hasFrameCallback) {
      patch(videoProto, 'requestVideoFrameCallback', (cb: () => void) => {
        if (options.announceFrame) cb()
        else pendingFrameCallback = cb
        return 1
      })
    } else {
      // Force the two-chained-animation-frames fallback.
      patch(videoProto, 'requestVideoFrameCallback', undefined)
    }

    patch(HTMLCanvasElement.prototype as unknown as Record<string, unknown>, 'getContext', () => ({
      drawImage,
    }))
    patch(
      HTMLCanvasElement.prototype as unknown as Record<string, unknown>,
      'toDataURL',
      () => DATA_URL
    )

    return { drawImage, announcePendingFrame: () => pendingFrameCallback?.() }
  }

  it('does not draw until a frame has actually been painted', async () => {
    const { drawImage, announcePendingFrame } = stubCaptureDom({ announceFrame: false })

    const pending = createOnDemandCaptureSource({ settleMs: 0 }).captureFrame()
    // Let getUserMedia + play settle; the frame callback is deliberately withheld.
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(drawImage).not.toHaveBeenCalled()

    announcePendingFrame()
    await expect(pending).resolves.toBe(DATA_URL)
    expect(drawImage).toHaveBeenCalledTimes(1)
  })

  it('falls back to animation frames when requestVideoFrameCallback is unavailable', async () => {
    const { drawImage } = stubCaptureDom({ announceFrame: true, hasFrameCallback: false })

    const frame = await createOnDemandCaptureSource({ settleMs: 0 }).captureFrame()

    expect(frame).toBe(DATA_URL)
    expect(drawImage).toHaveBeenCalledTimes(1)
  })

  it('draws anyway when no frame is ever announced, rather than failing the capture', async () => {
    vi.useFakeTimers()
    const { drawImage } = stubCaptureDom({ announceFrame: false })

    const pending = createOnDemandCaptureSource({ settleMs: 0 }).captureFrame()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(drawImage).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2_000)

    await expect(pending).resolves.toBe(DATA_URL)
    expect(drawImage).toHaveBeenCalledTimes(1)
  })
})

describe('drawVideoFrame — the one frame-drawing sequence (RC-35 review finding 4)', () => {
  const DATA_URL = 'data:image/jpeg;base64,DRAWN'

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** A playing video stand-in that announces a painted frame immediately. */
  function video(width: number, height: number) {
    return {
      videoWidth: width,
      videoHeight: height,
      requestVideoFrameCallback: (cb: () => void) => {
        cb()
        return 1
      },
    } as unknown as HTMLVideoElement
  }

  function stubCanvas() {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D)
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(DATA_URL)
    return { drawImage, toDataURL }
  }

  it('downscales the longest edge to 640 and encodes JPEG at 0.8 by default', async () => {
    const { drawImage, toDataURL } = stubCanvas()
    const v = video(1280, 720)
    await expect(drawVideoFrame(v)).resolves.toBe(DATA_URL)
    expect(drawImage).toHaveBeenCalledWith(v, 0, 0, 640, 360)
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8)
  })

  it('honours maxSize and quality', async () => {
    const { drawImage, toDataURL } = stubCanvas()
    const v = video(800, 600)
    await drawVideoFrame(v, { maxSize: 400, quality: 0.5 })
    expect(drawImage).toHaveBeenCalledWith(v, 0, 0, 400, 300)
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.5)
  })

  it('waits settleMs after the painted frame before drawing, and not at all by default', async () => {
    vi.useFakeTimers()
    const { drawImage } = stubCanvas()
    const settled = drawVideoFrame(video(640, 480), { settleMs: 300 })
    await vi.advanceTimersByTimeAsync(299)
    expect(drawImage).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await settled
    expect(drawImage).toHaveBeenCalledTimes(1)

    await drawVideoFrame(video(640, 480))
    expect(drawImage).toHaveBeenCalledTimes(2)
  })

  it('resolves null when there is nothing to draw', async () => {
    stubCanvas()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    await expect(drawVideoFrame(video(640, 480))).resolves.toBeNull()
  })
})

describe('createHttpSnapshotCaptureSource', () => {
  /** Bytes standing in for a JPEG frame; the exact values are what we round-trip. */
  const FRAME_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x00, 0xff])

  const FROZEN_CAPTURE_ERROR = JSON.stringify({
    error: 'Failed to capture frame. Is the camera active?',
  })

  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // These paths log deliberately; keep the suite output clean.
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  function imageResponse(
    bytes: Uint8Array,
    contentType: string | null = 'image/jpeg',
    status = 200,
  ) {
    // A fresh ArrayBuffer copy: Response wants a BodyInit, not a typed-array view.
    // A byte body also matters: a STRING body makes the Response constructor stamp
    // `Content-Type: text/plain`, which would let the mime check stand in for the
    // status check and quietly hollow out the non-2xx tests below.
    return new Response(bytes.slice().buffer as ArrayBuffer, {
      status,
      headers: contentType == null ? {} : { 'content-type': contentType },
    })
  }

  /** Decode a base64 payload back to the bytes it was made from. */
  function base64ToBytes(data: string): Uint8Array {
    const binary = atob(data)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  }

  it('round-trips fetched image bytes through frameToEnvelope unchanged', async () => {
    const fetchImpl = vi.fn(async () => imageResponse(FRAME_BYTES))
    const source = createHttpSnapshotCaptureSource({
      getUrl: () => 'http://robot.local/snapshot.jpg',
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
    })

    const frame = await source.captureFrame()

    // The real parser — not a copy of its regex — is what pins this contract.
    const envelope = frameToEnvelope(frame)
    expect(envelope).not.toBeNull()
    expect(envelope!.mimeType).toBe('image/jpeg')
    expect(base64ToBytes(envelope!.data)).toEqual(FRAME_BYTES)
  })

  it('GETs the URL with an abort signal', async () => {
    const fetchImpl = vi.fn(async () => imageResponse(FRAME_BYTES))
    const source = createHttpSnapshotCaptureSource({
      getUrl: () => 'http://robot.local/snapshot.jpg',
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
    })

    await source.captureFrame()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://robot.local/snapshot.jpg')
    expect(init.method).toBe('GET')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    // A live deadline, not one that had already elapsed before the request went out.
    expect(init.signal!.aborted).toBe(false)
  })

  it('takes the mime type from Content-Type, ignoring parameters', async () => {
    const source = createHttpSnapshotCaptureSource({
      getUrl: () => 'http://robot.local/snapshot.png',
      fetch: (async () =>
        imageResponse(FRAME_BYTES, 'image/PNG; charset=binary')) as unknown as typeof globalThis.fetch,
    })

    expect(frameToEnvelope(await source.captureFrame())?.mimeType).toBe('image/png')
  })

  it('falls back to image/jpeg when the response carries no Content-Type', async () => {
    const source = createHttpSnapshotCaptureSource({
      getUrl: () => 'http://robot.local/snapshot',
      fetch: (async () => imageResponse(FRAME_BYTES, null)) as unknown as typeof globalThis.fetch,
    })

    expect(frameToEnvelope(await source.captureFrame())?.mimeType).toBe('image/jpeg')
  })

  it('reads the URL getter on EVERY capture, not once at construction', async () => {
    const urls = ['http://first.local/snap', 'http://second.local/snap']
    let index = 0
    const getUrl = vi.fn(() => urls[Math.min(index++, urls.length - 1)])
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      imageResponse(FRAME_BYTES),
    )
    const source = createHttpSnapshotCaptureSource({
      getUrl,
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
    })

    // Nothing may be read before the first capture.
    expect(getUrl).not.toHaveBeenCalled()

    await source.captureFrame()
    await source.captureFrame()

    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      'http://first.local/snap',
      'http://second.local/snap',
    ])
  })

  describe('every failure yields null, and therefore the frozen error envelope', () => {
    async function expectFailure(source: ImageCaptureSource) {
      await expect(source.captureFrame()).resolves.toBeNull()
      await expect(captureImageResult(source)).resolves.toBe(FROZEN_CAPTURE_ERROR)
    }

    // These two responses are deliberately indistinguishable from a good frame
    // EXCEPT for their status: real image bytes, an explicit `image/jpeg` header.
    // A robot whose error handler still declares an image content type, or a proxy
    // returning a placeholder image with an error status, produces exactly this —
    // and only the status guard can reject it, so only these cases pin that guard.
    it('on a 404 that still declares image/jpeg and carries a plausible body', async () => {
      await expectFailure(
        createHttpSnapshotCaptureSource({
          getUrl: () => 'http://robot.local/snapshot.jpg',
          fetch: (async () =>
            imageResponse(FRAME_BYTES, 'image/jpeg', 404)) as unknown as typeof globalThis.fetch,
        }),
      )
    })

    it('on a 500 that still declares image/jpeg and carries a plausible body', async () => {
      await expectFailure(
        createHttpSnapshotCaptureSource({
          getUrl: () => 'http://robot.local/snapshot.jpg',
          fetch: (async () =>
            imageResponse(FRAME_BYTES, 'image/jpeg', 500)) as unknown as typeof globalThis.fetch,
        }),
      )
    })

    it('on a network throw', async () => {
      await expectFailure(
        createHttpSnapshotCaptureSource({
          getUrl: () => 'http://robot.local/snapshot.jpg',
          fetch: (async () => {
            throw new TypeError('Failed to fetch')
          }) as unknown as typeof globalThis.fetch,
        }),
      )
    })

    it('on a 200 whose Content-Type is text/html (a captive portal)', async () => {
      await expectFailure(
        createHttpSnapshotCaptureSource({
          getUrl: () => 'http://robot.local/snapshot.jpg',
          fetch: (async () =>
            new Response('<html>sign in</html>', {
              status: 200,
              headers: { 'content-type': 'text/html; charset=utf-8' },
            })) as unknown as typeof globalThis.fetch,
        }),
      )
    })

    it('on a timeout, rather than hanging the turn forever', async () => {
      // A host that neither answers nor refuses: only the abort signal ends this.
      const fetchImpl = (async (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })) as unknown as typeof globalThis.fetch

      await expectFailure(
        createHttpSnapshotCaptureSource({
          getUrl: () => 'http://unreachable.local/snapshot.jpg',
          fetch: fetchImpl,
          timeoutMs: 5,
        }),
      )
    })
  })

  describe('isReady', () => {
    const neverFetch = (async () => {
      throw new Error('isReady must not touch the network')
    }) as unknown as typeof globalThis.fetch

    it('is false when the getter yields nothing usable', () => {
      for (const value of ['', '   ', null, undefined]) {
        const source = createHttpSnapshotCaptureSource({
          getUrl: () => value,
          fetch: neverFetch,
        })
        expect(source.isReady()).toBe(false)
      }
    })

    it('is true when the getter yields a URL, without probing the network', () => {
      const fetchImpl = vi.fn(neverFetch)
      const source = createHttpSnapshotCaptureSource({
        getUrl: () => 'http://robot.local/snapshot.jpg',
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      })

      expect(source.isReady()).toBe(true)
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('tracks the getter, so an unconfigured host reports the not-initialized envelope', async () => {
      let url = ''
      const source = createHttpSnapshotCaptureSource({ getUrl: () => url, fetch: neverFetch })

      expect(source.isReady()).toBe(false)
      await expect(captureImageResult(source)).resolves.toBe(
        JSON.stringify({ error: 'Webcam not initialized' }),
      )

      url = 'http://robot.local/snapshot.jpg'
      expect(source.isReady()).toBe(true)
    })

    it('still returns null from captureFrame when no URL is configured', async () => {
      const fetchImpl = vi.fn(neverFetch)
      const source = createHttpSnapshotCaptureSource({
        getUrl: () => '',
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
      })

      await expect(source.captureFrame()).resolves.toBeNull()
      expect(fetchImpl).not.toHaveBeenCalled()
    })
  })
})
