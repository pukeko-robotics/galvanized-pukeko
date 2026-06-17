import { ref, type Ref, type InjectionKey } from 'vue'
import { chatService } from '../services/chatService'
import type { ChatCallbacks } from '../services/chatService'

// --- Inline simplified A2UI types (no external deps) ---

interface StringValue {
  path?: string
  literalString?: string
  literal?: string
}

interface Action {
  name: string
  context?: Array<{
    key: string
    value: { path?: string; literalString?: string; literalNumber?: number; literalBoolean?: boolean }
  }>
}

// Component node types
interface BaseComponentNode {
  id: string
  type: string
  dataContextPath?: string
  weight?: number | string
  properties: Record<string, any>
}

export type AnyComponentNode = BaseComponentNode

export interface Surface {
  rootComponentId: string | null
  componentTree: AnyComponentNode | null
  dataModel: Map<string, any>
  components: Map<string, any>
  styles: Record<string, string>
}

interface ServerToClientMessage {
  surfaceUpdate?: any
  dataModelUpdate?: any
  beginRendering?: any
  deleteSurface?: any
}

// --- Simplified Message Processor (port from web_core) ---

class SimpleA2UIProcessor {
  static readonly DEFAULT_SURFACE_ID = '@default'
  private surfaces = new Map<string, Surface>()

  getSurfaces(): ReadonlyMap<string, Surface> {
    return this.surfaces
  }

  clearSurfaces(): void {
    this.surfaces.clear()
  }

  processMessages(messages: ServerToClientMessage[]): void {
    for (const message of messages) {
      if (message.surfaceUpdate) {
        this.handleSurfaceUpdate(message.surfaceUpdate)
      }
      if (message.dataModelUpdate) {
        this.handleDataModelUpdate(message.dataModelUpdate)
      }
      if (message.beginRendering) {
        this.handleBeginRendering(message.beginRendering)
      }
      if (message.deleteSurface) {
        this.handleDeleteSurface(message.deleteSurface)
      }
    }
  }

  getData(node: AnyComponentNode, relativePath: string, surfaceId?: string): any {
    const surface = this.surfaces.get(surfaceId || SimpleA2UIProcessor.DEFAULT_SURFACE_ID)
    if (!surface) return null
    const finalPath = this.resolvePath(relativePath, node.dataContextPath)
    return this.getDataByPath(surface.dataModel, finalPath)
  }

  setData(node: AnyComponentNode | null, relativePath: string, value: any, surfaceId?: string): void {
    if (!node) return
    const sid = surfaceId || SimpleA2UIProcessor.DEFAULT_SURFACE_ID
    const surface = this.surfaces.get(sid)
    if (!surface) return
    const finalPath = this.resolvePath(relativePath, node.dataContextPath)
    this.setDataByPath(surface.dataModel, finalPath, value)
    this.rebuildComponentTree(surface)
  }

  resolvePath(path: string, dataContextPath?: string): string {
    if (path === '.' || path === '') return dataContextPath || '/'
    if (path.startsWith('/')) return path
    if (dataContextPath && dataContextPath !== '/') {
      return dataContextPath.endsWith('/')
        ? `${dataContextPath}${path}`
        : `${dataContextPath}/${path}`
    }
    return `/${path}`
  }

  private getOrCreateSurface(surfaceId: string): Surface {
    let surface = this.surfaces.get(surfaceId)
    if (!surface) {
      surface = {
        rootComponentId: null,
        componentTree: null,
        dataModel: new Map(),
        components: new Map(),
        styles: {},
      }
      this.surfaces.set(surfaceId, surface)
    }
    return surface
  }

  private handleSurfaceUpdate(msg: { surfaceId: string; components: any[] }): void {
    const surface = this.getOrCreateSurface(msg.surfaceId)
    for (const comp of msg.components) {
      surface.components.set(comp.id, comp)
    }
    this.rebuildComponentTree(surface)
  }

  private handleDataModelUpdate(msg: { surfaceId: string; path?: string; contents: any[] }): void {
    const surface = this.getOrCreateSurface(msg.surfaceId)
    const path = msg.path || '/'
    for (const entry of msg.contents) {
      if (entry.key !== undefined) {
        let value: any
        if (entry.valueString !== undefined) value = entry.valueString
        else if (entry.valueNumber !== undefined) value = entry.valueNumber
        else if (entry.valueBoolean !== undefined) value = entry.valueBoolean
        else if (entry.valueMap !== undefined) value = this.convertKeyValueArray(entry.valueMap)
        else value = ''

        const fullPath = path === '/' ? `/${entry.key}` : `${path}/${entry.key}`
        this.setDataByPath(surface.dataModel, fullPath, value)
      }
    }
    this.rebuildComponentTree(surface)
  }

