import { test, expect } from '@playwright/test';

// Stock-UI mode (P2b increment 1): CopilotKit's CopilotChat over our AG-UI
// backend, selected at runtime via `?ui=stock` (see src/main.ts). This proves
// a user message actually streams an assistant reply through CopilotChat — no
// CopilotKit cloud runtime, same AG-UI / HTTP-SSE wire as the bespoke UI.
//
// Selectors come from @copilotkit/vue source (CopilotChatInput.vue /
// CopilotChatAssistantMessage.vue):
//   - textarea: [data-testid="copilot-chat-input-textarea"]
//   - send:     [data-testid="copilot-chat-input-send"]
//   - assistant message body: [data-testid="copilot-assistant-message"]
//   - user message: [data-testid="copilot-user-message"]
test.describe('Chat Interface (Gaunt Sloth AG-UI, stock CopilotKit UI)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5555/?ui=stock');
        await expect(
            page.locator('[data-testid="copilot-chat-input-textarea"]')
        ).toBeVisible({ timeout: 30000 });
    });

    test('should stream an assistant reply through CopilotChat', async ({ page }) => {
        const input = page.locator('[data-testid="copilot-chat-input-textarea"]');

        await input.click();
        await input.fill('Say the single word: pukeko');

        const sendButton = page.locator('[data-testid="copilot-chat-input-send"]');
        await expect(sendButton).toBeEnabled({ timeout: 10000 });
        await sendButton.click();

        // User message echoes into the transcript.
        await expect(
            page.locator('[data-testid="copilot-user-message"]', { hasText: 'pukeko' })
        ).toBeVisible({ timeout: 15000 });

        // An assistant message appears and accumulates non-empty streamed text.
        const assistant = page.locator('[data-testid="copilot-assistant-message"]').last();
        await expect(assistant).toBeVisible({ timeout: 60000 });
        await expect(assistant).toContainText(/pukeko/i, { timeout: 60000 });
    });
});
