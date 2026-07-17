import { defineConfig, devices } from '@playwright/test'

// Real-browser proof that PLAT-23 theme overrides actually repaint a mounted
// component (see e2e/theme.visual.spec.ts + e2e/harness.ts). Scoped to this
// package: NOT the repo-root playwright.config.ts (that one's testDir is
// `./e2e` at the galvanized-pukeko repo root, scoped to the web-client app's
// own e2e suite — an unrelated, larger surface). This config's `webServer`
// serves a tiny standalone harness page via `e2e/vite.harness.config.ts`,
// not the library's real `vite.config.ts` (which builds a `lib` bundle, not a
// dev server with an index.html entry).
//
// Kept out of `pnpm test` (= `vitest run`, jsdom, fast, CI's default gate):
// a real Chromium launch + dev server has different setup/teardown and is
// slower. Run via the separate `pnpm test:visual` script.
const PORT = 4319

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm exec vite --config e2e/vite.harness.config.ts --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
