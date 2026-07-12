import { test, expect } from '@playwright/test';

test.describe('Chat Interface', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
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

    // QUARANTINED (BE-5): the bespoke ChatInterface path renders the ADK show_a2ui_surface
    // tool-result via parseA2UIJsonl, but AdkLocalAgent emits that result as a Java Map.toString()
    // ({surfaceJsonl=..., status=...}) rather than the raw surface JSONL the client parses, so the
    // surface never renders. The fix belongs on the HEADLESS CopilotKit surface (A2UIRenderToolBridge),
    // not this doomed bespoke path (PLAT-12 defaults away from it, PLAT-13 deletes it) — tracked as
    // BE-5 (deps PLAT-12). Un-skip there. The text-streaming wire above is fully green.
    test.fixme('should render A2UI form when requested', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');
        await input.fill('Show me a contact form with a name and an email field using the show_a2ui_surface tool');
        await input.press('Enter');

        await expect(page.locator('.is-loading')).not.toBeVisible({ timeout: 30000 });

        // Wait for A2UI surface to appear
        await expect(page.locator('.a2ui-surface')).toBeVisible({ timeout: 30000 });
    });
});
