import { describe, it, expect, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createCaptureImageFrontendTool, NO_ARGUMENTS_SCHEMA } from './captureImageFrontendTool'
import type { ImageCaptureSource } from '../services/captureImage'
import { createCameraController } from '../services/cameraController'

const JPEG_FRAME = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

function fakeSource(frame: string | null = JPEG_FRAME): ImageCaptureSource {
  return { isReady: () => true, captureFrame: () => frame }
}

describe('createCaptureImageFrontendTool (headless CopilotKit helper)', () => {
  it('declares the frozen tool name and an argument-free schema', () => {
    const tool = createCaptureImageFrontendTool()
    expect(tool.name).toBe('capture_image') // RC-14: the name is load-bearing.
    expect(tool.description).toBeTruthy()
    expect(typeof tool.handler).toBe('function')
  })

  // RC-35 O1: CopilotKitProvider only registers a frontend tool's `render` when
  // the tool has a `parameters` schema, so the tool now declares one. What goes
  // on the wire must not move: CopilotKit's `createToolSchema` reads the
  // Standard JSON Schema `input` (draft-07), and the result must be exactly the
  // `{type:'object',properties:{}}` it advertised for the omitted schema.
  it('declares a schema whose JSON Schema is the same empty object schema as before', () => {
    const tool = createCaptureImageFrontendTool()
    const standard = (tool.parameters as typeof NO_ARGUMENTS_SCHEMA)['~standard']
    expect(standard.version).toBe(1)
    expect(standard.jsonSchema.input({ target: 'draft-07' } as never)).toEqual({
      type: 'object',
      properties: {},
    })
    expect(standard.validate(undefined)).toEqual({ value: {} })
  })

  it('carries a stock `render` (O1) that draws the camera element', () => {
    const tool = createCaptureImageFrontendTool()
    expect(typeof tool.render).toBe('function')
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(tool.render as never, {
            name: 'capture_image',
            toolCallId: 'tc-9',
            args: {},
            status: 'complete',
            result: JSON.stringify({ mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRg==' }),
          }),
      }),
    )
    expect(wrapper.get('[data-testid="pk-camera-photo"]').attributes('src')).toBe(JPEG_FRAME)
  })

  it('the stock render reads a complete call with no result and no session as over (review finding 3)', () => {
    const tool = createCaptureImageFrontendTool({ camera: createCameraController() })
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(tool.render as never, { name: 'capture_image', toolCallId: 'tc-gone', args: {}, status: 'complete' }),
      }),
    )
    expect(wrapper.get('[data-testid="pk-camera-label"]').text()).toBe('Photo not taken')
    expect(wrapper.find('.pk-camera-dot').exists()).toBe(false)
  })

  it('the stock render shows the live session the handler started, keyed by tool-call id', async () => {
    const camera = createCameraController(
      { countdownSeconds: 1, toolCallLabel: 'Taking photo…' },
      {
        mediaDevices: () => ({
          getUserMedia: (() =>
            Promise.resolve({ getTracks: () => [] })) as unknown as MediaDevices['getUserMedia'],
        }),
        createFrameGrabber: () => ({ captureFrame: async () => JPEG_FRAME, close: () => {} }),
        sounds: { beep: () => {}, shutter: () => {} },
        storage: () => undefined,
      },
    )
    vi.useFakeTimers()
    try {
      const tool = createCaptureImageFrontendTool({ camera })
      const pending = tool.handler!({}, { toolCall: { id: 'tc-7' } } as never)
      await vi.advanceTimersByTimeAsync(0)
      const wrapper = mount(
        defineComponent({
          setup: () => () =>
            h(tool.render as never, { name: 'capture_image', toolCallId: 'tc-7', args: {}, status: 'executing' }),
        }),
      )
      expect(wrapper.find('[data-testid="pk-camera-countdown"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="pk-camera-stream"]').exists()).toBe(true)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(JSON.parse((await pending) as string)).toEqual({
        mimeType: 'image/jpeg',
        data: '/9j/4AAQSkZJRg==',
      })
      expect(camera.session('tc-7')?.phase).toBe('done')
    } finally {
      vi.useRealTimers()
    }
  })

  it('handler resolves the same success envelope as the bespoke path', async () => {
    const tool = createCaptureImageFrontendTool({ source: fakeSource() })
    const result = (await tool.handler!({}, {} as never)) as string
    expect(JSON.parse(result)).toEqual({ mimeType: 'image/jpeg', data: '/9j/4AAQSkZJRg==' })
  })

  it('handler resolves the frozen error envelope on capture failure', async () => {
    const tool = createCaptureImageFrontendTool({ source: fakeSource(null) })
    const result = (await tool.handler!({}, {} as never)) as string
    expect(result).toBe(JSON.stringify({ error: 'Failed to capture frame. Is the camera active?' }))
  })

  it('defaults to the streaming camera controller, which degrades to not-initialized in jsdom', async () => {
    const tool = createCaptureImageFrontendTool()
    const result = (await tool.handler!({}, {} as never)) as string
    expect(result).toBe(JSON.stringify({ error: 'Webcam not initialized' }))
  })

  it('lets the host override the model-facing description', () => {
    const tool = createCaptureImageFrontendTool({ description: 'Overhead robot cam.' })
    expect(tool.description).toBe('Overhead robot cam.')
  })
})
