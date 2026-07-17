import { test, expect } from '@playwright/test'
import { defaultTheme } from '../src/theme'
import { emeraldExample } from '../src/theme.fixtures'
// Type-only: pulls in harness.ts's `declare global { interface Window { ... } }`
// augmentation so `window.__pkThemeHarness` below is typed instead of `any`.
import type {} from './harness'

// Real-browser proof that applyTheme() actually repaints a mounted render.
//
// theme.spec.ts (the vitest/jsdom unit suite) proves "override wins" only by
// composition: source `.toContain()` checks that an SFC references the right
// `var(--pk-color-X, ...)` string, plus direct `style.getPropertyValue` checks
// on a bare `<div>`, plus the CSS-cascade logic reasoned about in isolation.
// None of that mounts a real component and reads its actual rendered colour,
// because jsdom never resolves `var()` inside `getComputedStyle` — a
// jsdom-based mount test would silently pass even if an SFC's CSS were wrong
// (e.g. a typo'd token name, or a fallback that doesn't match the default).
// This test closes that gap in a real Chromium render.
//
// Reuses the exact `emeraldExample` object from theme.spec.ts's worked-example
// block (both now import it from `../src/theme.fixtures`, so they can't drift
// apart) and asserts the actual computed colour of two real migrated
// components — ChatInterface's user bubble (--pk-color-primary) and
// ToolCallBadge's header (--pk-color-info-text) — before, during, and after
// the override.

function hexToRgb(hex: string): string {
  const n = hex.replace('#', '')
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgb(${r}, ${g}, ${b})`
}

const DEFAULT_PRIMARY = hexToRgb(defaultTheme['--pk-color-primary'])
const DEFAULT_INFO_TEXT = hexToRgb(defaultTheme['--pk-color-info-text'])
const EMERALD_PRIMARY = hexToRgb(emeraldExample['--pk-color-primary']!)
const EMERALD_INFO_TEXT = hexToRgb(emeraldExample['--pk-color-info-text']!)

test('applyTheme(emeraldExample) changes the actual rendered colour of mounted components, and resetTheme reverts it', async ({
  page,
}) => {
  await page.goto('/')

  // Render a user message so ChatInterface's `.message.user .message-content`
  // (background-color: var(--pk-color-primary, ...)) is actually in the DOM.
  await page.evaluate(() => window.__pkThemeHarness.sendChatMessage('hello from the harness'))

  const userBubble = page.locator('.message.user .message-content')
  const badgeHeader = page.locator('.tool-call-header')
  await expect(userBubble).toBeVisible()
  await expect(badgeHeader).toBeVisible()

  // 1. Default render (no override written): resolves via global.css's :root
  // block, which the harness imports exactly like a real consumer app would.
  await expect(userBubble).toHaveCSS('background-color', DEFAULT_PRIMARY)
  await expect(badgeHeader).toHaveCSS('color', DEFAULT_INFO_TEXT)
  // Sanity the two constants aren't accidentally equal (would make the assertions below vacuous).
  expect(EMERALD_PRIMARY).not.toBe(DEFAULT_PRIMARY)
  expect(EMERALD_INFO_TEXT).not.toBe(DEFAULT_INFO_TEXT)

  // 2. Apply the override — the exact emeraldExample object from theme.spec.ts.
  await page.evaluate((theme) => window.__pkThemeHarness.applyTheme(theme), emeraldExample)

  await expect(userBubble).toHaveCSS('background-color', EMERALD_PRIMARY)
  await expect(badgeHeader).toHaveCSS('color', EMERALD_INFO_TEXT)

  // 3. Undo: resetTheme() reverts both mounted components to the default paint.
  await page.evaluate(() => window.__pkThemeHarness.resetTheme())

  await expect(userBubble).toHaveCSS('background-color', DEFAULT_PRIMARY)
  await expect(badgeHeader).toHaveCSS('color', DEFAULT_INFO_TEXT)
})
