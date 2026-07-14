import { test, expect } from '@playwright/test';

test.describe('Chat Interface (Gaunt Sloth AG-UI)', () => {
    test.beforeEach(async ({ page }) => {
        // Bespoke surface is opt-in via ?ui=bespoke now that the no-query
        // default is headless (PLAT-12). It renders `.chat-interface`.
        await page.goto('/?ui=bespoke');
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

        await input.fill('What does the Enter key do on a keyboard? Reply in one sentence.');
        await input.press('Enter');

        await expect(page.locator('.message.user', { hasText: 'What does the Enter key do' })).toBeVisible();

        await expect(page.locator('.is-loading')).not.toBeVisible({ timeout: 30000 });

        const aiMessage = page.locator('.message.ai').last();
        await expect(aiMessage).toBeVisible();
        await expect(aiMessage).not.toContainText('Error');
        await expect(aiMessage).toContainText('Enter');
    });

    test('should use identity from system prompt', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');
        await input.fill('What is your name? Reply in one sentence.');
        await input.press('Enter');
        await expect(page.locator('.is-loading')).not.toBeVisible({ timeout: 30000 });
        const aiMessage = page.locator('.message.ai').last();
        await expect(aiMessage).toContainText('Gaunt Sloth');
    });

    test('should render an A2UI surface via show_a2ui_surface', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');
        await input.fill(
            'Use the show_a2ui_surface tool now. Call it with this exact surfaceJsonl:\n' +
            '{"surfaceUpdate":{"surfaceId":"s1","components":[{"id":"t1","component":{"Text":{"text":{"literalString":"Name"}}}},{"id":"r","component":{"Column":{"children":{"explicitList":["t1"]}}}}]}}\n' +
            '{"beginRendering":{"surfaceId":"s1","root":"r"}}'
        );
        await input.press('Enter');

        await expect(page.locator('.is-loading')).not.toBeVisible({ timeout: 60000 });

        // A2UI surface should appear in the right panel
        await expect(page.locator('.a2ui-surface')).toBeVisible({ timeout: 10000 });
    });
});
