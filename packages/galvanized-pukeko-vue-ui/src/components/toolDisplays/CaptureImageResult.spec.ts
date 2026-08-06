import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import CaptureImageResult from './CaptureImageResult.vue'
import { parseImageEnvelope } from './imageEnvelope'
import { registerCaptureImageToolDisplay } from './index'
import { getToolDisplay, resetToolDisplays } from '../toolDisplay'
import type { ToolCallPart } from '../../services/chatService'

const B64 = 'AAECAwQ='

function part(result: string | undefined): ToolCallPart {
  return {
    kind: 'tool-call',
    toolCallId: 'call-1',
    toolCallName: 'capture_image',
    args: {},
    result,
  } as ToolCallPart
}

describe('parseImageEnvelope', () => {
  it('reads the capture envelope into a data URL', () => {
    const parsed = parseImageEnvelope(JSON.stringify({ mimeType: 'image/jpeg', data: B64 }))
    expect(parsed).toEqual({
      kind: 'image',
      src: `data:image/jpeg;base64,${B64}`,
      mimeType: 'image/jpeg',
      motion: undefined,
    })
  })

  it('reads the error envelope', () => {
    const parsed = parseImageEnvelope(JSON.stringify({ error: 'Webcam not initialized' }))
    expect(parsed).toEqual({ kind: 'error', message: 'Webcam not initialized', motion: undefined })
  })

  it('keeps the robot motion label so the robot can consume this module', () => {
    const parsed = parseImageEnvelope(
      JSON.stringify({ mimeType: 'image/png', data: B64, motion: 'turn_left (steps=6)' })
    )
    expect(parsed).toMatchObject({ kind: 'image', motion: 'turn_left (steps=6)' })
  })

  // The narrowness is the point: a widened parser would produce a broken <img>
  // where the generic JSON fallback is the correct rendering.
  it.each([
    ['plain text', 'not json at all'],
    ['empty string', ''],
    ['undefined', undefined],
    ['a JSON array', '[1,2,3]'],
    ['a non-image mime type', JSON.stringify({ mimeType: 'text/plain', data: B64 })],
    ['empty data', JSON.stringify({ mimeType: 'image/jpeg', data: '' })],
    ['data with no mime type', JSON.stringify({ data: B64 })],
  ])('treats %s as unrecognised', (_label, input) => {
    expect(parseImageEnvelope(input as string | undefined)).toEqual({ kind: 'unrecognised' })
  })
})

describe('CaptureImageResult', () => {
  it('renders the captured frame inline as an image', () => {
    const wrapper = mount(CaptureImageResult, {
      props: { part: part(JSON.stringify({ mimeType: 'image/jpeg', data: B64 })) },
    })
    const img = wrapper.get('img')
    expect(img.attributes('src')).toBe(`data:image/jpeg;base64,${B64}`)
    expect(img.attributes('alt')).toBeTruthy()
  })

  it('renders a readable note instead of a broken image for an error envelope', () => {
    const wrapper = mount(CaptureImageResult, {
      props: { part: part(JSON.stringify({ error: 'Failed to capture frame' })) },
    })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('[data-testid="pk-capture-error"]').text()).toContain(
      'Failed to capture frame'
    )
  })

  it('falls back to the generic renderer for an unrecognised result', () => {
    const wrapper = mount(CaptureImageResult, { props: { part: part('just some text') } })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pk-capture-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('just some text')
  })
})

describe('registerCaptureImageToolDisplay', () => {
  afterEach(() => resetToolDisplays())

  it('registers the renderer under the capture tool name', () => {
    registerCaptureImageToolDisplay()
    const entry = getToolDisplay('capture_image')
    expect(entry?.renderResult).toBe(CaptureImageResult)
    expect(entry?.glyph).toBe('📷')
  })

  it('honours a renamed capture tool', () => {
    registerCaptureImageToolDisplay('take_photo')
    expect(getToolDisplay('take_photo')?.renderResult).toBe(CaptureImageResult)
    expect(getToolDisplay('capture_image')).toBeUndefined()
  })

  it('unregisters through the returned function', () => {
    const undo = registerCaptureImageToolDisplay()
    undo()
    expect(getToolDisplay('capture_image')).toBeUndefined()
  })
})
