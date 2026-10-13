import { describe, it, expect, expectTypeOf, vi, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { proxyRefs } from 'vue'
import PkWebcamPanel from './PkWebcamPanel.vue'
import type { WebcamStatus, WebcamError } from '../services/webcamStatus'
import { webcamPanelCaptureSource, captureImageResult } from '../services/captureImage'

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
  // No `| null`: `composeBeforeAfter` has no failure VALUE, only failure
  // rejections (RC-54). `captureFrame` above keeps its own `string | null`
  // contract — it was not part of that ruling.
  composeBeforeAfter: (before: string, after: string) => Promise<string>
  startCamera: () => Promise<void>
  stopCamera: () => void
  isActive: boolean
  cameraStatus: WebcamStatus
  cameraError: WebcamError | null
}

/**
 * The exact list `defineExpose` is called with, in order. The RC-55 members are
 * APPENDED to the RC-45-era surface; everything before them must stay put,
 * because this is a published component and consumers are already bound to it.
 */
const EXPECTED_EXPOSED_KEYS = [
  'captureFrame',
  'composeBeforeAfter',
  'startCamera',
  'stopCamera',
  'isActive',
  'cameraStatus',
  'cameraError',
  // RC-35: the shutter blink, appended after RC-55's members.
  'blink',
] as const

/** The raw object handed to `defineExpose`, straight off the component instance. */
function exposedObject(wrapper: VueWrapper): Record<string, unknown> {
  const instance = (wrapper.vm as unknown as { $: { exposed: Record<string, unknown> | null } }).$
  return instance.exposed ?? {}
}

/**
 * The panel as a PARENT sees it through a template ref.
 *
 * This deliberately goes through `instance.exposed` — wrapped in `proxyRefs`,
 * exactly as Vue itself wraps it for a parent — rather than through `wrapper.vm`.
 * That is what makes these cells discriminating: VTU's `vm` proxy also reaches
 * `<script setup>` bindings that were NEVER exposed, so a cell reading
 * `wrapper.vm.cameraStatus` would keep passing with the `defineExpose` entry
 * deleted, and would prove nothing about the public API.
 */
