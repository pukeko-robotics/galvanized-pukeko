import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * A minimal Vite dev-server config for the theme override-wins Playwright
 * proof (see `theme.visual.spec.ts` and `harness.ts` in this directory). It
 * exists only to give the harness page real Vue SFC compilation + a real
 * browser CSS cascade — jsdom (the vitest unit suite's environment, see
 * `../src/theme.spec.ts`) never resolves `var()` inside `getComputedStyle`,
 * so no jsdom-based test can prove an override actually repaints anything.
 *
 * Deliberately NOT `../vite.config.ts` (the library's real build config,
 * which targets a `lib` bundle with no dev server / index.html entry) or the
 * repo-root `playwright.config.ts` (scoped to the web-client app's own e2e).
 */
export default defineConfig({
  root: __dirname,
  plugins: [vue()],
})
