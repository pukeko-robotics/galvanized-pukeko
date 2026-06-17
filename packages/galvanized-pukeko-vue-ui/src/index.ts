import CoreApp from './CoreApp.vue'
import './assets/global.css'

export { CoreApp }
export * from './services/configService'

// Export all components
import PkForm from './components/PkForm.vue'
import PkInput from './components/PkInput.vue'
import PkCheckbox from './components/PkCheckbox.vue'
import PkRadio from './components/PkRadio.vue'
import PkSelect from './components/PkSelect.vue'
import PkButton from './components/PkButton.vue'
import PkInputCounter from './components/PkInputCounter.vue'
import PkBarChart from './components/PkBarChart.vue'
import PkPieChart from './components/PkPieChart.vue'
import PkTable from './components/PkTable.vue'
import ChatInterface from './components/ChatInterface.vue'
import PkNewConversationButton from './components/PkNewConversationButton.vue'
import PkNavHeader from './components/PkNavHeader.vue'
import PkLogo from './components/PkLogo.vue'
import PkLogoLarge from './components/PkLogoLarge.vue'
import PkNavItem from './components/PkNavItem.vue'
import PkProgressBar from './components/PkProgressBar.vue'
import PkWebcamPanel from './components/PkWebcamPanel.vue'

export {
  PkForm,
  PkInput,
  PkCheckbox,
  PkRadio,
  PkSelect,
  PkButton,
  PkInputCounter,
  PkBarChart,
  PkPieChart,
  PkTable,
  ChatInterface,
  PkNewConversationButton,
  PkNavHeader,
  PkLogo,
  PkLogoLarge,
  PkNavItem,
  PkProgressBar,
  PkWebcamPanel,
}

export { runState, statusText, chatService } from './services/chatService'
export type { RunState, Message, Tool, UserMessage } from './services/chatService'

// A2UI bridge — exported so host apps (e.g. the CopilotKit stock-UI mode in the
// web-client) can render agent-driven A2UI surfaces using the same processor
// and component catalog as the bespoke UI. See briefs/copilotkit-vue/PLAN.md
// (P2b increment 2).
import A2UISurface from './components/a2ui/A2UISurface.vue'
import A2UIRenderer from './components/a2ui/A2UIRenderer.vue'
export { A2UISurface, A2UIRenderer }
export { useA2UI, A2UIContextKey, parseA2UIJsonl } from './composables/useA2UI'
export type { Surface, AnyComponentNode, A2UIContext, UserAction } from './composables/useA2UI'
