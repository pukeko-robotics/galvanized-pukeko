/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as copilotKit from '@copilotkit/vue/v2'
import * as copilotEntry from './copilot'

/**
 * PLAT-58: vue-ui owns the CopilotKit stack, so a host app pins only vue-ui.
 *
 * The workspace's one-copy guard (`gauntSlothAgent.spec.ts`) reads THIS repo's
 * install, which the lockfile holds steady. A host resolves vue-ui's manifest
 * afresh, so these specs pin the manifest itself: what a host's install is
 * guaranteed to produce, whatever else is on the registry that day.
 */

type Manifest = {
  version: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  exports?: Record<string, unknown>
}

const pkgDir = `${import.meta.dirname}/..`
const manifest = JSON.parse(readFileSync(`${pkgDir}/package.json`, 'utf8')) as Manifest
const here = createRequire(`${pkgDir}/package.json`)
const exact = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

describe('vue-ui pins the CopilotKit stack for its hosts (PLAT-58)', () => {
  it('ships @copilotkit/vue as an exact-pinned dependency, not a peer', () => {
    const pin = manifest.dependencies?.['@copilotkit/vue']
    expect(pin, '@copilotkit/vue must be a dependency').toBeTruthy()
    expect(pin, 'a range lets a host resolve a CopilotKit vue-ui never tested').toMatch(exact)
    expect(manifest.peerDependencies?.['@copilotkit/vue']).toBeUndefined()
  })

  /**
   * CopilotKit pins `@ag-ui/client` exactly and moves it between its own minors
   * (1.77.0 pins 1.0.1, 1.79.0 pins 1.0.2). A caret on vue-ui's side can then
   * resolve a newer copy than CopilotKit's, which loads two protocol
   * implementations into the host app, the PLAT-55 split. Equal exact pins rule
   * that out in every host install.
   */
  it('pins @ag-ui/client to exactly the version the pinned CopilotKit depends on', () => {
    const pin = manifest.dependencies?.['@copilotkit/vue']
    const installed = JSON.parse(
      readFileSync(here.resolve('@copilotkit/vue/package.json'), 'utf8'),
    ) as Manifest
    // Read the manifest of the CopilotKit vue-ui pins, not some other installed copy.
    expect(installed.version).toBe(pin)
    expect(manifest.dependencies?.['@ag-ui/client']).toMatch(exact)
    expect(manifest.dependencies?.['@ag-ui/client']).toBe(
      installed.dependencies?.['@ag-ui/client'],
    )
  })

  it('keeps vue a peer, so the host and vue-ui share one Vue', () => {
    expect(manifest.peerDependencies?.vue).toBeTruthy()
  })

  it('re-exports the CopilotKit pieces a host composes with, as the same objects', () => {
    expect(copilotEntry.CopilotKitProvider).toBe(copilotKit.CopilotKitProvider)
    expect(copilotEntry.HttpAgent).toBe(copilotKit.HttpAgent)
    expect(copilotEntry.useAgent).toBe(copilotKit.useAgent)
    expect(copilotEntry.useCopilotKit).toBe(copilotKit.useCopilotKit)
    expect(copilotEntry.useRenderTool).toBe(copilotKit.useRenderTool)
  })

  it("serves CopilotKit's stylesheet from vue-ui's own dependency", () => {
    const target = (manifest.exports as Record<string, string>)['./copilotkit/style.css']
    expect(target, 'the ./copilotkit/style.css export').toBeTruthy()
    const file = `${pkgDir}/${target}`
    expect(existsSync(file), `${target} is missing`).toBe(true)
    const imported = /@import\s+['"]([^'"]+)['"]/.exec(readFileSync(file, 'utf8'))?.[1]
    expect(imported).toBe('@copilotkit/vue/styles.css')
    // Resolvable from vue-ui's own location, which is where a host's bundler resolves it.
    expect(existsSync(createRequire(file).resolve(imported!))).toBe(true)
  })
})
