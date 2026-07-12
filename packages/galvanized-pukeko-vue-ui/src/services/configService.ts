interface UiConfigItem {
  text?: string
  href?: string
  img?: string
}

export interface UiConfig {
  agUiUrl: string
  appName?: string
  pageTitle?: string
  configUrl?: string
  logo?: UiConfigItem
  header?: UiConfigItem[]
  footer?: UiConfigItem[]
}

class ConfigService {
  private config: UiConfig | null = null

  async load(): Promise<void> {
    // Check for build-time embedded config (Gaunt Sloth mode)
    // @ts-expect-error Vite define injects this at build time
    const builtInAgUiUrl = typeof __AGUI_URL__ !== 'undefined' ? __AGUI_URL__ : undefined
    if (builtInAgUiUrl && builtInAgUiUrl !== '') {
      this.config = {
        agUiUrl: builtInAgUiUrl,
        appName: 'Gaunt Sloth',
      }
      console.log('[ConfigService] Using build-time AG-UI URL:', builtInAgUiUrl)
      return
    }

    try {
      const response = await fetch('/config.json')
      if (!response.ok) {
        throw new Error(response.statusText)
      }
      const config = await response.json()
      // OPS-8: allow the ADK config endpoint to be overridden at build time via
      // __ADK_URL__ (from ADK_URL/ADK_PORT in the web-client build). When defined
      // it wins over config.json's static configUrl so the target tracks a shifted
      // ADK port; at offset 0 it equals http://localhost:8080/config.json, i.e. the
      // committed static value (byte-identical). Undefined (vue-ui built standalone
      // or consumed by the robot controller) keeps the original behavior.
      // @ts-expect-error Vite define injects this at build time
      const builtInAdkUrl = typeof __ADK_URL__ !== 'undefined' ? __ADK_URL__ : ''
      const effectiveConfigUrl = builtInAdkUrl ? `${builtInAdkUrl}/config.json` : config.configUrl
      if (effectiveConfigUrl) {
        const fallbackResponse = await fetch(effectiveConfigUrl);
        if (!fallbackResponse.ok) {
          throw new Error(fallbackResponse.statusText)
        }
        this.config = await fallbackResponse.json() as UiConfig;
        console.log('[ConfigService] Fallback configuration loaded:', this.config)
      } else {
        this.config = config as UiConfig
        console.log('[ConfigService] Configuration loaded:', this.config)
      }

      // Backward compatibility: if config has baseUrl but no agUiUrl, derive it
      // Uses the AG-UI standard path /agents/{agentId}/run
      if (!this.config!.agUiUrl && (this.config as any).baseUrl) {
        this.config!.agUiUrl = `${(this.config as any).baseUrl}/agents/default/run`
        console.log('[ConfigService] Derived agUiUrl from baseUrl:', this.config!.agUiUrl)
      }
    } catch (error) {
      throw new Error(`Failed to load configuration:${(error as Error).message || error}`);
    }
  }

  get(): UiConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() before accessing config.')
    }
    return this.config
  }
}

export const configService = new ConfigService()
