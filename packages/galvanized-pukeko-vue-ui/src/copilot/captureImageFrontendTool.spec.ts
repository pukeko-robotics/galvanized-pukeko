import { describe, it, expect } from 'vitest'
import { createCaptureImageFrontendTool } from './captureImageFrontendTool'
import type { ImageCaptureSource } from '../services/captureImage'

const JPEG_FRAME = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

function fakeSource(frame: string | null = JPEG_FRAME): ImageCaptureSource {
  return { isReady: () => true, captureFrame: () => frame }
}

describe('createCaptureImageFrontendTool (headless CopilotKit helper)', () => {
  it('declares the frozen tool name and no parameter schema', () => {
    const tool = createCaptureImageFrontendTool()
    expect(tool.name).toBe('capture_image') // RC-14: the name is load-bearing.
    expect(tool.parameters).toBeUndefined() // CopilotKit serializes as {} schema.
    expect(tool.description).toBeTruthy()
    expect(typeof tool.handler).toBe('function')
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

  it('defaults to the on-demand source, which degrades to not-initialized in jsdom', async () => {
    const tool = createCaptureImageFrontendTool()
    const result = (await tool.handler!({}, {} as never)) as string
    expect(result).toBe(JSON.stringify({ error: 'Webcam not initialized' }))
  })

  it('lets the host override the model-facing description', () => {
    const tool = createCaptureImageFrontendTool({ description: 'Overhead robot cam.' })
    expect(tool.description).toBe('Overhead robot cam.')
  })
})
