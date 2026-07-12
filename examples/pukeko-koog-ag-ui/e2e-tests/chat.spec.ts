import { test, expect } from '@playwright/test';

// Same vue web client (@galvanized-pukeko/web-client) and selectors as the ADK e2e
// (root e2e/chat.spec.ts) — only the backend differs: here the AG-UI stream comes from
// the Koog Ktor server (koogAgent) via a real gemini-2.5-flash streamed reply.
//
// koogAgent is a pure text streamer: it binds no tools and drops ToolCall frames, so this
// spec covers ONLY the text round-trip (Button / Enter) + static UI. No A2UI-surface test.
test.describe('Koog AG-UI Chat Interface', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.chat-interface')).toBeVisible();
    });

    test('should send message via button', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');
        const sendButton = page.locator('.input-area').getByRole('button', { name: 'Send' });

        await input.fill('Hello via Button. Your response must include word Button.');
        await sendButton.click();

        await expect(page.locator('.message.user', { hasText: 'Hello via Button' })).toBeVisible();
        await expect(page.locator('.is-loading')).not.toBeVisible({ timeout: 30000 });

        const aiMessage = page.locator('.message.ai').last();
        await expect(aiMessage).toBeVisible();
        await expect(aiMessage).not.toContainText('Error');
        await expect(aiMessage).toContainText('Button');
    });

    test('should send message via Enter key', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');

        await input.fill('Hello via Enter. Your response must include word Enter.');
        await input.press('Enter');

        await expect(page.locator('.message.user', { hasText: 'Hello via Enter' })).toBeVisible();
        await expect(page.locator('.is-loading')).not.toBeVisible({ timeout: 30000 });

        const aiMessage = page.locator('.message.ai').last();
        await expect(aiMessage).toBeVisible();
        await expect(aiMessage).not.toContainText('Error');
        await expect(aiMessage).toContainText('Enter');
    });

    test('should display helper text', async ({ page }) => {
        await expect(page.getByText('Click Send or press Enter to send your message')).toBeVisible();
    });
});