  private convertKeyValueArray(arr: any[]): Map<string, any> {
    const map = new Map<string, any>()
    for (const item of arr) {
      if (item.key !== undefined) {
        if (item.valueString !== undefined) map.set(item.key, item.valueString)
        else if (item.valueNumber !== undefined) map.set(item.key, item.valueNumber)
        else if (item.valueBoolean !== undefined) map.set(item.key, item.valueBoolean)
        else if (item.valueMap !== undefined) map.set(item.key, this.convertKeyValueArray(item.valueMap))
      }
    }
    return map
  }

  private handleBeginRendering(msg: {
    surfaceId: string
    root: string
    styles?: Record<string, string>
  }): void {
    const surface = this.getOrCreateSurface(msg.surfaceId)
    surface.rootComponentId = msg.root
    surface.styles = msg.styles || {}
    this.rebuildComponentTree(surface)
  }

  private handleDeleteSurface(msg: { surfaceId: string }): void {
    this.surfaces.delete(msg.surfaceId)
  }

  private rebuildComponentTree(surface: Surface): void {
    if (!surface.rootComponentId) {
      surface.componentTree = null
      return
    }
    const visited = new Set<string>()
    surface.componentTree = this.buildNode(surface.rootComponentId, surface, visited, '/')
  }

  private buildNode(
    componentId: string,
    surface: Surface,
    visited: Set<string>,
    dataContextPath: string,
  ): AnyComponentNode | null {
    if (!surface.components.has(componentId) || visited.has(componentId)) return null
    visited.add(componentId)

    const compData = surface.components.get(componentId)!
    const componentProps = compData.component || {}
    const componentType = Object.keys(componentProps)[0]
    if (!componentType) {
      visited.delete(componentId)
      return null
    }
    const rawProps = componentProps[componentType] || {}

    const resolvedProps: Record<string, any> = {}
    for (const [key, value] of Object.entries(rawProps)) {
      resolvedProps[key] = this.resolveProperty(value, surface, visited, dataContextPath)
    }

    visited.delete(componentId)

    return {
      id: componentId,
      type: componentType,
      dataContextPath,
      weight: compData.weight,
      properties: resolvedProps,
    }
  }

  private resolveProperty(
    value: any,
    surface: Surface,
    visited: Set<string>,
    dataContextPath: string,
  ): any {
    // If it's a string that matches a component ID, resolve it
    if (typeof value === 'string' && surface.components.has(value)) {
      return this.buildNode(value, surface, visited, dataContextPath)
    }

    // ComponentArrayReference: { explicitList: [...] } or { template: {...} }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.explicitList && Array.isArray(value.explicitList)) {
        return value.explicitList
          .map((id: string) => this.buildNode(id, surface, visited, dataContextPath))
          .filter(Boolean)
      }
      if (value.template) {
        const fullDataPath = this.resolvePath(value.template.dataBinding, dataContextPath)
        const data = this.getDataByPath(surface.dataModel, fullDataPath)
        if (Array.isArray(data)) {
          return data
            .map((_, index) => {
              const childPath = `${fullDataPath}/${index}`
              return this.buildNode(value.template.componentId, surface, new Set(visited), childPath)
            })
            .filter(Boolean)
        }
        if (data instanceof Map) {
          return Array.from(data.keys())
            .map((key) => {
              const childPath = `${fullDataPath}/${key}`
              return this.buildNode(
                value.template.componentId,
                surface,
                new Set(visited),
                childPath,
              )
            })
            .filter(Boolean)
        }
        return []
      }
      // Regular object — recurse
      const resolved: Record<string, any> = {}
      for (const [k, v] of Object.entries(value)) {
        resolved[k] = this.resolveProperty(v, surface, visited, dataContextPath)
      }
      return resolved
    }

    // Array
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveProperty(item, surface, visited, dataContextPath))
    }

    return value
  }

  private setDataByPath(root: Map<string, any>, path: string, value: any): void {
    const segments = path.split('/').filter(Boolean)
    if (segments.length === 0) return

    let current: Map<string, any> = root
    for (let i = 0; i < segments.length - 1; i++) {
      let next = current.get(segments[i])
      if (!(next instanceof Map)) {
        next = new Map()
        current.set(segments[i], next)
      }
      current = next
    }
    current.set(segments[segments.length - 1], value)
  }

  private getDataByPath(root: Map<string, any>, path: string): any {
    const segments = path.split('/').filter(Boolean)
    let current: any = root
    for (const segment of segments) {
      if (current instanceof Map) {
        current = current.get(segment)
      } else if (current && typeof current === 'object') {
        current = current[segment]
      } else {
        return null
      }
      if (current === undefined) return null
    }
    return current
  }
}

