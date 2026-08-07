import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  CAPTURE_IMAGE_TOOL_NAME,
  CAPTURE_IMAGE_DEFAULT_DESCRIPTION,
  frameToEnvelope,
  captureImageResult,
  createCaptureImageToolDeclaration,
  createCaptureImageClientTool,
  webcamPanelCaptureSource,
  createOnDemandCaptureSource,
  type ImageCaptureSource,
} from './captureImage'

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