function exposed(wrapper: VueWrapper): WebcamPanelExposed {
  return proxyRefs(exposedObject(wrapper)) as unknown as WebcamPanelExposed
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

/**
 * RC-54: every `composeBeforeAfter` failure rejects, naming its cause.
 *
 * The function had three shapes of failure and declared only one: a missing
 * canvas and a missing 2D context returned `null`; an undecodable frame
 * rejected; and a panel unmounted while the two frames were decoding threw a
 * raw `TypeError` from a re-read of the ref after the await, which TypeScript
 * could not see because narrowing survives an `await` unsoundly. All three ran
 * against a `Promise<string | null>` signature that mentioned none of them.
 * These cells pin the uniform protocol: no failure VALUE, an `Error` per path,
 * and a message that says which path it was.
 *
 * ## Why the message, and not merely that it threw
 * The consumer is an agent reading a tool result, which turns the rejection into
 * an error string and abandons the remaining steps. Under the old protocol a
 * `null` from a decode failure was indistinguishable from a `null` from an
 * absent canvas; under this one an `Error` from one path can stand in for an
 * `Error` from another just as silently. So every cell below asserts the
 * MESSAGE. A cell asserting only `rejects.toThrow()` would pass with every
 * cause reporting the same thing — an assertion that cannot fail in the way
 * that matters.
 *
 * ## What jsdom can and cannot establish here
 * jsdom decodes nothing, so the stubbed `onerror` above proves only what it was
 * told to fire. The gap was closed out of band on the previous lane with a real
 * Chromium probe over byte-identical `data:` URLs: `error` fires, `load` does
 * not, the `src` assignment throws nothing synchronously, and a genuine 1x1 PNG
 * fires `load` in the same probe — so the result discriminates rather than
 * everything simply failing. Production's `loadImage` has exactly that one
 * failure channel, so `onerror` is the only real input that reaches this path.
 * `BEFORE_URL`/`AFTER_URL` are themselves not decodable images (`QkVGT1JF` is
 * ASCII `BEFORE`); the size table is what makes them "load", and it must stay a
 * table — making the fixtures really decodable would redden RC-45's cells.
 */
describe('PkWebcamPanel — every compose failure names its cause (RC-54)', () => {
  /**
   * A data URL whose base64 payload is not an image. Byte-identical to the URL
   * the Chromium probe observed `error` on, so the string asserted in jsdom is
   * the string a real browser was measured to fail.
   */
  const MALFORMED_URL = 'data:image/jpeg;base64,bm90LWFuLWltYWdl'

  const MISSING_CANVAS = 'The compositing canvas is not mounted.'
  const UNMOUNTED_MID_DECODE =
    'The compositing canvas was unmounted while the frames were decoding.'
  const MISSING_CONTEXT = 'The compositing canvas has no 2D drawing context.'
  const BEFORE_UNDECODABLE = 'The Before frame could not be decoded from its data URL.'
  const AFTER_UNDECODABLE = 'The After frame could not be decoded from its data URL.'

  /**
   * Settle a promise into a tagged outcome WITHOUT try/catch.
   *
   * A `try { await p; throw new Error('expected a rejection') } catch (e) { return e }`
   * helper manufactures its own failure signal: when the promise RESOLVES it
   * returns the sentinel it threw itself, and a cell asserting "an Error came
   * back" then passes on an error production never raised. Splitting the two
   * settlements apart makes resolution and rejection separately observable.
   */
  function settle<T>(
    promise: Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    return promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
  }

  /** The message of a genuine `Error` rejection, or a failed cell naming what came back instead. */
  async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
    const outcome = await settle(promise)
    if (outcome.ok) {
      expect.unreachable(
        `composeBeforeAfter resolved ${JSON.stringify(outcome.value)} instead of rejecting`,
      )
    }
    // An `Error` specifically: a bare string or a DOMException would deny the
    // consumer the `.message` the whole protocol is built on.
    expect(outcome.error).toBeInstanceOf(Error)
    return (outcome.error as Error).message
  }

  /**
   * A mounted panel with the drawing DOM stubbed and no camera — the state in
   * which compositing is expected to work, so every failure below is caused by
   * the one thing that cell removes.
   */
  async function mountForCompose() {
    const ctx = stubDrawingDom()
    stubGetUserMedia(() => new Promise<MediaStream>(() => {}))
    const wrapper = mount(PkWebcamPanel)
    await flushPromises()
    return { wrapper, ctx, panel: exposed(wrapper) }
  }

  /**
   * The declared return type admits no failure value — checked by the COMPILER.
   *
   * `expectTypeOf` is erased at runtime, so this cell passes under `vitest run`
   * whatever the signature says. Its gate is `vue-tsc -p tsconfig.json --noEmit`,
   * i.e. this package's `type-check` script, which its `build` script runs first
   * — so it rides `pnpm -r run build` and `pnpm -r run type-check` alike. It is
   * written as a cell rather than as a bare module-level statement so that a
   * reader scanning the suite sees the contract enumerated beside the message
   * cells; the comment is what says where it is enforced.
   *
   * WHY IT IS ANCHORED ON `InstanceType<typeof PkWebcamPanel>` AND NOT ON
   * `WebcamPanelExposed`. That interface is hand-written and reached through an
   * `as unknown as` cast, so it is not mechanically linked to production: an
   * assertion on it would go on passing with production reverted, which is an
   * assertion that cannot fail. `InstanceType` reads the type vue-tsc generates
   * from the component's own `defineExpose` — the same type a parent holding a
   * template ref gets — so reverting production's signature to
   * `Promise<string | null>` is what makes this red, and reverting it is how it
   * was proven to bite rather than merely to compile.
   */
  it('declares no failure VALUE — the resolved type is `string`, not `string | null`', () => {
    type ComposeReturn = ReturnType<InstanceType<typeof PkWebcamPanel>['composeBeforeAfter']>
    expectTypeOf<Awaited<ComposeReturn>>().toEqualTypeOf<string>()
    // The acceptance's own wording, asserted directly. A failing `.not` presents
    // as `TS2554: Expected 1 arguments, but got 0` rather than as a readable
    // mismatch — that is how expect-type signals a negation that does not hold,
    // and the line above it is the one that names the actual type.
    expectTypeOf<Awaited<ComposeReturn>>().not.toEqualTypeOf<string | null>()

    // And the spec's own hand-written declaration says the same thing as
    // production, so the cast above it cannot drift into a wider contract than
    // the component actually offers.
    expectTypeOf<Awaited<ReturnType<WebcamPanelExposed['composeBeforeAfter']>>>().toEqualTypeOf<
      Awaited<ComposeReturn>
    >()
  })

  /**
   * Start a compose on a fresh panel and HOLD both frame decodes open.
   *
   * `composeBeforeAfter` is a check-then-await-then-use: its canvas guard runs
   * before the two decodes and the canvas is re-read after them, so the only way
   * to reach the second guard is to make the panel disappear BETWEEN the two.
   * In a browser the decodes are fast and that window is narrow; here it is held
   * open explicitly, which demonstrates the mechanism rather than its frequency.
   *
   * The `src` patch goes on top of `stubDrawingDom`'s and comes off through a
   * saved descriptor, never a pop of the shared `restores` stack — nothing here
   * may depend on push order. It is off again before this returns, so a caller
   * can go on mounting panels whose decodes settle normally.
   */
  async function composeWithDecodesHeld() {
    const { wrapper, ctx, panel } = await mountForCompose()

    const decoding: HTMLImageElement[] = []
    const firingSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
    // Installed by `stubDrawingDom`; asserted rather than assumed, since
    // restoring `undefined` would leave every later decode hanging forever.
    expect(firingSrc).toBeDefined()
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      get: () => '',
      set(this: HTMLImageElement) {
        decoding.push(this)
      },
    })

    let settledEarly = false
    const composing = panel.composeBeforeAfter(BEFORE_URL, AFTER_URL)
    // Attached now, so the rejection this cell is arranging is never unhandled
    // while it waits.
    void composing.then(
      () => {
        settledEarly = true
      },
      () => {
        settledEarly = true
      },
    )
    await flushPromises()
    Object.defineProperty(HTMLImageElement.prototype, 'src', firingSrc!)

    // The mechanism, measured rather than assumed. Two images were constructed,
    // so the ENTRY guard passed and execution reached the `Promise.all`; and
    // neither decode has settled, so the await is genuinely still pending. If
    // this patch ever silently stopped taking, `stubDrawingDom`'s microtask
    // would settle both decodes first and the unmount would land BEFORE the
    // call — the cell would then be exercising the entry guard while its name
    // said otherwise, and would go red for a reason that reads like a
    // production regression.
    expect(decoding).toHaveLength(2)
    expect(settledEarly).toBe(false)

    /**
     * Let both frames decode SUCCESSFULLY — this path is not a decode failure.
     * Their widths read 0, because the size table lives in `stubDrawingDom`'s
     * own map and the patch above bypasses it. That is harmless and deliberately
     * not worked around: the geometry those widths feed is pure arithmetic, and
     * the canvas re-read throws before anything is drawn.
     */
    const release = () => {
      for (const img of decoding) img.onload?.call(img, new Event('load'))
    }
    return { wrapper, ctx, panel, composing, release }
  }

  it('still resolves the composite when everything is present — the loud paths are not always-on', async () => {
    const { wrapper, ctx, panel } = await mountForCompose()

    await expect(panel.composeBeforeAfter(BEFORE_URL, AFTER_URL)).resolves.toBe(
      COMPOSITE_DATA_URL,
    )
    expectCompositeDrawnOn(wrapper.find('canvas').element, ctx)
  })

  it('rejects, naming the missing canvas, once the panel is unmounted', async () => {
    const { wrapper, ctx, panel } = await mountForCompose()

    // Precondition, established on this very panel: with the canvas present the
    // composite is produced. So the only thing the unmount changes is the canvas
    // — the 2D context is still available, and cannot be the cause below.
    await expect(panel.composeBeforeAfter(BEFORE_URL, AFTER_URL)).resolves.toBe(
      COMPOSITE_DATA_URL,
    )
    expect(ctx.drawImage).toHaveBeenCalledTimes(2)

    // Unmounting nulls the template ref, which is the reachable way to observe a
    // panel with no compositing canvas: RC-45 deliberately keeps it mounted in
    // every camera state. `panel` was captured while mounted, exactly as a
    // parent holding a template ref would have it.
    wrapper.unmount()

    expect(await rejectionMessage(panel.composeBeforeAfter(BEFORE_URL, AFTER_URL))).toBe(
      MISSING_CANVAS,
    )
    // Nothing further was drawn: it refused before touching the context.
    expect(ctx.drawImage).toHaveBeenCalledTimes(2)
  })

  it('rejects, naming the unmount, when the panel disappears WHILE the frames decode', async () => {
    const { wrapper, ctx, composing, release } = await composeWithDecodesHeld()

    // The canvas WAS mounted when the call was made — the helper asserts the
    // entry guard passed — and it goes away now, mid-flight. This is the window
    // the top guard cannot see, and the compiler cannot either: narrowing
    // survives an `await` unsoundly, so `type-check` is green with or without
    // the second guard.
    wrapper.unmount()
    release()

    expect(await rejectionMessage(composing)).toBe(UNMOUNTED_MID_DECODE)
    // Both frames decoded and nothing was drawn: it refused at the canvas, not
    // at a decode, and never reached the context.
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('rejects, naming the missing 2D context, when the canvas cannot provide one', async () => {
    const { wrapper, ctx } = await mountForCompose()
    // Re-patch on top of the working stub; `afterEach` unwinds both in order.
    patch(HTMLCanvasElement.prototype, 'getContext', { value: () => null, writable: true })
    const panel = exposed(wrapper)

    // The canvas itself IS mounted, so the missing-canvas guard cannot be what
    // fires — without this the two causes would be indistinguishable here.
    expect(wrapper.find('canvas').exists()).toBe(true)

    expect(await rejectionMessage(panel.composeBeforeAfter(BEFORE_URL, AFTER_URL))).toBe(
      MISSING_CONTEXT,
    )
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  describe('an undecodable frame says WHICH frame', () => {
    it('names the Before frame when only the before frame fails to decode', async () => {
      const { ctx, panel } = await mountForCompose()

      // The stub errors on anything absent from the size table; the after frame
      // is in it, so exactly one of the two decodes.
      expect(IMAGE_SIZES.has(MALFORMED_URL)).toBe(false)
      expect(IMAGE_SIZES.has(AFTER_URL)).toBe(true)

      expect(await rejectionMessage(panel.composeBeforeAfter(MALFORMED_URL, AFTER_URL))).toBe(
        BEFORE_UNDECODABLE,
      )
      expect(ctx.drawImage).not.toHaveBeenCalled()
    })

    it('names the After frame when only the after frame fails to decode', async () => {
      const { ctx, panel } = await mountForCompose()

      expect(IMAGE_SIZES.has(BEFORE_URL)).toBe(true)

      expect(await rejectionMessage(panel.composeBeforeAfter(BEFORE_URL, MALFORMED_URL))).toBe(
        AFTER_UNDECODABLE,
      )
      expect(ctx.drawImage).not.toHaveBeenCalled()
    })
  })

  it('tells every cause apart — no message stands in for another', async () => {
    // The acceptance criterion asserted as a PROPERTY rather than as a list of
    // literals: the cells above pin what each message says, this one pins that
    // knowing the message is enough to know the cause.
    // FIRST, because it swaps the image `src` descriptor for the duration of its
    // own compose and puts it back before returning. Collected here so the fifth
    // failure path is inside this property too: a path that rejects with a
    // named `Error` but is not in this set is one a future edit could collide
    // with another without anything noticing.
    const midDecode = await composeWithDecodesHeld()
    midDecode.wrapper.unmount()
    midDecode.release()
    const midDecodeMessage = await rejectionMessage(midDecode.composing)

    const undecodableBefore = await mountForCompose()
    const undecodableAfter = await mountForCompose()
    const noContext = await mountForCompose()
    const unmounted = await mountForCompose()

    // Save and restore THIS patch through a local descriptor rather than popping
    // the shared `restores` stack. A pop assumes the null-context patch is on top
    // of it, which silently couples this cell to the push order of
    // `mountForCompose`: add a `patch` to `stubDrawingDom`, or reorder the mounts
    // above, and the pop restores the WRONG descriptor while the cell goes on
    // passing — an expensive place for that, since this is the cell whose whole
    // job is proving the causes stay distinct.
    const workingGetContext = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      'getContext',
    )
    // Installed by `stubDrawingDom`; asserted rather than assumed, because
    // restoring `undefined` would leave every later canvas without a context and
    // quietly turn the remaining collections into context failures.
    expect(workingGetContext).toBeDefined()
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      writable: true,
      value: () => null,
    })
    const contextMessage = await rejectionMessage(
      exposed(noContext.wrapper).composeBeforeAfter(BEFORE_URL, AFTER_URL),
    )
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', workingGetContext!)

    unmounted.wrapper.unmount()

    const messages = [
      await rejectionMessage(unmounted.panel.composeBeforeAfter(BEFORE_URL, AFTER_URL)),
      midDecodeMessage,
      contextMessage,
      await rejectionMessage(
        undecodableBefore.panel.composeBeforeAfter(MALFORMED_URL, AFTER_URL),
      ),
      await rejectionMessage(undecodableAfter.panel.composeBeforeAfter(BEFORE_URL, MALFORMED_URL)),
    ]

    expect(messages.every((message) => message.length > 0)).toBe(true)
    expect(new Set(messages).size).toBe(messages.length)
  })
})

