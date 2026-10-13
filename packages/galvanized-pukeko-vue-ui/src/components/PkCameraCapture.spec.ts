import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import PkCameraCapture from './PkCameraCapture.vue'
import ToolCallBadge from './ToolCallBadge.vue'
import { registerCaptureImageToolDisplay } from './toolDisplays'
import { registerToolDisplay, resetToolDisplays } from './toolDisplay'
import {
  CAMERA_UNAVAILABLE_MESSAGE,
  createCameraController,
  type CameraControllerDeps,
  type CameraToolConfig,
} from '../services/cameraController'
import type { ToolCallPart } from '../services/chatService'

/**
 * RC-35: the camera tool's in-Chat element. Covers D5 (the photo is shown,
 * uncollapsed, by default — and the registry renders it outside the collapsed
 * ToolCallBadge while every other tool keeps the badge), the configured sizes,
 * the plain no-camera message, and the live view / countdown / mute / loader
 * while a capture runs.
 */

const B64 = '/9j/4AAQSkZJRg=='
const FRAME = `data:image/jpeg;base64,${B64}`
const PHOTO = JSON.stringify({ mimeType: 'image/jpeg', data: B64 })

/** A controller whose capture can be held mid-countdown and stepped. */
function controller(config: Partial<CameraToolConfig> = {}, extra: CameraControllerDeps = {}) {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  let grabbed!: (f: string | null) => void
  const captureFrame = vi.fn(() => new Promise<string | null>((r) => (grabbed = r)))
  const camera = createCameraController(config, {
    mediaDevices: () => ({
      getUserMedia: (() => Promise.resolve(stream)) as unknown as MediaDevices['getUserMedia'],
    }),
    createFrameGrabber: () => ({ captureFrame, close: vi.fn() }),
    sounds: { beep: vi.fn(), shutter: vi.fn() },
    storage: () => undefined,
    ...extra,
  })
  return { camera, release: (f: string | null = FRAME) => grabbed(f) }
}

function part(result?: string, status: 'pending' | 'complete' = result ? 'complete' : 'pending') {
  return {
    kind: 'tool-call',
    toolCallId: 'tc-1',
    toolCallName: 'capture_image',
    args: {},
    argsRaw: '{}',
    result,
    status,
  } as ToolCallPart
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  resetToolDisplays()
})

describe('PkCameraCapture — the photo (D5)', () => {
  it('shows the photo inline and uncollapsed by default, at full size', () => {
    const wrapper = mount(PkCameraCapture, { props: { toolCallId: 'tc-1', result: PHOTO } })
    const img = wrapper.get('[data-testid="pk-camera-photo"]')
    expect(img.attributes('src')).toBe(FRAME)
    expect(img.classes()).toContain('size-full')
    expect(wrapper.find('details').exists()).toBe(false)
  })

  it('draws the photo small when the host configures `small`', () => {
    const { camera } = controller({ inlinePreviewSize: 'small' })
    const wrapper = mount(PkCameraCapture, { props: { toolCallId: 'tc-1', result: PHOTO, camera } })
    expect(wrapper.get('[data-testid="pk-camera-photo"]').classes()).toContain('size-small')
  })

  it('folds the photo behind a disclosure only when the host chooses `collapsed`', () => {
    const { camera } = controller({ inlinePreviewSize: 'collapsed' })
    const wrapper = mount(PkCameraCapture, { props: { toolCallId: 'tc-1', result: PHOTO, camera } })
    expect(wrapper.find('[data-testid="pk-camera-photo"]').exists()).toBe(false)
    const details = wrapper.get('details.pk-camera-photo-collapsed')
    expect(details.attributes('open')).toBeUndefined()
    expect(details.get('img').attributes('src')).toBe(FRAME)
  })

  it('the A2UI-pane copy always shows the photo whole, with no indicator or live region', () => {
    const { camera } = controller({ inlinePreviewSize: 'collapsed' })
    const wrapper = mount(PkCameraCapture, {
      props: { toolCallId: 'tc-1', result: PHOTO, camera, placement: 'panel' },
    })
    expect(wrapper.get('[data-testid="pk-camera-photo"]').classes()).toContain('size-full')
    expect(wrapper.find('[data-testid="pk-camera-label"]').exists()).toBe(false)
    expect(wrapper.find('[aria-live]').exists()).toBe(false)
  })
})

