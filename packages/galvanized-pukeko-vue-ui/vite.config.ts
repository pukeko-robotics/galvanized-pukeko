import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'unplugin-dts/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // This build owns the package's ENTIRE declaration surface: it emits a
    // per-file tree over all of src/, which is where dist/index.d.ts,
    // dist/copilot.d.ts and every sibling they import from come from. The
    // copilot build emits no declarations at all — see vite.copilot.config.ts.
    //
    // The tree is deliberately NOT bundled. Bundling is unavailable here, not
    // merely unconfigured: each config declares a single lib entry, so the
    // plugin takes its rollup target from package.json `types` for BOTH builds
    // — bundling the copilot build would overwrite this build's index.d.ts —
    // while bundling this build alone unlinks the per-file tree that
    // dist/copilot.d.ts imports from, leaving the ./copilot entry dangling.
    // Bundling both would mean collapsing the two builds into one multi-entry
    // lib build, which is what keeps @copilotkit/vue out of the core bundle.
    // It also needs the optional peer @microsoft/api-extractor, which we do not
    // install and which merely logs and skips when absent.
    //
    // Spell options exactly as unplugin-dts spells them. Its bundling option is
    // `bundleTypes`; the predecessor vite-plugin-dts called it `rollupTypes`,
    // and an unrecognised key is silently discarded — so a stale name here
    // reads as a setting while doing nothing at all.
    dts({
      insertTypesEntry: true,
      // Specs and their fixtures are still type-checked — the `type-check`
      // script covers all of src/ — but must not reach the published dist/.
      exclude: ['src/**/*.spec.ts', 'src/theme.fixtures.ts'],
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'GalvanizedPukekoVue',
      fileName: (format) => `vue-ui.${format}.js`,
    },
    rollupOptions: {
      external: ['vue', 'chart.js', '@ag-ui/client'],
      output: {
        globals: {
          vue: 'Vue',
          'chart.js': 'Chart',
          '@ag-ui/client': 'AgUiClient'
        },
      },
    },
    outDir: 'dist',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
});
