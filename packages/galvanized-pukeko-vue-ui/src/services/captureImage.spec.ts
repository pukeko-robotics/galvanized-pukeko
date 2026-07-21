import { describe, it, expect } from 'vitest'
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