describe('PkCameraCapture — no camera', () => {
  it('an error envelope shows the plain explanatory message, not an error artefact', () => {
    const wrapper = mount(PkCameraCapture, {
      props: { toolCallId: 'tc-1', result: JSON.stringify({ error: 'Webcam not initialized' }) },
    })
    const message = wrapper.get('[data-testid="pk-camera-unavailable"]')
    expect(message.text()).toBe(CAMERA_UNAVAILABLE_MESSAGE)
    expect(message.text()).toContain("we can't access the camera on this device")
    expect(wrapper.text()).not.toContain('⚠')
    expect(wrapper.find('[data-testid="pk-capture-error"]').exists()).toBe(false)
    // The technical cause is still reachable, folded away.
    expect(wrapper.get('details.pk-camera-detail').text()).toContain('Webcam not initialized')
    expect(wrapper.get('[data-testid="pk-camera-label"]').text()).toBe('Camera unavailable')
  })

  it('a live session that found no camera shows the same message before the result lands', async () => {
    const { camera } = controller({}, { mediaDevices: () => undefined })
    await camera.capture('tc-1')
    const wrapper = mount(PkCameraCapture, { props: { toolCallId: 'tc-1', camera } })
    expect(wrapper.get('[data-testid="pk-camera-unavailable"]').text()).toBe(
      CAMERA_UNAVAILABLE_MESSAGE,
    )
  })
})

