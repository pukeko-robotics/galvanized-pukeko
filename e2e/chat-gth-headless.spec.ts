import { test, expect } from '@playwright/test';

// PLAT-18: the capture_image round-trip needs a camera. Chromium's fake camera
// (a rolling test pattern) stands in for hardware, and the fake UI flag
// auto-grants the getUserMedia permission prompt. Scoped to this file only —
// the root playwright.config leaves media defaults untouched.
test.use({
    permissions: ['camera'],
    launchOptions: {
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
        ],
    },
});

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

    // PLAT-18: the shared `capture_image` client tool, registered from vue-ui
    // (createCaptureImageFrontendTool via CopilotKitProvider's frontendTools),
    // round-trips on the headless CopilotKit path against the live gth AG-UI
    // backend: the model calls the tool → the server (which has NO capture_image
    // of its own — the run-input declaration alone binds the interrupt stub)
    // suspends the graph → CopilotKit runs the client handler (fake-camera
    // getUserMedia frame → {mimeType,data} envelope) and re-runs with the result
    // as a trailing tool message → the server resumes the suspended run → the
    // model answers from the image. Also RC-14's attach-gap proof for headless:
    // the expanded ToolCallBadge must show the client-fulfilled result.
    test('round-trips the shared capture_image client tool (interrupt → frame → resume)', async ({ page }) => {
        const input = page.locator('[data-testid="pk-headless-input"]');
        await input.click();
        await input.fill(
            'Call the capture_image tool exactly once, then briefly describe the returned image.'
        );
        await page.locator('[data-testid="pk-headless-send"]').click();

        // The tool call surfaces as a badge in the transcript.
        const badge = page.locator('.tool-call-badge', { hasText: 'capture_image' });
        await expect(badge).toBeVisible({ timeout: 60000 });

        // The agent RESUMES past the interrupt: a non-empty assistant text
        // follows the tool call (the model's description of the frame).
        await expect(
            page.locator('[data-testid="pk-headless-assistant"] .text-part').last()
        ).not.toBeEmpty({ timeout: 60000 });

        // Expanding the badge shows the client-fulfilled result — the image
        // envelope produced by the fake camera (headless attach-gap closed).
        await badge.locator('.tool-call-header').click();
        await expect(badge.locator('.tool-call-body')).toContainText('mimeType', {
            timeout: 15000,
        });
        await expect(badge.locator('.tool-call-body')).toContainText('image/jpeg');
    });

    // BE-5's A2UI render coverage is machine-checkable and lives outside this file:
    //   - agent-adk AdkLocalAgentA2uiWireTest: the TOOL_CALL_RESULT frame carries the
    //     raw A2UI JSONL (wire-level SSE capture, was a Java Map.toString());
    //   - vue-ui HeadlessChatA2UI.spec.ts: the headless client renders A2UI from a
    //     raw-JSONL tool result (component-level).
    // The remaining seam — CopilotKit HttpAgent projecting TOOL_CALL_RESULT.content
    // into the `tool` message the client reads — is exercised only by a live browser
    // against the full stack, and is deliberately not covered here (BE-8).
});