// --- Shared JSONL parser ---

/**
 * Parse the concatenated-JSON-object payload emitted as the result of a
 * `show_a2ui_surface` tool call into an array of A2UI server-to-client
 * messages. The payload is a stream of top-level `{...}` objects (not a JSON
 * array), so we brace-match rather than `JSON.parse` the whole thing.
 *
 * Shared by the bespoke `ChatInterface` and the CopilotKit stock-UI bridge so
 * both parse the wire identically (P2b increment 2).
 */
export function parseA2UIJsonl(content: string): ServerToClientMessage[] {
  const messages: ServerToClientMessage[] = []
  let depth = 0
  let start = -1
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (c === '{') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        messages.push(JSON.parse(content.slice(start, i + 1)))
        start = -1
      }
    }
  }
  return messages
}

// --- UserAction type ---
export interface UserAction {
  actionName: string
  sourceComponentId: string
  timestamp: string
  context?: Record<string, unknown>
}

// --- A2UI Context for provide/inject ---
export interface A2UIContext {
  sendAction: (
    surfaceId: string,
    action: Action,
    sourceComponentId: string,
    node?: AnyComponentNode,
  ) => void
  processor: SimpleA2UIProcessor
}

export const A2UIContextKey = Symbol('A2UIContext') as InjectionKey<A2UIContext>

// --- Composable ---
export function useA2UI() {
  const processor = new SimpleA2UIProcessor()
  const surfaces: Ref<Map<string, Surface>> = ref(new Map()) as Ref<Map<string, Surface>>
  const pendingToolCallId: Ref<string | null> = ref(null)

  // Active stream callbacks — set by ChatInterface so tool result responses get streamed
  let activeCallbacks: ChatCallbacks | null = null

  function setCallbacks(cb: ChatCallbacks): void {
    activeCallbacks = cb
  }

  function processBatch(messages: ServerToClientMessage[]): void {
    processor.processMessages(messages)
    // Copy surfaces to trigger reactivity
    const newSurfaces = new Map<string, Surface>()
    for (const [id, surface] of processor.getSurfaces()) {
      newSurfaces.set(id, { ...surface })
    }
    surfaces.value = newSurfaces
  }

  function clearSurfaces(): void {
    processor.clearSurfaces()
    surfaces.value = new Map()
  }

  function sendAction(
    surfaceId: string,
    action: Action,
    sourceComponentId: string,
    node?: AnyComponentNode,
  ): void {
    // Resolve action context values
    const resolvedContext: Record<string, unknown> = {}
    if (action.context) {
      for (const entry of action.context) {
        if (entry.value.path && node) {
          const data = processor.getData(node, entry.value.path, surfaceId)
          resolvedContext[entry.key] = data
        } else if (entry.value.literalString !== undefined) {
          resolvedContext[entry.key] = entry.value.literalString
        } else if (entry.value.literalNumber !== undefined) {
          resolvedContext[entry.key] = entry.value.literalNumber
        } else if (entry.value.literalBoolean !== undefined) {
          resolvedContext[entry.key] = entry.value.literalBoolean
        }
      }
    }

    // Fallback: collect all TextField values from the surface when no explicit context
    if (Object.keys(resolvedContext).length === 0) {
      const surface = processor.getSurfaces().get(surfaceId)
      if (surface) {
        for (const [compId, rawComp] of surface.components) {
          if (rawComp?.component?.TextField !== undefined) {
            const value = surface.dataModel.get(compId)
            if (value != null && value !== '') {
              resolvedContext[compId] = value
            }
          }
        }
      }
    }

    const userAction: UserAction = {
      actionName: action.name,
      sourceComponentId,
      timestamp: new Date().toISOString(),
      context: Object.keys(resolvedContext).length > 0 ? resolvedContext : undefined,
    }

    const toolCallId = pendingToolCallId.value
    if (toolCallId) {
      clearSurfaces()
      pendingToolCallId.value = null
      chatService
        .submitToolResult(toolCallId, JSON.stringify(userAction), activeCallbacks || undefined)
        .catch((err) => {
          console.error('[useA2UI] submitToolResult failed:', err)
        })
    }
  }

  return {
    surfaces,
    pendingToolCallId,
    processBatch,
    clearSurfaces,
    sendAction,
    setCallbacks,
    processor,
  }
}
