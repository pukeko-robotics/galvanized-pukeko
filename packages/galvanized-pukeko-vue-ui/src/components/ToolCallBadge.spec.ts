import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ToolCallBadge from './ToolCallBadge.vue'
import { registerToolDisplay, resetToolDisplays } from './toolDisplay'
import type { ToolCallPart } from '../services/chatService'
import { toBubbles } from '../copilot/useHeadlessChat'

function part(over: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    kind: 'tool-call',
    toolCallId: 'tc-1',
    toolCallName: 'search',
    args: { q: 'pukeko' },
    argsRaw: '{"q":"pukeko"}',
    result: '{"hits":3}',
    status: 'complete',
    ...over,
  }
}

// A long JSON result that overflows the preview budget (> 8 lines).
function bigResult(): string {
  const obj: Record<string, number> = {}
  for (let i = 0; i < 40; i++) obj[`key_${i}`] = i
  return JSON.stringify(obj)
}

describe('ToolCallBadge — results on expand (PLAT-17 part A)', () => {
  beforeEach(() => resetToolDisplays())

  it('does not render the result until expanded', () => {
    const w = mount(ToolCallBadge, { props: { part: part() } })
    expect(w.find('[data-testid="tool-result-generic"]').exists()).toBe(false)
  })

  it('renders a formatted result in the generic renderer once expanded', async () => {
    const w = mount(ToolCallBadge, { props: { part: part() } })
    await w.find('.tool-call-header').trigger('click')
    const generic = w.find('[data-testid="tool-result-generic"]')
    expect(generic.exists()).toBe(true)
    // JSON is pretty-printed (multi-line), not the raw one-liner.
    expect(generic.find('pre').text()).toContain('"hits": 3')
  })

  it('shows a progressive-disclosure preview + overflow marker for a long result', async () => {
    const w = mount(ToolCallBadge, { props: { part: part({ result: bigResult() }) } })
    await w.find('.tool-call-header').trigger('click')
    // Overflow marker + "Show more" toggle present, and preview is truncated.
    expect(w.find('[data-testid="tool-result-overflow-marker"]').exists()).toBe(true)
    const toggle = w.find('[data-testid="tool-result-toggle"]')
    expect(toggle.text()).toBe('Show more')
    const preview = w.find('[data-testid="tool-result-generic"] pre').text()
    expect(preview).not.toContain('key_39') // last key hidden in preview

    // Expanding the result reveals the full payload.
    await toggle.trigger('click')
    expect(w.find('[data-testid="tool-result-generic"] pre').text()).toContain('key_39')
    expect(w.find('[data-testid="tool-result-toggle"]').text()).toBe('Show less')
  })

  it('renders the result fed by the HEADLESS surface (toBubbles → badge)', async () => {
    // Guards that the default/primary surface actually populates part.result —
    // not just that the badge renders one when hand-fed. toBubbles attaches a
    // `tool` message to its tool-call part (see useHeadlessChat).
    const bubbles = toBubbles([
      {
        id: 'a1',
        role: 'assistant',
        toolCalls: [{ id: 'tc-9', function: { name: 'search', arguments: '{"q":"kiwi"}' } }],
      },
      { id: 't1', role: 'tool', toolCallId: 'tc-9', content: '{"hits":7}' },
    ])
    const bubble = bubbles[0]
    expect(bubble.kind).toBe('assistant')
    const toolPart = bubble.kind === 'assistant' ? (bubble.parts[0] as ToolCallPart) : part()
    expect(toolPart.result).toBe('{"hits":7}')
    expect(toolPart.status).toBe('complete')

    const w = mount(ToolCallBadge, { props: { part: toolPart } })
    await w.find('.tool-call-header').trigger('click')
    expect(w.find('[data-testid="tool-result-generic"] pre').text()).toContain('"hits": 7')
  })

  it('falls back to the generic renderer for an UNregistered tool', async () => {
    const w = mount(ToolCallBadge, { props: { part: part({ toolCallName: 'unregistered_tool' }) } })
    await w.find('.tool-call-header').trigger('click')
    expect(w.find('[data-testid="tool-result-generic"]').exists()).toBe(true)
    // Default header label for unregistered tools.
    expect(w.find('.tool-call-label').text()).toBe('Used unregistered_tool tool')
  })
})

describe('ToolCallBadge — per-tool renderer registry (PLAT-17 part B)', () => {
  beforeEach(() => resetToolDisplays())

  it('dispatches a REGISTERED custom renderer for its tool name (extension point)', async () => {
    // A test-side custom renderer — proves a consumer can register WITHOUT
    // patching vue-ui. Reads part.result off the { part } prop, à la RC-14.
    const CustomResult = defineComponent({
      props: { part: { type: Object, required: true } },
      setup: (p) =>
        () =>
          h('div', { 'data-testid': 'custom-capture-render' }, `custom:${(p.part as ToolCallPart).result}`),
    })

    registerToolDisplay('capture_image', {
      glyph: '📷',
      label: 'Captured image',
      summariseParams: (pt) => (pt.args as { camera?: string })?.camera ?? '',
      renderResult: CustomResult,
    })

    const w = mount(ToolCallBadge, {
      props: {
        part: part({
          toolCallName: 'capture_image',
          args: { camera: 'front' },
          result: 'data:image/png;base64,AAAA',
        }),
      },
    })

    // Registry-driven header: glyph + custom label + param summary.
    expect(w.find('.tool-call-glyph').text()).toBe('📷')
    expect(w.find('.tool-call-label').text()).toBe('Captured image')
    expect(w.find('.tool-call-summary').text()).toBe('front')

    await w.find('.tool-call-header').trigger('click')

    // The custom renderer is dispatched — NOT the generic fallback.
    expect(w.find('[data-testid="custom-capture-render"]').exists()).toBe(true)
    expect(w.find('[data-testid="custom-capture-render"]').text()).toContain('data:image/png;base64')
    expect(w.find('[data-testid="tool-result-generic"]').exists()).toBe(false)
  })

  it('a registered entry without renderResult still uses the generic fallback', async () => {
    registerToolDisplay('search', { glyph: '🔎', label: 'Searched' })
    const w = mount(ToolCallBadge, { props: { part: part() } })
    expect(w.find('.tool-call-label').text()).toBe('Searched')
    await w.find('.tool-call-header').trigger('click')
    expect(w.find('[data-testid="tool-result-generic"]').exists()).toBe(true)
  })
})
