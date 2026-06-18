import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
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
    },
    preserveSymlinks: true
  },
  server: {
    port: 5555
  }
});
