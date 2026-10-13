import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CAPTURE_CANCELLED_ERROR,
  DEFAULT_CAMERA_TOOL_CONFIG,
  MAX_COUNTDOWN_SECONDS,
  createCameraController,
  isSessionActive,
  playSafely,
  resolveCameraToolConfig,
  type CameraControllerDeps,
  type CameraSession,
  type FrameGrabber,
  type MediaDevicesLike,
  type MuteStorage,
} from './cameraController'
import { CAPTURE_IMAGE_FAILED_ERROR } from './captureImage'

/**
 * RC-35: the camera tool's configuration surface, its enable/streaming state
 * logic (D3), the countdown sequencing (D4) and the rule that a refused sound
 * never fails a capture (D4 consequence 2).
 *
 * The browser is replaced through the controller's injectable deps: a fake
 * `mediaDevices`, a fake frame grabber standing in for the streaming `<video>`
 * (jsdom has no media pipeline), and an in-memory mute store. Timers are fake,
 * so the countdown is stepped one second at a time.
 */

const FRAME = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
const SUCCESS = JSON.stringify({ mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRg==' })

function fakeStream() {
  const track = { stop: vi.fn() }
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track }
}

function memoryStorage(): MuteStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

interface Harness {
  deps: CameraControllerDeps
  getUserMedia: ReturnType<typeof vi.fn>
  enumerateDevices: ReturnType<typeof vi.fn>
  captureFrame: ReturnType<typeof vi.fn>
  closeGrabber: ReturnType<typeof vi.fn>
  beep: ReturnType<typeof vi.fn>
  shutter: ReturnType<typeof vi.fn>
  track: { stop: ReturnType<typeof vi.fn> }
  storage: ReturnType<typeof memoryStorage>
}

function harness(): Harness {
  const { stream, track } = fakeStream()
  const getUserMedia = vi.fn(() => Promise.resolve(stream))
  const enumerateDevices = vi.fn(() =>
    Promise.resolve([{ kind: 'videoinput' } as MediaDeviceInfo]),
  )
  const captureFrame = vi.fn(() => Promise.resolve<string | null>(FRAME))
  const closeGrabber = vi.fn()
  const beep = vi.fn()
  const shutter = vi.fn()
  const storage = memoryStorage()
  const devices: MediaDevicesLike = {
    getUserMedia: getUserMedia as unknown as MediaDevices['getUserMedia'],
    enumerateDevices: enumerateDevices as unknown as MediaDevices['enumerateDevices'],
  }
  return {
    deps: {
      mediaDevices: () => devices,
      createFrameGrabber: (): FrameGrabber => ({ captureFrame, close: closeGrabber }),
      sounds: { beep, shutter },
      storage: () => storage,
    },
    getUserMedia,
    enumerateDevices,
    captureFrame,
    closeGrabber,
    beep,
    shutter,
    track,
    storage,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('camera tool configuration (RC-35)', () => {
  it('states its defaults, and the default inline size is NOT collapsed (D5)', () => {
    expect(DEFAULT_CAMERA_TOOL_CONFIG).toEqual({
      permanentPreview: null,
      countdownSeconds: 3,
      renderToA2UI: false,
      sounds: true,
      inlinePreviewSize: 'full',
      toolCallLabel: 'Taking photo…',
    })
    expect(DEFAULT_CAMERA_TOOL_CONFIG.inlinePreviewSize).not.toBe('collapsed')
    expect(Object.isFrozen(DEFAULT_CAMERA_TOOL_CONFIG)).toBe(true)
  })

  it('fills an empty or partial configuration with the defaults', () => {
    expect(resolveCameraToolConfig()).toEqual(DEFAULT_CAMERA_TOOL_CONFIG)
    expect(resolveCameraToolConfig({ countdownSeconds: 0, inlinePreviewSize: 'small' })).toEqual({
      ...DEFAULT_CAMERA_TOOL_CONFIG,
      countdownSeconds: 0,
      inlinePreviewSize: 'small',
    })
  })

  it('honours every setting a host gives it', () => {
    const preview = { source: { isReady: () => true, captureFrame: () => FRAME }, blink: vi.fn() }
    expect(
      resolveCameraToolConfig({
        permanentPreview: preview,
        countdownSeconds: 5,
        renderToA2UI: true,
        sounds: false,
        inlinePreviewSize: 'collapsed',
        toolCallLabel: 'Smile!',
      }),
    ).toEqual({
      permanentPreview: preview,
      countdownSeconds: 5,
      renderToA2UI: true,
      sounds: false,
      inlinePreviewSize: 'collapsed',
      toolCallLabel: 'Smile!',
    })
  })

  it.each([
    [-2, 0],
    [2.6, 3],
    [Number.NaN, DEFAULT_CAMERA_TOOL_CONFIG.countdownSeconds],
    [999, MAX_COUNTDOWN_SECONDS],
  ])('sanitises a countdown of %s to %s', (input, expected) => {
    expect(resolveCameraToolConfig({ countdownSeconds: input }).countdownSeconds).toBe(expected)
  })

  it('falls back on an unknown size and a blank label', () => {
    const resolved = resolveCameraToolConfig({
      inlinePreviewSize: 'huge' as never,
      toolCallLabel: '   ',
    })
    expect(resolved.inlinePreviewSize).toBe('full')
    expect(resolved.toolCallLabel).toBe('Taking photo…')
  })

  it('exposes the resolved configuration on the controller', () => {
    const camera = createCameraController({ countdownSeconds: 0 })
    expect(camera.config.countdownSeconds).toBe(0)
    expect(camera.config.inlinePreviewSize).toBe('full')
  })
})

describe('enable / streaming state (D3: allowed and streaming are separate)', () => {
  it('no camera API at all: unavailable, never streams, the not-initialized envelope', async () => {
    const camera = createCameraController({}, { ...harness().deps, mediaDevices: () => undefined })
    const result = await camera.capture('tc-1')
    expect(result).toBe(JSON.stringify({ error: 'Webcam not initialized' }))
    const s = camera.session('tc-1')!
    expect(s.phase).toBe('unavailable')
    expect(s.access).toBe('unavailable')
    expect(s.streaming).toBe(false)
  })

  it('no video device listed: unavailable without ever asking for permission', async () => {
    const h = harness()
    h.enumerateDevices.mockResolvedValue([{ kind: 'audioinput' }])
    const camera = createCameraController({}, h.deps)
    const result = await camera.capture('tc-1')
    expect(JSON.parse(result)).toEqual({
      error: 'Failed to capture frame. No camera device was found.',
    })
    expect(h.getUserMedia).not.toHaveBeenCalled()
    expect(camera.session('tc-1')!.phase).toBe('unavailable')
  })

  it('permission refused at the native prompt: unavailable, and the turn got the named cause', async () => {
    const h = harness()
    h.getUserMedia.mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    const camera = createCameraController({}, h.deps)
    const result = await camera.capture('tc-1')
    expect(JSON.parse(result)).toEqual({
      error: 'Failed to capture frame. Camera permission was denied.',
    })
    const s = camera.session('tc-1')!
    expect(s.phase).toBe('unavailable')
    expect(s.access).toBe('unavailable')
    expect(s.streaming).toBe(false)
  })

  it('waits on the permission prompt: no countdown until getUserMedia settles (D2)', async () => {
    const h = harness()
    let grant!: (s: MediaStream) => void
    h.getUserMedia.mockReturnValue(new Promise<MediaStream>((r) => (grant = r)))
    const camera = createCameraController({ countdownSeconds: 1 }, h.deps)
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(5_000)
    const s = camera.session('tc-1')!
    expect(s.phase).toBe('requesting')
    expect(s.access).toBe('unknown')
    expect(h.beep).not.toHaveBeenCalled()
    grant(fakeStream().stream)
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(pending).resolves.toBe(SUCCESS)
  })

  it('granted: streams through the countdown, then stops streaming while access stays granted', async () => {
    const h = harness()
    const camera = createCameraController({ countdownSeconds: 2 }, h.deps)
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(0)
    const s = camera.session('tc-1')!
    expect(s.phase).toBe('countdown')
    expect(s.access).toBe('granted')
    expect(s.streaming).toBe(true)
    expect(s.stream).not.toBeNull()
    expect(isSessionActive(s)).toBe(true)

    await vi.advanceTimersByTimeAsync(2_000)
    await expect(pending).resolves.toBe(SUCCESS)
    expect(s.phase).toBe('done')
    expect(s.access).toBe('granted') // allowed…
    expect(s.streaming).toBe(false) // …and not streaming: two states, not one
    expect(s.stream).toBeNull()
    expect(s.photoSrc).toBe(FRAME)
    expect(h.track.stop).toHaveBeenCalled()
    expect(h.closeGrabber).toHaveBeenCalled()
    expect(isSessionActive(s)).toBe(false)
  })

  it('captures from the stream opened for the countdown, not a second camera open', async () => {
    const h = harness()
    const camera = createCameraController({ countdownSeconds: 1 }, h.deps)
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(1_000)
    await pending
    expect(h.getUserMedia).toHaveBeenCalledTimes(1)
    expect(h.captureFrame).toHaveBeenCalledTimes(1)
    expect(h.captureFrame).toHaveBeenCalledWith({ warm: true })
  })

  it('a camera that opens but yields no frame fails with the frozen message', async () => {
    const h = harness()
    h.captureFrame.mockResolvedValue(null)
    const camera = createCameraController({ countdownSeconds: 0 }, h.deps)
    const result = await camera.capture('tc-1')
    expect(result).toBe(JSON.stringify({ error: CAPTURE_IMAGE_FAILED_ERROR }))
    expect(camera.session('tc-1')!.phase).toBe('failed')
    expect(h.track.stop).toHaveBeenCalled()
  })

  it('a stopped run cancels the countdown and releases the camera', async () => {
    const h = harness()
    const camera = createCameraController({ countdownSeconds: 3 }, h.deps)
    const abort = new AbortController()
    const pending = camera.capture('tc-1', abort.signal)
    await vi.advanceTimersByTimeAsync(1_000)
    abort.abort()
    const result = await pending
    expect(result).toBe(JSON.stringify({ error: CAPTURE_CANCELLED_ERROR }))
    const s = camera.session('tc-1')!
    expect(s.phase).toBe('cancelled')
    expect(s.streaming).toBe(false)
    expect(h.track.stop).toHaveBeenCalled()
    expect(h.captureFrame).not.toHaveBeenCalled()
  })

  it('keys sessions by tool-call id, tracks the latest, and forgets them on clear', async () => {
    const h = harness()
    const camera = createCameraController({ countdownSeconds: 0 }, h.deps)
    await camera.capture('tc-1')
    await camera.capture('tc-2')
    expect(camera.session('tc-1')?.id).toBe('tc-1')
    expect(camera.latestSession.value?.id).toBe('tc-2')
    camera.clear()
    expect(camera.session('tc-1')).toBeUndefined()
    expect(camera.latestSession.value).toBeNull()
  })

  it('generates an id when the handler context carries none', async () => {
    const camera = createCameraController({ countdownSeconds: 0 }, harness().deps)
    await camera.capture()
    expect(camera.latestSession.value?.id).toMatch(/^camera-capture-\d+$/)
  })
})

describe('countdown sequencing (D4)', () => {
  it('shows 3 — 2 — 1 — 📷 a second apart, beeping on each number, then the shutter', async () => {
    const h = harness()
    const camera = createCameraController({ countdownSeconds: 3 }, h.deps)
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(0)
    const s = camera.session('tc-1') as CameraSession
    const seen = () => ({ n: s.countdown, said: s.announcement, beeps: h.beep.mock.calls.length })

    expect(seen()).toEqual({ n: 3, said: '3', beeps: 1 })
    await vi.advanceTimersByTimeAsync(999)
    expect(seen()).toEqual({ n: 3, said: '3', beeps: 1 })
    await vi.advanceTimersByTimeAsync(1)
    expect(seen()).toEqual({ n: 2, said: '2', beeps: 2 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(seen()).toEqual({ n: 1, said: '1', beeps: 3 })
    expect(h.shutter).not.toHaveBeenCalled()
    expect(h.captureFrame).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    await pending
    expect(h.beep).toHaveBeenCalledTimes(3)
    expect(h.shutter).toHaveBeenCalledTimes(1)
    expect(h.captureFrame).toHaveBeenCalledTimes(1)
    // The shutter comes after the last beep.
    expect(h.shutter.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.beep.mock.invocationCallOrder[2],
    )
    expect(s.announcement).toBe('Photo taken')
  })

  it('blinks at the shutter and stops blinking shortly after', async () => {
    const h = harness()
    let grabbed!: (f: string) => void
    h.captureFrame.mockReturnValue(new Promise<string>((r) => (grabbed = r)))
    const camera = createCameraController({ countdownSeconds: 0 }, { ...h.deps, flashMs: 200 })
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(0)
    const s = camera.session('tc-1')!
    expect(s.flash).toBe(true)
    expect(s.phase).toBe('loading') // "Loading your photo" while the frame lands
    expect(s.countdown).toBe(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(s.flash).toBe(false)
    grabbed(FRAME)
    await pending
  })

  it('countdown 0 turns it off: no beeps, an immediate shutter, a cold-sensor capture', async () => {
    const h = harness()
    const camera = createCameraController({ countdownSeconds: 0 }, h.deps)
    await expect(camera.capture('tc-1')).resolves.toBe(SUCCESS)
    expect(h.beep).not.toHaveBeenCalled()
    expect(h.shutter).toHaveBeenCalledTimes(1)
    expect(h.captureFrame).toHaveBeenCalledWith({ warm: false })
  })
})

describe('sounds never fail a capture (D4 consequence 2)', () => {
  it('a beep that throws and a shutter that rejects still yield the photo', async () => {
    const h = harness()
    h.beep.mockImplementation(() => {
      throw new DOMException('autoplay', 'NotAllowedError')
    })
    h.shutter.mockRejectedValue(new DOMException('autoplay', 'NotAllowedError'))
    const camera = createCameraController({ countdownSeconds: 2 }, h.deps)
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(pending).resolves.toBe(SUCCESS)
    expect(h.beep).toHaveBeenCalledTimes(2)
    expect(h.shutter).toHaveBeenCalledTimes(1)
    expect(camera.session('tc-1')!.phase).toBe('done')
  })

  it('playSafely swallows a synchronous throw and an async rejection', async () => {
    expect(() =>
      playSafely(() => {
        throw new Error('no audio')
      }),
    ).not.toThrow()
    const rejected = Promise.reject(new Error('play() refused'))
    playSafely(() => rejected)
    await vi.advanceTimersByTimeAsync(0)
    expect(console.warn).toHaveBeenCalledTimes(2)
  })

  it('the user mute silences the countdown and shutter, and is remembered', async () => {
    const h = harness()
    const camera = createCameraController({ countdownSeconds: 1 }, h.deps)
    expect(camera.muted.value).toBe(false)
    camera.setMuted(true)
    expect(h.storage.data.get('pk-camera-sounds-muted')).toBe('true')
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(1_000)
    await pending
    expect(h.beep).not.toHaveBeenCalled()
    expect(h.shutter).not.toHaveBeenCalled()
    // A fresh controller on the same storage starts muted.
    expect(createCameraController({}, h.deps).muted.value).toBe(true)
  })

  it('a storage that throws leaves the mute working for this page', () => {
    const h = harness()
    const throwing: MuteStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const camera = createCameraController({}, { ...h.deps, storage: () => throwing })
    expect(camera.muted.value).toBe(false)
    camera.setMuted(true)
    expect(camera.muted.value).toBe(true)
  })

  it('sounds: false plays nothing at all', async () => {
    const h = harness()
    const camera = createCameraController({ countdownSeconds: 1, sounds: false }, h.deps)
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(1_000)
    await pending
    expect(h.beep).not.toHaveBeenCalled()
    expect(h.shutter).not.toHaveBeenCalled()
  })
})

describe('permanent preview (a host-owned, always-on view)', () => {
  it('captures from the host source, blinks the host view, and never opens a camera itself', async () => {
    const h = harness()
    const blink = vi.fn()
    const source = { isReady: () => true, captureFrame: vi.fn(() => FRAME) }
    const camera = createCameraController(
      { countdownSeconds: 1, permanentPreview: { source, blink } },
      h.deps,
    )
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(0)
    const s = camera.session('tc-1')!
    expect(s.permanent).toBe(true)
    expect(s.streaming).toBe(false) // no transient in-Chat stream
    expect(blink).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(pending).resolves.toBe(SUCCESS)
    expect(blink).toHaveBeenCalledTimes(1)
    expect(source.captureFrame).toHaveBeenCalledTimes(1)
    expect(h.getUserMedia).not.toHaveBeenCalled()
    expect(s.photoSrc).toBe(FRAME)
  })

  it('a host source that is not ready is the no-camera case', async () => {
    const source = { isReady: () => false, captureFrame: vi.fn(() => null) }
    const camera = createCameraController({ permanentPreview: { source } }, harness().deps)
    const result = await camera.capture('tc-1')
    expect(result).toBe(JSON.stringify({ error: 'Webcam not initialized' }))
    expect(camera.session('tc-1')!.phase).toBe('unavailable')
  })
})
