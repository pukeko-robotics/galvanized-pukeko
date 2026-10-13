import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import PkWebcamPanel from './PkWebcamPanel.vue'
import { webcamPanelPermanentPreview } from '../services/cameraController'

/**
 * RC-35: a host wiring its always-on `PkWebcamPanel` as the camera tool's
 * permanent preview gets a shutter acknowledgement through the panel's exposed
 * `blink()` — a brief flash on the view, nothing else.
 */
beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(() => new Promise<MediaStream>(() => {})) },
  })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

describe('PkWebcamPanel.blink (RC-35)', () => {
  it('flashes the view briefly', async () => {
    const wrapper = mount(PkWebcamPanel)
    await flushPromises()
    const view = () => wrapper.get('[data-testid="pk-webcam-view"]')
    expect(view().classes()).not.toContain('blinking')
    ;(wrapper.vm as unknown as { blink: () => void }).blink()
    await nextTick()
    expect(view().classes()).toContain('blinking')
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(view().classes()).not.toContain('blinking')
  })

  it('webcamPanelPermanentPreview blinks the panel and reads frames from it', () => {
    const panel = { captureFrame: vi.fn(() => 'data:image/jpeg;base64,AA=='), blink: vi.fn() }
    const preview = webcamPanelPermanentPreview(() => panel)
    preview.blink?.()
    expect(panel.blink).toHaveBeenCalledTimes(1)
    expect(preview.source.isReady()).toBe(true)
    expect(preview.source.captureFrame()).toBe('data:image/jpeg;base64,AA==')
    // No panel mounted yet: nothing to blink, and the source is not ready.
    const empty = webcamPanelPermanentPreview(() => null)
    expect(() => empty.blink?.()).not.toThrow()
    expect(empty.source.isReady()).toBe(false)
  })
})