/**
 * RC-55: the panel says WHY it has no frames.
 *
 * The panel has always known — `getUserMedia` either rejected or has not resolved
 * yet — but `defineExpose` did not surface it, so every consumer saw only "no
 * frame". Measured downstream while building RC-53: a capture failure could not
 * name its cause, and a consumer unable to tell "denied" from "still starting"
 * had no safe move but to wait, so a denied camera burned the full readiness
 * deadline on every single call.
 *
 * These cells read the status through the PUBLIC surface (see `exposed`), and
 * assert the rejection/slow-start distinction DIRECTLY rather than inferring it
 * from a timeout — a timing-derived cell would pass for a panel that simply
 * never reports anything.
 */
describe('PkWebcamPanel — the panel reports why it has no frames (RC-55)', () => {
  /** A MediaStream stand-in: only `getTracks().stop()` is ever reached. */
  function fakeStream(): MediaStream {
    return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
  }

  /** Mount with `getUserMedia` rejecting with a real, named DOMException. */
  async function mountRejectedWith(name: string, message = 'the browser said so') {
    const getUserMedia = stubGetUserMedia(() => Promise.reject(new DOMException(message, name)))
    const wrapper = mount(PkWebcamPanel)
    await flushPromises()
    return { wrapper, getUserMedia }
  }

  /** Mount with `getUserMedia` resolving to an open stream. */
  async function mountLive() {
    const getUserMedia = stubGetUserMedia(() => Promise.resolve(fakeStream()))
    const wrapper = mount(PkWebcamPanel)
    await flushPromises()
    return { wrapper, getUserMedia }
  }

  /** Mount with `getUserMedia` in flight and never settling. */
  async function mountPending() {
    const getUserMedia = stubGetUserMedia(() => new Promise<MediaStream>(() => {}))
    const wrapper = mount(PkWebcamPanel)
    await flushPromises()
    return { wrapper, getUserMedia }
  }

  describe('the exposed surface is additive — nothing existing moved', () => {
    it('exposes exactly the previous members, in order, plus the two RC-55 ones', async () => {
      const { wrapper } = await mountPending()

      // Order and membership both: an assertion on membership alone would let a
      // member be dropped and re-added, and this is a published API.
      expect(Object.keys(exposedObject(wrapper))).toEqual([...EXPECTED_EXPOSED_KEYS])
    })

    it('keeps every pre-RC-55 member callable/readable through the public surface', async () => {
      const { wrapper } = await mountPending()
      const panel = exposed(wrapper)

      expect(typeof panel.captureFrame).toBe('function')
      expect(typeof panel.composeBeforeAfter).toBe('function')
      expect(typeof panel.startCamera).toBe('function')
      expect(typeof panel.stopCamera).toBe('function')
      expect(panel.isActive).toBe(false)
    })
  })

  describe('a rejection is distinguishable from a slow start', () => {
    /**
     * The whole point of the node, asserted head-on: two panels, one still
     * starting and one already refused, reporting DIFFERENT statuses at the same
     * observation. Nothing here waits, so the cell cannot pass by timing out.
     */
    it('reports starting for an in-flight call and denied for a refused one', async () => {
      const pending = await mountPending()
      const refused = await mountRejectedWith('NotAllowedError')

      expect(exposed(pending.wrapper).cameraStatus).toBe('starting')
      expect(exposed(refused.wrapper).cameraStatus).toBe('denied')
      expect(exposed(pending.wrapper).cameraStatus).not.toBe(
        exposed(refused.wrapper).cameraStatus,
      )

      // Both are equally frameless and equally inactive: the OLD signals cannot
      // tell them apart, which is why the new one had to exist.
      expect(exposed(pending.wrapper).isActive).toBe(false)
      expect(exposed(refused.wrapper).isActive).toBe(false)
      expect(exposed(pending.wrapper).captureFrame()).toBeNull()
      expect(exposed(refused.wrapper).captureFrame()).toBeNull()
    })

    it('leaves no error detail on the still-starting panel', async () => {
      const { wrapper } = await mountPending()

      expect(exposed(wrapper).cameraStatus).toBe('starting')
      expect(exposed(wrapper).cameraError).toBeNull()
    })
  })

  describe('each cause the consumer must act on differently', () => {
    const CAUSES: ReadonlyArray<readonly [string, WebcamStatus]> = [
      ['NotAllowedError', 'denied'],
      ['NotFoundError', 'no-device'],
      ['NotReadableError', 'busy'],
      ['AbortError', 'error'],
    ]

    it.each(CAUSES)('reports %s as %s, with the detail beside it', async (name, expected) => {
      const { wrapper } = await mountRejectedWith(name, 'what the browser said')
      const panel = exposed(wrapper)

      expect(panel.cameraStatus).toBe(expected)
      expect(panel.cameraError).toEqual({ name, message: 'what the browser said' })
      expect(panel.isActive).toBe(false)
    })

    it('reports live once getUserMedia resolves, and is active on the ordinary path', async () => {
      const { wrapper } = await mountLive()
      const panel = exposed(wrapper)

      expect(panel.cameraStatus).toBe('live')
      expect(panel.cameraError).toBeNull()
      // The invariant a consumer will assume, pinned on the path where it holds:
      // a normal mount has the video element bound before the stream arrives.
      expect(panel.isActive).toBe(true)
    })

    it('carries a serialisable detail — never the raw DOMException', async () => {
      const { wrapper } = await mountRejectedWith('NotAllowedError', 'Permission dismissed')
      const detail = exposed(wrapper).cameraError

      expect(detail).not.toBeInstanceOf(DOMException)
      expect(JSON.parse(JSON.stringify(detail))).toEqual(detail)
    })
  })

  describe('stopping the camera', () => {
    it('goes back to idle and drops the detail once a live camera is stopped', async () => {
      const { wrapper } = await mountLive()
      const panel = exposed(wrapper)
      expect(panel.cameraStatus).toBe('live')

      panel.stopCamera()
      await flushPromises()

      expect(panel.cameraStatus).toBe('idle')
      expect(panel.cameraError).toBeNull()
    })

    it('keeps naming the cause when the camera never opened', async () => {
      // Stopping a camera that was refused does not un-refuse it. The status must
      // stay in step with the error banner, which stopCamera does not clear —
      // otherwise the panel would show a permission error while reporting `idle`.
      const { wrapper } = await mountRejectedWith('NotAllowedError')
      const panel = exposed(wrapper)

      panel.stopCamera()
      await flushPromises()

      expect(wrapper.find('.webcam-error').exists()).toBe(true)
      expect(panel.cameraStatus).toBe('denied')
      expect(panel.cameraError).toEqual({
        name: 'NotAllowedError',
        message: 'the browser said so',
      })
    })
  })

  /**
   * Stopping a start that has not settled — the one transition where the panel
   * published a status that was not true.
   *
   * `getUserMedia` cannot be cancelled, so the call a stopped panel started is
   * still running and WILL resolve afterwards. The panel used to let that late
   * resolution drive it: it went `idle` → `live` with no `startCamera()` between
   * them, reported `isActive: true` for a session the caller had explicitly
   * stopped, and never released the tracks. `idle` is only honest if a call that
   * resolves after the stop is abandoned, so these cells pin the abandonment
   * rather than the wording.
   */
  describe('a start still in flight when the camera is stopped', () => {
    /**
     * A `getUserMedia` that settles only when the test says so, so the stop lands
     * strictly between the call and its resolution — the window under test. The
     * returned `stop` is the track's, counting releases of the opened stream.
     */
    function deferredCamera() {
      const stop = vi.fn()
      let settle: ((outcome: 'resolve' | 'reject') => void) | null = null
      const getUserMedia = stubGetUserMedia(
        () =>
          new Promise<MediaStream>((resolve, reject) => {
            settle = (outcome) =>
              outcome === 'resolve'
                ? resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
                : reject(new DOMException('the browser said so', 'NotAllowedError'))
          }),
      )
      return {
        stop,
        getUserMedia,
        openCamera: () => settle?.('resolve'),
        refuseCamera: () => settle?.('reject'),
      }
    }

    /** Mount, let the in-flight call reach `starting`, then stop the camera. */
    async function mountThenStopMidStart() {
      const camera = deferredCamera()
      const wrapper = mount(PkWebcamPanel)
      await flushPromises()
      const panel = exposed(wrapper)

      // The precondition this whole block depends on: a call really is in flight.
      expect(panel.cameraStatus).toBe('starting')

      panel.stopCamera()
      await flushPromises()
      expect(panel.cameraStatus).toBe('idle')

      return { wrapper, panel, camera }
    }

    it('stays idle when the abandoned call resolves after the stop', async () => {
      const { panel, camera } = await mountThenStopMidStart()

      camera.openCamera()
      await flushPromises()

      // Without abandonment this reads `live` / `true`: a camera the caller
      // stopped, streaming again with no start in between.
      expect(panel.cameraStatus).toBe('idle')
      expect(panel.isActive).toBe(false)
      expect(panel.cameraError).toBeNull()
    })

    it('releases the tracks of the stream the abandoned call opened', async () => {
      const { camera } = await mountThenStopMidStart()

      // Nothing to release yet — the call had not handed over a stream.
      expect(camera.stop).toHaveBeenCalledTimes(0)

      camera.openCamera()
      await flushPromises()

      expect(camera.stop).toHaveBeenCalledTimes(1)
    })

    it('never binds the abandoned stream to the video element', async () => {
      const { wrapper, camera } = await mountThenStopMidStart()

      camera.openCamera()
      await flushPromises()

      // `isActive` could be forced false while the srcObject was still assigned,
      // so the element itself is checked rather than the flag standing in for it.
      const video = wrapper.find('video')
      expect(video.exists()).toBe(true)
      expect(video.element.srcObject).toBeNull()
    })

    it('raises no error banner when the abandoned call rejects after the stop', async () => {
      const { wrapper, panel, camera } = await mountThenStopMidStart()

      camera.refuseCamera()
      await flushPromises()

      // A refusal the caller is no longer waiting on is not the panel's news to
      // report: it stopped the camera, and `idle` is what it asked for.
      expect(panel.cameraStatus).toBe('idle')
      expect(panel.cameraError).toBeNull()
      expect(wrapper.find('.webcam-error').exists()).toBe(false)
    })

    it('still reports a rejection that belongs to the CURRENT start', async () => {
      // The abandonment guard must not become a blanket "never report errors":
      // this is the same path as the cell above with no stop in between.
      const camera = deferredCamera()
      const wrapper = mount(PkWebcamPanel)
      await flushPromises()
      const panel = exposed(wrapper)

      camera.refuseCamera()
      await flushPromises()

      expect(panel.cameraStatus).toBe('denied')
      expect(panel.cameraError).toEqual({
        name: 'NotAllowedError',
        message: 'the browser said so',
      })
      expect(wrapper.find('.webcam-error').exists()).toBe(true)
    })

    it('starts normally again after a stop abandoned an earlier attempt', async () => {
      // The counter must not latch: a panel that could never reach `live` again
      // would trade one wrong answer for a worse one.
      const { panel } = await mountThenStopMidStart()

      stubGetUserMedia(() => Promise.resolve(fakeStream()))
      await panel.startCamera()
      await flushPromises()

      expect(panel.cameraStatus).toBe('live')
      expect(panel.isActive).toBe(true)
    })
  })

  /**
   * The seam between the two halves, end to end: a REAL mounted panel, through
   * the real adapter, into the real envelope builder.
   *
   * Both halves are covered separately — the panel exposes a status, and the
   * adapter names a cause given one — but only this cell proves they COMPOSE.
   * `webcamPanelCaptureSource` reads `cameraStatus` as a plain property, so if a
   * panel ever handed it an unwrapped `Ref` instead of a string, the lookup would
   * miss, the message would silently fall back to the frozen question, and
   * nothing would throw or go red. That is precisely the behaviour RC-55 exists
   * to remove, so it is asserted rather than assumed.
   */
  describe('the panel drives the capture_image failure envelope end to end', () => {
    it('turns a denied camera into an envelope that names the denial', async () => {
      const { wrapper } = await mountRejectedWith('NotAllowedError', 'Permission dismissed')
      const source = webcamPanelCaptureSource(() => exposed(wrapper))

      // The panel is mounted, so the source is ready and the capture is attempted.
      expect(source.isReady()).toBe(true)
      expect(source.cameraStatus?.()).toBe('denied')

      expect(JSON.parse(await captureImageResult(source))).toEqual({
        error: 'Failed to capture frame. Camera permission was denied.',
      })
    })

    it('says the camera is still starting while the call is in flight', async () => {
      // The other side of the distinction, at the envelope level: the model is
      // told to wait here and told not to bother above.
      const { wrapper } = await mountPending()
      const source = webcamPanelCaptureSource(() => exposed(wrapper))

      expect(JSON.parse(await captureImageResult(source))).toEqual({
        error: 'Failed to capture frame. The camera has not finished starting.',
      })
    })
  })

  it('clears a previous failure when a retry starts, before it can succeed or fail', async () => {
    // Retry's first act is to reset: a consumer polling mid-retry must see
    // `starting` (waiting will help), not the stale `denied` (it will not).
    const { wrapper } = await mountRejectedWith('NotAllowedError')
    const panel = exposed(wrapper)
    expect(panel.cameraStatus).toBe('denied')

    stubGetUserMedia(() => new Promise<MediaStream>(() => {}))
    panel.startCamera()
    await flushPromises()

    expect(panel.cameraStatus).toBe('starting')
    expect(panel.cameraError).toBeNull()
  })
})
