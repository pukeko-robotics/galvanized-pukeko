import { test, expect } from '@playwright/test';

test.describe('Chat Interface', () => {
    test.beforeEach(async ({ page }) => {
        // Bespoke surface is opt-in via ?ui=bespoke now that the no-query
        // default is headless (PLAT-12). It renders `.chat-interface`.
        await page.goto('/?ui=bespoke');
        // Wait for initial load
        await expect(page.locator('.chat-interface')).toBeVisible();
    });

    test('should send message via button', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');
        const sendButton = page.locator('.input-area').getByRole('button', { name: 'Send' });

        await input.fill('Hello via Button. Your response must include word Button.');
        await sendButton.click();

        await expect(page.locator('.message.user', { hasText: 'Hello via Button' })).toBeVisible();

        await expect(page.locator('.is-loading')).not.toBeVisible({ timeout: 30000 });

        // Wait for AI response
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

        // Wait for AI response
        const aiMessage = page.locator('.message.ai').last();
        await expect(aiMessage).toBeVisible();
        await expect(aiMessage).not.toContainText('Error');
        await expect(aiMessage).toContainText('Enter');
    });

    test('should display helper text', async ({ page }) => {
        await expect(page.getByText('Click Send or press Enter to send your message')).toBeVisible();
    });

    // A2UI render coverage moved to the SURVIVING headless surface (chat-gth-headless.spec.ts, BE-5).
    // The bespoke ChatInterface path this spec exercises is defaulted away by PLAT-12 and deleted by
    // PLAT-13, so a bespoke A2UI render test would assert on a doomed surface; the previously
    // quarantined `should render A2UI form` fixme was removed with the fix rather than un-skipped here.
});
