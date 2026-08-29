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
  DEFAULT_HTTP_SNAPSHOT_TIMEOUT_MS,
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

  function imageResponse(bytes: Uint8Array, contentType: string | null = 'image/jpeg') {
    // A fresh ArrayBuffer copy: Response wants a BodyInit, not a typed-array view.
    return new Response(bytes.slice().buffer as ArrayBuffer, {
      status: 200,
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

  it('GETs the URL with an abort signal and a default timeout', async () => {
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
    expect(DEFAULT_HTTP_SNAPSHOT_TIMEOUT_MS).toBeGreaterThan(0)
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

    it('on a non-2xx response (404)', async () => {
      await expectFailure(
        createHttpSnapshotCaptureSource({
          getUrl: () => 'http://robot.local/snapshot.jpg',
          fetch: (async () =>
            new Response('not found', { status: 404 })) as unknown as typeof globalThis.fetch,
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
