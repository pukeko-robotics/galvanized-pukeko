import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
// OPS-8: this config sits two levels below the worktree root where the generated
// `.env` lives, and `pnpm --filter web-client dev` runs vite with cwd = the
// package dir — so we point loadEnv's envDir at the worktree root (`../..`,
// consistent with the vue-ui source aliases below) rather than process.cwd().
// That makes the committed `.env` (not just inline vars) shift the port. Inline
// env still wins (loadEnv overlays process.env after the file). Read at module
// top-level (not the `({ mode }) => …` callback form) so `vitest.config.ts` can
// still `mergeConfig` this as a plain object; only the base `.env` matters here
// (no `.env.[mode]` files), so the mode arg is immaterial. `WEB_PORT` ->
// server.port, `ADK_URL` -> the ADK config target; both fall back to today's
// values when unset. `AGUI_URL` stays on process.env (explicit modes only).
const env = loadEnv(
  process.env.NODE_ENV || 'development',
  fileURLToPath(new URL('../..', import.meta.url)),
  ''
)

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    {
      name: 'print-kitchensink',
      configureServer(server) {
        if (server.config.server.open) {
          console.log(`Kitchen sink: http://localhost:${server.config.server.port}${server.config.server.open}`);
        }
      }
    }
  ],
  define: {
    // Inject AG-UI URL at build time for Gaunt Sloth mode
    // Set AGUI_URL env var before building/serving (e.g., AGUI_URL=http://localhost:3000/ag-ui)
    __AGUI_URL__: JSON.stringify(process.env.AGUI_URL || ''),
    // OPS-8: ADK config endpoint (config.json mode). Shifts with ADK_PORT via the
    // ADK_URL var; defaults to today's http://localhost:8080.
    __ADK_URL__: JSON.stringify(env.ADK_URL || 'http://localhost:8080'),
  },
  build: {
    outDir: fileURLToPath(new URL('dist/client', import.meta.url)),
    emptyOutDir: true
  },
  resolve: {
    // NOTE: order matters — the more specific subpath aliases (incl. the
    // /copilot sub-export, P2b) must precede the bare package alias, which is a
    // prefix match. In dev we consume the vue-ui SOURCE directly (no build
    // step). The CopilotKit modes' CSS comes from component <style> blocks +
    // global.css, so /copilot/style.css maps to global.css here; the published
    // package serves the built dist/copilot.css via its exports map.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@galvanized-pukeko/vue-ui/style.css': fileURLToPath(new URL('../galvanized-pukeko-vue-ui/src/assets/global.css', import.meta.url)),
      '@galvanized-pukeko/vue-ui/copilot/style.css': fileURLToPath(new URL('../galvanized-pukeko-vue-ui/src/assets/global.css', import.meta.url)),
      '@galvanized-pukeko/vue-ui/copilot': fileURLToPath(new URL('../galvanized-pukeko-vue-ui/src/copilot.ts', import.meta.url)),
      '@galvanized-pukeko/vue-ui': fileURLToPath(new URL('../galvanized-pukeko-vue-ui/src', import.meta.url))
    }
    // NOTE (OPS-6): `preserveSymlinks: true` was removed during the pnpm
    // migration. Under pnpm's symlinked store it kept the symlinked path for
    // `vue`, so rolldown could not follow vue's nested `@vue/runtime-dom`
    // (resolved against the symlink dir, not the real `.pnpm` dir), failing the
    // production build. Default (false) lets resolution reach the real store
    // path where the sibling `@vue/*` packages live. The `@galvanized-pukeko/
    // vue-ui` source aliases above keep dev consuming the lib source directly.
  },
  server: {
    port: Number(env.WEB_PORT) || 5555
  }
});
