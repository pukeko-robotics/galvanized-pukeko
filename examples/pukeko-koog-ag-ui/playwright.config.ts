import { defineConfig, devices } from '@playwright/test';

// Koog AG-UI example e2e. Drives the vue web client (@galvanized-pukeko/web-client) on :5555,
// which is pointed at the Koog Ktor server (:3000) via AGUI_URL. The server + client are booted
// by `it-koog.js` (repo root); this config only runs the Playwright spec against the live pair.
export default defineConfig({
    testDir: './e2e-tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 3,
    workers: 1,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://localhost:5555',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
