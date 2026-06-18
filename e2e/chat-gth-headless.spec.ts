import { test, expect } from '@playwright/test';

// Headless mode (P2b increment 3): the bespoke-styled Pukeko chat primitives
// (PkInput / PkButton / bubbles) driven entirely by CopilotKit composables
// (useAgent + copilotkit.runAgent) over our AG-UI backend — no CopilotKit cloud
// runtime, no bespoke chatService. Selected at runtime via `?ui=headless`
// (see web-client src/main.ts -> PukekoCopilot uiMode).
//
// Selectors are the data-testids on HeadlessChat.vue.
test.describe('Chat Interface (Gaunt Sloth AG-UI, headless CopilotKit mode)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5555/?ui=headless');
        await expect(
            page.locator('[data-testid="pk-headless-chat"]')
        ).toBeVisible({ timeout: 30000 });
    });

    test('should stream an assistant reply through the headless Pukeko chat', async ({ page }) => {
        const input = page.locator('[data-testid="pk-headless-input"]');
        await input.click();
        await input.fill('Say the single word: pukeko');

        await page.locator('[data-testid="pk-headless-send"]').click();

        // User turn echoes into the transcript.
        await expect(
            page.locator('[data-testid="pk-headless-user"]', { hasText: 'pukeko' })
        ).toBeVisible({ timeout: 15000 });

        // Assistant bubble appears and accumulates non-empty streamed text.
        const assistant = page.locator('[data-testid="pk-headless-assistant"]').last();
        await expect(assistant).toBeVisible({ timeout: 60000 });
        await expect(assistant).toContainText(/pukeko/i, { timeout: 60000 });
    });
});
