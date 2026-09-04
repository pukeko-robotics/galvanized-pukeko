import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import PkWebcamPanel from './PkWebcamPanel.vue'

/**
 * RC-45: the compositing canvas must not die with the camera.
 *
 * `composeBeforeAfter` draws two supplied data URLs onto a hidden canvas. It never
 * reads the camera stream and never checks `isActive` — but the canvas used to live
 * inside the `v-else` of the `v-if="error"` branch, so a rejected `getUserMedia`
 * removed it from the DOM and `composeBeforeAfter` returned null at its first line.
 * That broke motion before/after composites for the simulated, no-hardware world
 * (RC-5), which is precisely the case the feature exists for.
 *
 * These cells pin the canvas's independence from camera state in BOTH camera-less
 * states — rejected and never-settling — while pinning that the error banner and
 * `captureFrame`'s active-camera guard are untouched.
 *
 * ## jsdom stubbing, and why it is needed
 * jsdom implements neither a 2D canvas context nor image decoding. Left alone,
 * `loadImage` would await an `onload` that never fires and the cell would HANG
 * rather than fail. So `HTMLImageElement`'s `src`/`width`/`height` and
 * `HTMLCanvasElement`'s `getContext`/`toDataURL` are patched on the prototypes and
 * restored after every test.
 */

/** The two frames handed to `composeBeforeAfter`. Only their identity matters. */
const BEFORE_URL = 'data:image/jpeg;base64,QkVGT1JF'
const AFTER_URL = 'data:image/jpeg;base64,QUZURVI='

/**
 * Deliberately DIFFERENT aspect ratios, so the two scaled widths differ (640 vs
 * 720 below). Equal widths would let a before/after mix-up pass unnoticed.
 */
const IMAGE_SIZES = new Map<string, { width: number; height: number }>([
  [BEFORE_URL, { width: 640, height: 480 }],
  [AFTER_URL, { width: 300, height: 200 }],
])

/** What the stubbed `toDataURL` hands back, standing in for the encoded composite. */
const COMPOSITE_DATA_URL = 'data:image/jpeg;base64,Q09NUE9TSVRF'

// The component's own layout constants, restated so the expectations below are
// derived here rather than copied out of the component's output.
const PAD = 8
const GAP = 12
const LABEL_H = 28

// targetH = max(480, 200) = 480; before scales by 1, after by 480/200 = 2.4.
const TARGET_H = 480
const EXPECTED_W_BEFORE = 640 // round(640 * 1)
const EXPECTED_W_AFTER = 720 // round(300 * 2.4)
const EXPECTED_TOTAL_W = PAD + EXPECTED_W_BEFORE + GAP + EXPECTED_W_AFTER + PAD // 1388
const EXPECTED_TOTAL_H = LABEL_H + TARGET_H + PAD // 516

/** The exposed surface of the component under test (`defineExpose`). */
interface WebcamPanelExposed {
  captureFrame: () => string | null
  composeBeforeAfter: (before: string, after: string) => Promise<string | null>
  startCamera: () => Promise<void>
  stopCamera: () => void
}

function exposed(wrapper: VueWrapper): WebcamPanelExposed {
  return wrapper.vm as unknown as WebcamPanelExposed
}

/** Undo callbacks for every prototype patch made during a test. */
const restores: Array<() => void> = []

afterEach(() => {
  while (restores.length) restores.pop()!()
})

function patch(proto: object, key: string, descriptor: PropertyDescriptor): void {
  const original = Object.getOwnPropertyDescriptor(proto, key)
  Object.defineProperty(proto, key, { configurable: true, ...descriptor })
  restores.push(() => {
    if (original) Object.defineProperty(proto, key, original)
    else delete (proto as Record<string, unknown>)[key]
  })
}

/** A 2D context stub whose draw calls are recorded; one shared instance per test. */
interface CtxStub {
  fillRect: ReturnType<typeof vi.fn>
  fillText: ReturnType<typeof vi.fn>
  drawImage: ReturnType<typeof vi.fn>
  fillStyle: string
  font: string
  textBaseline: string
  textAlign: string
}

/**
 * Patch the canvas + image DOM surfaces `composeBeforeAfter` depends on.
 * Returns the shared context stub so a test can inspect the actual draw calls.
 */
function stubDrawingDom(): CtxStub {
  const ctx: CtxStub = {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '',
    font: '',
    textBaseline: '',
    textAlign: '',
  }

  patch(HTMLCanvasElement.prototype, 'getContext', { value: () => ctx, writable: true })
  patch(HTMLCanvasElement.prototype, 'toDataURL', {
    value: () => COMPOSITE_DATA_URL,
    writable: true,
  })

  // jsdom never decodes an image, so `onload` would never fire and `loadImage`
  // would hang forever. Fire it from the `src` setter instead; `loadImage`
  // assigns `onload` BEFORE `src`, so the handler is always already in place.
  const srcOf = new WeakMap<HTMLImageElement, string>()
  patch(HTMLImageElement.prototype, 'src', {
    get(this: HTMLImageElement) {
      return srcOf.get(this) ?? ''
    },
    set(this: HTMLImageElement, value: string) {
      srcOf.set(this, value)
      queueMicrotask(() => {
        if (IMAGE_SIZES.has(value)) this.onload?.call(this, new Event('load'))
        else this.onerror?.call(this, new Event('error'))
      })
    },
  })
  const dimension = (img: HTMLImageElement, axis: 'width' | 'height') =>
    IMAGE_SIZES.get(srcOf.get(img) ?? '')?.[axis] ?? 0
  patch(HTMLImageElement.prototype, 'width', {
    get(this: HTMLImageElement) {
      return dimension(this, 'width')
    },
  })
  patch(HTMLImageElement.prototype, 'height', {
    get(this: HTMLImageElement) {
      return dimension(this, 'height')
    },
  })

  return ctx
}

