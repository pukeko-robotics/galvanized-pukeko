import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * Separate build for the `@galvanized-pukeko/vue-ui/copilot` sub-export (P2b
 * increment 4). Kept apart from the root build so the core library never bundles
 * `@copilotkit/vue`: this entry externalizes it (and our own deps), shipping ES
 * + CJS only (no UMD — the CopilotKit modes target bundler-based apps). The root
 * `vite.config.ts` build runs first with `emptyOutDir`; this one appends to the
 * same `dist/` without clearing it.
 *
 * This build emits JS and CSS only — no declarations. The root build's dts pass
 * already covers all of `src/`, so it writes `dist/copilot.d.ts` and the
 * `copilot/` + `a2ui` supporting declarations itself; a dts pass here re-emitted
 * a byte-identical subset over the top. Declarations therefore have exactly one
 * producer, and this build must keep running after the root one (the `build`
 * script orders them). See `vite.config.ts` for why the tree is not bundled.
 */
export default defineConfig({
  plugins: [vue()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/copilot.ts'),
      name: 'GalvanizedPukekoVueCopilot',
      formats: ['es', 'cjs'],
      fileName: (format) => `copilot.${format === 'es' ? 'es.js' : 'cjs'}`,
    },
    rollupOptions: {
      external: ['vue', 'chart.js', '@ag-ui/client', /^@copilotkit\/vue/],
      output: {
        globals: {
          vue: 'Vue',
          'chart.js': 'Chart',
          '@ag-ui/client': 'AgUiClient',
        },
        // Emit this entry's CSS as copilot.css so it does NOT clobber the root
        // build's vue-ui.css (both builds write into the same dist/).
        assetFileNames: (asset) =>
          asset.names?.some((n) => n.endsWith('.css')) ? 'copilot.css' : '[name][extname]',
      },
    },
    outDir: 'dist',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
