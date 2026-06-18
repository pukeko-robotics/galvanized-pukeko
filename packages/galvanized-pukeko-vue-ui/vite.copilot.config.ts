import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'unplugin-dts/vite'

/**
 * Separate build for the `@galvanized-pukeko/vue-ui/copilot` sub-export (P2b
 * increment 4). Kept apart from the root build so the core library never bundles
 * `@copilotkit/vue`: this entry externalizes it (and our own deps), shipping ES
 * + CJS only (no UMD — the CopilotKit modes target bundler-based apps). The root
 * `vite.config.ts` build runs first with `emptyOutDir`; this one appends to the
 * same `dist/` without clearing it.
 */
export default defineConfig({
  plugins: [
    vue(),
    dts({
      insertTypesEntry: false,
      // Per-file emit (not rolled up): produces dist/copilot.d.ts plus the
      // copilot/ + a2ui supporting declarations, without clobbering the root
      // build's rolled-up index.d.ts.
      rollupTypes: false,
      include: ['src/copilot.ts', 'src/copilot/**', 'src/components/a2ui/**'],
      exclude: ['src/**/*.spec.ts'],
    }),
  ],
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
