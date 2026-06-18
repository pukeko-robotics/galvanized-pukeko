import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import A2UIToolSurface from './A2UIToolSurface.vue'

// A minimal A2UI surface: a Column containing a Text and a Button. Matches the
// @a2ui/web_core ServerToClientMessage shape our backend emits as the
// show_a2ui_surface tool result (concatenated JSON objects, brace-delimited).
function surfaceJsonl(): string {
  const surfaceUpdate = {
    surfaceUpdate: {
      surfaceId: '@default',
      components: [
        {
          id: 'root',
          component: { Column: { children: { explicitList: ['title', 'go'] } } },
        },
        {
          id: 'title',
          component: { Text: { text: { literalString: 'Pick an option' }, usageHint: 'h3' } },
        },
        {
          id: 'go',
          component: {
            Button: {
              action: { name: 'choose', context: [{ key: 'pick', value: { literalString: 'A' } }] },
              child: 'Go',
            },
          },
        },
      ],
    },
  }
  const beginRendering = { beginRendering: { surfaceId: '@default', root: 'root' } }
  return JSON.stringify(surfaceUpdate) + JSON.stringify(beginRendering)
}

describe('A2UIToolSurface (CopilotKit A2UI bridge)', () => {
  it('renders an A2UI surface from concatenated JSONL', () => {
    const wrapper = mount(A2UIToolSurface, {
      props: { surfaceJsonl: surfaceJsonl(), toolCallId: 'tc-1' },
    })
    expect(wrapper.text()).toContain('Pick an option')
    expect(wrapper.find('button.a2ui-button').exists()).toBe(true)
    expect(wrapper.find('.a2ui-tool-error').exists()).toBe(false)
  })

  it('emits the resolved user action upward when a button is clicked', async () => {
    const wrapper = mount(A2UIToolSurface, {
      props: { surfaceJsonl: surfaceJsonl(), toolCallId: 'tc-1' },
    })
    await wrapper.find('button.a2ui-button').trigger('click')

    const events = wrapper.emitted('action')
    expect(events).toBeTruthy()
    const [payload] = events![0] as [{ toolCallId?: string; action: { actionName: string; context?: Record<string, unknown> } }]
    expect(payload.toolCallId).toBe('tc-1')
    expect(payload.action.actionName).toBe('choose')
    expect(payload.action.context).toEqual({ pick: 'A' })
  })

  it('clears the surface after an action is taken', async () => {
    const wrapper = mount(A2UIToolSurface, {
      props: { surfaceJsonl: surfaceJsonl(), toolCallId: 'tc-1' },
    })
    await wrapper.find('button.a2ui-button').trigger('click')
    expect(wrapper.find('button.a2ui-button').exists()).toBe(false)
  })

  it('shows an error banner when a complete object fails to parse', () => {
    // The brace-depth splitter isolates a closed {...} block, but its contents
    // are not valid JSON, so JSON.parse throws and the error banner shows.
    const wrapper = mount(A2UIToolSurface, {
      props: { surfaceJsonl: '{ not: valid, json }', toolCallId: 'tc-1' },
    })
    expect(wrapper.find('.a2ui-tool-error').exists()).toBe(true)
  })
})