describe('PkCameraCapture — while the capture runs', () => {
  it('shows the label, the live stream, the countdown and its announcement', async () => {
    const { camera, release } = controller({ countdownSeconds: 3, toolCallLabel: 'Say cheese…' })
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(0)
    const wrapper = mount(PkCameraCapture, { props: { toolCallId: 'tc-1', camera } })

    expect(wrapper.get('[data-testid="pk-camera-label"]').text()).toBe('Say cheese…')
    expect(wrapper.find('[data-testid="pk-camera-stream"] video').exists()).toBe(true)
    const steps = wrapper.findAll('[data-testid="pk-camera-countdown"] li')
    expect(steps.map((li) => li.text())).toEqual(['3', '2', '1', '📷'])
    expect(steps[0].classes()).toContain('current')
    const live = wrapper.get('[data-testid="pk-camera-announcement"]')
    expect(live.attributes('aria-live')).toBe('polite')
    expect(live.attributes('role')).toBe('status')
    expect(live.text()).toBe('3')

    await vi.advanceTimersByTimeAsync(1_000)
    await nextTick()
    expect(wrapper.findAll('[data-testid="pk-camera-countdown"] li')[1].classes()).toContain(
      'current',
    )
    expect(live.text()).toBe('2')

    // Past the shutter: the frame is still landing → the loader.
    await vi.advanceTimersByTimeAsync(2_000)
    await nextTick()
    expect(wrapper.get('[data-testid="pk-camera-loading"]').text()).toBe('Loading your photo')
    expect(wrapper.findAll('[data-testid="pk-camera-countdown"] li')[3].classes()).toContain(
      'current',
    )

    // The frame lands: the stream disappears and the photo shows.
    release()
    await pending
    await nextTick()
    expect(wrapper.find('[data-testid="pk-camera-stream"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pk-camera-loading"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="pk-camera-photo"]').attributes('src')).toBe(FRAME)
  })

  it('offers a mute while sounds are on, and it flips the controller', async () => {
    const { camera, release } = controller({ countdownSeconds: 2 })
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(0)
    const wrapper = mount(PkCameraCapture, { props: { toolCallId: 'tc-1', camera } })
    const mute = wrapper.get('[data-testid="pk-camera-mute"]')
    expect(mute.attributes('aria-pressed')).toBe('false')
    await mute.trigger('click')
    expect(camera.muted.value).toBe(true)
    expect(wrapper.get('[data-testid="pk-camera-mute"]').attributes('aria-pressed')).toBe('true')
    await vi.advanceTimersByTimeAsync(2_000)
    release()
    await pending
  })

  it('offers no mute when the host turned sounds off', async () => {
    const { camera, release } = controller({ countdownSeconds: 1, sounds: false })
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(0)
    const wrapper = mount(PkCameraCapture, { props: { toolCallId: 'tc-1', camera } })
    expect(wrapper.find('[data-testid="pk-camera-mute"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    release()
    await pending
  })

  it('a permanent preview shows the countdown but no transient stream', async () => {
    const source = { isReady: () => true, captureFrame: () => FRAME }
    const { camera } = controller({ countdownSeconds: 1, permanentPreview: { source } })
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(0)
    const wrapper = mount(PkCameraCapture, { props: { toolCallId: 'tc-1', camera } })
    expect(wrapper.find('[data-testid="pk-camera-countdown"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pk-camera-stream"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    await pending
  })

  it('the countdown and the whole element use info tokens, never the danger family (D4, DL-8)', () => {
    const source = readFileSync(`${import.meta.dirname}/PkCameraCapture.vue`, 'utf8')
    expect(source).not.toMatch(/--pk-color-danger/)
    const countdownRule = source.match(/\.pk-camera-countdown li \{([^}]*)\}/)?.[1] ?? ''
    expect(countdownRule).toContain('var(--pk-color-info-surface')
    expect(countdownRule).toContain('var(--pk-color-info-border')
    expect(countdownRule).toContain('var(--pk-color-info-text')
  })

  it('sits in the message flow: nothing in it is fixed to the viewport (D1)', async () => {
    const { camera, release } = controller({ countdownSeconds: 1 })
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(0)
    const wrapper = mount(PkCameraCapture, { props: { toolCallId: 'tc-1', camera } })
    expect(wrapper.html()).not.toMatch(/position:\s*fixed/)
    await vi.advanceTimersByTimeAsync(1_000)
    release()
    await pending
  })
})

describe('registry rendering — D5 non-collapse without regressing other tools', () => {
  it('capture_image renders its own element, photo visible with no click', () => {
    registerCaptureImageToolDisplay()
    const wrapper = mount(ToolCallBadge, { props: { part: part(PHOTO) } })
    expect(wrapper.find('.tool-call-badge').exists()).toBe(false)
    expect(wrapper.get('[data-testid="pk-camera-photo"]').attributes('src')).toBe(FRAME)
  })

  it('capture_image shows its in-progress label from the moment the call starts', () => {
    const { camera } = controller({ toolCallLabel: 'Taking photo…' })
    registerCaptureImageToolDisplay({ camera })
    const wrapper = mount(ToolCallBadge, { props: { part: part() } })
    expect(wrapper.get('[data-testid="pk-camera-label"]').text()).toBe('Taking photo…')
  })

  it('a call that completed with no result and no live session is over, not "Taking photo…"', () => {
    const { camera } = controller()
    registerCaptureImageToolDisplay({ camera })
    const wrapper = mount(ToolCallBadge, { props: { part: part(undefined, 'complete') } })
    expect(wrapper.get('[data-testid="pk-camera-label"]').text()).toBe('Photo not taken')
    expect(wrapper.find('[data-testid="pk-camera-ended"]').exists()).toBe(true)
    expect(wrapper.find('.pk-camera-dot').exists()).toBe(false)
  })

  it('a complete status does not override a session that is still running', async () => {
    const { camera, release } = controller({ countdownSeconds: 1 })
    const pending = camera.capture('tc-1')
    await vi.advanceTimersByTimeAsync(0)
    const wrapper = mount(PkCameraCapture, {
      props: { toolCallId: 'tc-1', camera, status: 'complete' },
    })
    expect(wrapper.get('[data-testid="pk-camera-label"]').text()).toBe('Taking photo…')
    expect(wrapper.find('.pk-camera-dot').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    release()
    await pending
  })

  it('accepts the original string signature for a renamed tool', () => {
    registerCaptureImageToolDisplay('take_photo')
    const wrapper = mount(ToolCallBadge, {
      props: { part: { ...part(PHOTO), toolCallName: 'take_photo' } as ToolCallPart },
    })
    expect(wrapper.find('[data-testid="pk-camera-photo"]').exists()).toBe(true)
  })

  it('any other tool keeps the collapsed badge (DL-2)', () => {
    registerCaptureImageToolDisplay()
    registerToolDisplay('other_tool', { glyph: '🔧' })
    const wrapper = mount(ToolCallBadge, {
      props: { part: { ...part('{"ok":true}'), toolCallName: 'other_tool' } as ToolCallPart },
    })
    expect(wrapper.find('.tool-call-badge').exists()).toBe(true)
    expect(wrapper.find('.tool-call-body').exists()).toBe(false)
  })
})
