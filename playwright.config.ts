import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 3,
  workers: 1,
  reporter: [
    ['list'], // You can keep other reporters
    ['html', { open: 'never' }]
  ],
  use: {
    // OPS-8: track the shifted vite port (WEB_PORT); the it-*.js harnesses load `.env`.
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
