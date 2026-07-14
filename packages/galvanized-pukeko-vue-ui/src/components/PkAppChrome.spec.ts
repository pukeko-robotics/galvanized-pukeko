import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

/**
 * PLAT-20: the shared app chrome (header/nav + footer) that both bespoke CoreApp
 * and the headless shell wrap their main content in. configService is a loaded-
 * once singleton in the real app; here we mock it so `get()` yields a known
 * config with a logo, header nav links, and footer links.
 */
const fixtureConfig = {
  agUiUrl: 'http://localhost/agents/default/run',
  pageTitle: 'Pukeko Test',
  logo: { text: 'Pukeko', href: 'https://pukeko.example' },
  header: [
    { text: 'Docs', href: 'https://docs.example' },
    { text: 'About', href: 'https://about.example' },
  ],
  footer: [{ text: 'Privacy', href: 'https://privacy.example' }],
}

vi.mock('../services/configService', () => ({
  configService: { get: () => fixtureConfig },
}))

import PkAppChrome from './PkAppChrome.vue'

describe('PkAppChrome (PLAT-20 shared chrome)', () => {
  it('mounts the PkNavHeader with the config-driven logo + nav links', () => {
    const wrapper = mount(PkAppChrome, {
      slots: { default: '<div class="slotted-main">MAIN</div>' },
    })

    // Header shell + PkNavHeader present.
    expect(wrapper.find('#galvanized-pukeko-ui-nav-header').exists()).toBe(true)
    expect(wrapper.find('.nav-wrapper').exists()).toBe(true)

    // Config-driven logo (a PkNavItem, not the fallback PkLogo).
    const header = wrapper.find('#galvanized-pukeko-ui-nav-header')
    expect(header.text()).toContain('Pukeko')

    // Config-driven header nav links.
    const navLinks = wrapper.findAll('.nav-link-item')
    expect(navLinks).toHaveLength(2)
    expect(navLinks[0].text()).toContain('Docs')
    expect(navLinks[1].text()).toContain('About')
  })

  it('renders the config-driven footer', () => {
    const wrapper = mount(PkAppChrome)
    const footer = wrapper.find('#galvanized-pukeko-ui-nav-footer')
    expect(footer.exists()).toBe(true)
    const footerItems = wrapper.findAll('.footer-item')
    expect(footerItems).toHaveLength(1)
    expect(footerItems[0].text()).toContain('Privacy')
  })

  it('renders the default slot as the main content, plus both sidebars', () => {
    const wrapper = mount(PkAppChrome, {
      slots: { default: '<div class="slotted-main">MAIN</div>' },
    })
    expect(wrapper.find('.app-main-content .slotted-main').exists()).toBe(true)
    expect(wrapper.find('#galvanized-pukeko-ui-nav-left-sidebar').exists()).toBe(true)
    expect(wrapper.find('#galvanized-pukeko-ui-nav-right-sidebar').exists()).toBe(true)
  })
})
