import { test, expect } from '@playwright/test';

// Headless mode (P2b increment 3): the bespoke-styled Pukeko chat primitives
// (PkInput / PkButton / bubbles) driven entirely by CopilotKit composables
// (useAgent + copilotkit.runAgent) over our AG-UI backend — no CopilotKit cloud
// runtime, no bespoke chatService.
//
// Since PLAT-12 headless is the NO-QUERY DEFAULT surface, so this spec navigates
// to `/` with no `?ui=` to prove the default resolves to headless (the `?ui=`
// overrides are covered by chat[-gth].spec.ts for bespoke and
// chat-gth-stock.spec.ts for stock).
//
// Selectors are the data-testids on HeadlessChat.vue.
test.describe('Chat Interface (Gaunt Sloth AG-UI, headless default, no ?ui)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
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

    // BE-5 live render-proof for the SURVIVING headless path. The ADK
    // `show_a2ui_surface` tool result now reaches the client as raw A2UI JSONL
    // (was a Java Map.toString(), which parseA2UIJsonl choked on), so the surface
    // renders in the headless panel (default a2uiTarget). The machine-checkable
    // core of the fix is already proven without a live model:
    //   - agent-adk AdkLocalAgentA2uiWireTest: the TOOL_CALL_RESULT frame carries
    //     the raw JSONL (wire-level SSE capture);
    //   - vue-ui HeadlessChatA2UI.spec.ts: the headless client renders A2UI from a
    //     raw-JSONL tool result (component-level).
    // The one seam only a live browser can exercise is CopilotKit HttpAgent mapping
    // TOOL_CALL_RESULT.content → the `tool` message content the client reads. That
    // needs the full stack (ADK server + web client + live Google model + browser),
    // which does not boot in the worktree, so this is left `.fixme`: un-fixme and
    // validate it against the live e2e stack post-merge (BE-5 attention item).
    test.fixme('renders an A2UI surface in the headless panel (live render-proof)', async ({ page }) => {
        const input = page.locator('[data-testid="pk-headless-input"]');
        await input.click();
        await input.fill('Show me a contact form with a name and an email field using the show_a2ui_surface tool');
        await page.locator('[data-testid="pk-headless-send"]').click();

        // The surface renders in the default (panel) A2UI target.
        await expect(page.locator('.a2ui-surface')).toBeVisible({ timeout: 60000 });
    });
});
