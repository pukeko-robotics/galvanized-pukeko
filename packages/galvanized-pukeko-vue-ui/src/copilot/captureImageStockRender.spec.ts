import { describe, it, expect } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { CopilotKitProvider, useCopilotKit } from '@copilotkit/vue/v2'
import { createCaptureImageFrontendTool } from './captureImageFrontendTool'

/**
 * RC-35 O1, against the REAL CopilotKitProvider (no mock): `?ui=stock` renders
 * a capture because the provider turns the tool's `render` into a tool-call
 * renderer that CopilotChat looks up by tool name. The provider only does that
 * for a tool that also declares `parameters` — this cell is what fails if the
 * schema is ever dropped again, or if a CopilotKit upgrade changes the rule.
 */
describe('capture_image on the stock surface (O1)', () => {
  it("the provider registers the tool's render as the capture_image tool-call renderer", () => {
    const tool = createCaptureImageFrontendTool()
    const frontendTools = [tool]
    let renderers: ReadonlyArray<{ name: string; render: unknown }> = []
    const Probe = defineComponent({
      setup() {
        const { copilotkit } = useCopilotKit()
        return () => {
          renderers = (copilotkit.value as unknown as { renderToolCalls: typeof renderers })
            .renderToolCalls
          return null
        }
      },
    })
    mount(
      defineComponent({
        setup: () => () =>
          h(CopilotKitProvider, { selfManagedAgents: {}, frontendTools }, { default: () => h(Probe) }),
      }),
    )
    const entry = renderers.find((r) => r.name === 'capture_image')
    expect(entry).toBeDefined()
    expect(entry?.render).toBe(tool.render)
  })
})
