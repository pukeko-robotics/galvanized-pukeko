import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HeadlessChat from './HeadlessChat.vue'
import { registerCaptureImageToolDisplay } from '../components/toolDisplays'
import { resetToolDisplays } from '../components/toolDisplay'
import { createCameraController, type CameraToolConfig } from '../services/cameraController'

/**
 * RC-35 on the headless surface (`?ui=headless`): a `capture_image` call
 * renders as the camera element INSIDE the message thread (so it scrolls with
 * the thread and cannot occlude the composer, D1), its photo is shown without a
 * click (D5), and with `renderToA2UI` the latest capture is mirrored into the
 * A2UI Workplane pane. CopilotKit is mocked as in HeadlessChatA2UI.spec.ts.
 */
const mocks = vi.hoisted(() => ({
  agentRef: { value: null as unknown as Record<string, unknown> },
}))

vi.mock('@copilotkit/vue/v2', () => ({
  useCopilotKit: () => ({ copilotkit: { value: { runAgent: vi.fn() } } }),
  useAgent: () => ({ agent: mocks.agentRef }),
}))

const B64 = '/9j/4AAQSkZJRg=='
const FRAME = `data:image/jpeg;base64,${B64}`

function setAgent(messages: unknown[]) {
  mocks.agentRef.value = {
    messages,
    addMessage: vi.fn(),
    setMessages: vi.fn(),
    isRunning: false,
    abortRun: vi.fn(),
  }
}

function captureMessages(withResult: boolean) {
  const call = {
    id: 'a1',
    role: 'assistant',
    toolCalls: [{ id: 'tc-1', function: { name: 'capture_image', arguments: '{}' } }],
  }
  return withResult
    ? [call, { id: 't1', role: 'tool', toolCallId: 'tc-1', content: JSON.stringify({ mimeType: 'image/jpeg', data: B64 }) }]
    : [call]
}

function camera(config: Partial<CameraToolConfig> = {}) {
  return createCameraController(
    { countdownSeconds: 0, ...config },
    {
      mediaDevices: () => ({
        getUserMedia: (() =>
          Promise.resolve({ getTracks: () => [] })) as unknown as MediaDevices['getUserMedia'],
      }),
      createFrameGrabber: () => ({ captureFrame: async () => FRAME, close: () => {} }),
      sounds: { beep: () => {}, shutter: () => {} },
      storage: () => undefined,
    },
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  resetToolDisplays()
})

describe('HeadlessChat camera (RC-35)', () => {
  it('renders the capture inside the thread, photo shown with no click (D1, D5)', () => {
    const cam = camera()
    registerCaptureImageToolDisplay({ camera: cam })
    setAgent(captureMessages(true))
    const wrapper = mount(HeadlessChat, { props: { a2uiTarget: 'chat', camera: cam } })
    const inThread = wrapper.get('.messages [data-testid="pk-camera-capture"]')
    expect(inThread.get('[data-testid="pk-camera-photo"]').attributes('src')).toBe(FRAME)
    expect(wrapper.find('.tool-call-badge').exists()).toBe(false)
    // The composer is a sibling of the thread, never covered by it.
    expect(wrapper.find('.input-area [data-testid="pk-camera-capture"]').exists()).toBe(false)
  })

  it('renderToA2UI + panel target: the latest capture also shows in the Workplane pane', async () => {
    const cam = camera({ renderToA2UI: true })
    registerCaptureImageToolDisplay({ camera: cam })
    setAgent(captureMessages(false))
    const wrapper = mount(HeadlessChat, { props: { a2uiTarget: 'panel', camera: cam } })
    expect(wrapper.find('[data-testid="pk-headless-camera-pane"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="pk-headless-waiting-placeholder"]').exists()).toBe(true)

    await cam.capture('tc-1')
    await wrapper.vm.$nextTick()
    const pane = wrapper.get('[data-testid="pk-headless-a2ui-panel"] [data-testid="pk-headless-camera-pane"]')
    expect(pane.get('[data-testid="pk-camera-photo"]').attributes('src')).toBe(FRAME)
    expect(wrapper.find('[data-testid="pk-headless-waiting-placeholder"]').exists()).toBe(false)
  })

  it('renderToA2UI off (the default): nothing in the pane', async () => {
    const cam = camera()
    registerCaptureImageToolDisplay({ camera: cam })
    setAgent(captureMessages(false))
    const wrapper = mount(HeadlessChat, { props: { a2uiTarget: 'panel', camera: cam } })
    await cam.capture('tc-1')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="pk-headless-camera-pane"]').exists()).toBe(false)
  })

  it('a new conversation forgets the capture sessions', async () => {
    const cam = camera({ renderToA2UI: true })
    setAgent(captureMessages(false))
    const wrapper = mount(HeadlessChat, { props: { a2uiTarget: 'panel', camera: cam } })
    await cam.capture('tc-1')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="pk-headless-camera-pane"]').exists()).toBe(true)
    await wrapper.get('[data-testid="pk-headless-new-conversation"]').trigger('click')
    expect(cam.latestSession.value).toBeNull()
    expect(wrapper.find('[data-testid="pk-headless-camera-pane"]').exists()).toBe(false)
  })
})