/** Install a `navigator.mediaDevices.getUserMedia` stub, restored after the test. */
function stubGetUserMedia(impl: () => Promise<MediaStream>) {
  const getUserMedia = vi.fn(impl)
  const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
  restores.push(() => {
    if (original) Object.defineProperty(navigator, 'mediaDevices', original)
    else delete (navigator as unknown as Record<string, unknown>).mediaDevices
  })
  return getUserMedia
}

/**
 * Assert a composite was actually drawn onto the COMPONENT'S canvas — not merely
 * that some truthy string came back. The geometry is what pins the identity: a
 * detached `document.createElement('canvas')` would still yield the stubbed data
 * URL, but only the mounted element carries these dimensions.
 */
function expectCompositeDrawnOn(canvas: HTMLCanvasElement, ctx: CtxStub): void {
  expect(canvas.width).toBe(EXPECTED_TOTAL_W)
  expect(canvas.height).toBe(EXPECTED_TOTAL_H)

  expect(ctx.drawImage).toHaveBeenCalledTimes(2)
  // Before at the left padding; after one gap further right, both label-height down.
  expect(ctx.drawImage).toHaveBeenNthCalledWith(
    1,
    expect.anything(),
    PAD,
    LABEL_H,
    EXPECTED_W_BEFORE,
    TARGET_H,
  )
  expect(ctx.drawImage).toHaveBeenNthCalledWith(
    2,
    expect.anything(),
    PAD + EXPECTED_W_BEFORE + GAP,
    LABEL_H,
    EXPECTED_W_AFTER,
    TARGET_H,
  )
}

describe('PkWebcamPanel — the compositing canvas is independent of the camera (RC-45)', () => {
  describe('camera rejected (denied permission, no device, device busy)', () => {
    /** Mount with `getUserMedia` rejecting, and let the rejection land. */
    async function mountWithRejectedCamera(message = 'Requested device not found') {
      const ctx = stubDrawingDom()
      const getUserMedia = stubGetUserMedia(() => Promise.reject(new Error(message)))
      const wrapper = mount(PkWebcamPanel)
      await flushPromises()
      return { wrapper, ctx, getUserMedia }
    }

    it('keeps the hidden compositing canvas mounted even though the camera view is gone', async () => {
      const { wrapper } = await mountWithRejectedCamera()

      // The camera view really is gone — otherwise this cell proves nothing.
      expect(wrapper.find('.webcam-view').exists()).toBe(false)
      expect(wrapper.find('video').exists()).toBe(false)
      expect(wrapper.find('.webcam-error').exists()).toBe(true)

      // ...and the offscreen drawing surface survived it.
      expect(wrapper.find('canvas').exists()).toBe(true)
    })

    it('composes a before/after image anyway — the regression this node exists for', async () => {
      const { wrapper, ctx } = await mountWithRejectedCamera()

      const composite = await exposed(wrapper).composeBeforeAfter(BEFORE_URL, AFTER_URL)

      expect(composite).toBe(COMPOSITE_DATA_URL)
      expectCompositeDrawnOn(wrapper.find('canvas').element, ctx)
    })

    it('still shows the error message and a working Retry button', async () => {
      const { wrapper, getUserMedia } = await mountWithRejectedCamera('Permission denied')

      expect(wrapper.find('.webcam-error p').text()).toBe('Permission denied')
      const retry = wrapper.find('.webcam-error button')
      expect(retry.text()).toBe('Retry')

      expect(getUserMedia).toHaveBeenCalledTimes(1)
      await retry.trigger('click')
      expect(getUserMedia).toHaveBeenCalledTimes(2)
      await flushPromises()
    })

    it('still refuses to capture a frame: there is no video element to draw from', async () => {
      const { wrapper } = await mountWithRejectedCamera()

      // The canvas now exists in this state, so this is a real test of the
      // `!videoRef.value` clause rather than a null canvas standing in for it.
      expect(wrapper.find('canvas').exists()).toBe(true)
      expect(exposed(wrapper).captureFrame()).toBeNull()
    })
  })

  describe('no camera and no error at all — the pure simulated path (RC-5)', () => {
    /**
     * `getUserMedia` is called once by `onMounted` and never settles, so no camera
     * ever opens, `isActive` stays false and `error` stays null. This is the
     * closest reachable state to "no camera involved at any point": the component
     * auto-starts on mount, so zero calls is unreachable without an error.
     */
    async function mountWithPendingCamera() {
      const ctx = stubDrawingDom()
      const getUserMedia = stubGetUserMedia(() => new Promise<MediaStream>(() => {}))
      const wrapper = mount(PkWebcamPanel)
      await flushPromises()
      return { wrapper, ctx, getUserMedia }
    }

    it('composes a before/after image with no camera ever having opened', async () => {
      const { wrapper, ctx } = await mountWithPendingCamera()

      // Neither active nor errored: the simulated world's steady state.
      expect(wrapper.find('.webcam-error').exists()).toBe(false)
      expect(wrapper.find('.webcam-loading').exists()).toBe(true)

      const composite = await exposed(wrapper).composeBeforeAfter(BEFORE_URL, AFTER_URL)

      expect(composite).toBe(COMPOSITE_DATA_URL)
      expectCompositeDrawnOn(wrapper.find('canvas').element, ctx)
    })

    it('still refuses to capture a frame while the camera is not active', async () => {
      const { wrapper } = await mountWithPendingCamera()

      // Both elements are bound here, so only `isActive` can refuse the capture.
      expect(wrapper.find('video').exists()).toBe(true)
      expect(wrapper.find('canvas').exists()).toBe(true)
      expect(exposed(wrapper).captureFrame()).toBeNull()
    })
  })
})
