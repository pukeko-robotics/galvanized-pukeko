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
    // QA-37 — THE EFFECTIVE TEST BUDGET, stated here because this is the only place that
    // decides it. With no `timeout` key Playwright's 30 000 ms default governs, and a
    // per-assertion budget larger than what is left of it is unreachable decoration: the test
    // dies at 30 000 while its call log counts toward a number it could never have been given,
    // and anyone diagnosing the failure from the source reasons from the wrong figure.
    //
    // 50 000 ms is the sum of the per-step budgets of the longest test in `e2e-tests/chat.spec.ts`
    // (5 000 beforeEach + 5 000 echo + 20 000 answer starts + 5 000 the word + 3 000 Error
    // = 38 000) plus 12 000 of slack, so no per-assertion timeout in that spec is fiction. Each
    // of those steps is sized from a measurement recorded in the spec beside it — 45 samples,
    // warm and cold, against this harness's own provider — and NOT from the root config's
    // number, which governs a different surface and a different backend. The slack absorbs
    // fixture setup and `page.goto`'s own navigation timeout, which is not one of the budgets
    // in that sum; the spec says what follows from that.
    //
    // This is a backstop, not the working budget: the per-assertion timeouts fire first and each
    // names its own step, so a hung step reds at its own budget with a message saying which one,
    // instead of every failure arriving as one anonymous test timeout.
    timeout: 50_000,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        // OPS-8: track the shifted vite port (WEB_PORT); it-koog.js loads `.env`.
        baseURL: `http://localhost:${process.env.WEB_PORT || 5555}`,
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
