import { createApp, h, ref } from 'vue'
import ChatInterface from '../src/components/ChatInterface.vue'
import ToolCallBadge from '../src/components/ToolCallBadge.vue'
import '../src/assets/global.css'
import { applyTheme, resetTheme } from '../src/theme'
import type { ToolCallPart } from '../src/services/chatService'

// Real-browser mount harness for the PLAT-23 theme override-wins proof (see
// `theme.visual.spec.ts`). Mounts the two components theme.spec.ts's worked
// example targets — ChatInterface (the user bubble, --pk-color-primary) and
// ToolCallBadge (the badge header, --pk-color-info-text) — exactly as a real
// consumer app would: `global.css` imported for its `:root` defaults, no
// mocking of the theme module itself.
//
// `sendChatMessage` drives ChatInterface's exposed `sendFormMessage`, which
// synchronously pushes the user message onto the message list before it
// `await`s `chatService.sendMessage(...)`. That inner call throws synchronously
// (config was never loaded via `configService.load()`), so it never attempts a
// real network request — the promise it returns just rejects, caught by
// ChatInterface's own try/catch. The user bubble is already in the DOM by
// then, which is all this harness needs.

type ChatInterfaceInstance = InstanceType<typeof ChatInterface>

declare global {
  interface Window {
    __pkThemeHarness: {
      applyTheme: typeof applyTheme
      resetTheme: typeof resetTheme
      sendChatMessage: (text: string) => Promise<void>
    }
  }
}

let chatInstance: ChatInterfaceInstance | null = null

const ChatRoot = {
  setup() {
    const chatRef = ref<ChatInterfaceInstance | null>(null)
    return () => h(ChatInterface, { ref: chatRef, onVnodeMounted: () => { chatInstance = chatRef.value } })
  },
}
createApp(ChatRoot).mount('#chat-root')

const badgePart: ToolCallPart = {
  kind: 'tool-call',
  toolCallId: 'harness-tool-call-1',
  toolCallName: 'harness_tool',
  args: {},
  argsRaw: '{}',
  status: 'complete',
}
createApp({ render: () => h(ToolCallBadge, { part: badgePart }) }).mount('#badge-root')

window.__pkThemeHarness = {
  applyTheme,
  resetTheme,
  sendChatMessage: async (text: string) => {
    await chatInstance?.sendFormMessage(text)
  },
}
