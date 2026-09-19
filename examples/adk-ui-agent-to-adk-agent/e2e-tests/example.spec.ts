import { test, expect } from '@playwright/test';

// QA-37 — READ THIS BEFORE TRUSTING A GREEN RUN OF THIS FILE.
//
// THE ONE TEST BELOW PASSES WITH THE AGENT COMPLETELY ABSENT. That is measured, not argued.
// The browser bundle was extracted from the PUBLISHED
// `io.github.galvanized-pukeko:galvanized-pukeko-agent-adk:0.0.3` jar — the artefact
// `demo-ui-agent` actually depends on — and served on :8080 by a static file server with
// nothing behind it, so `/agents/default/run` did not exist. This spec, unchanged, reported
// `1 passed` in 131 ms.
//
// WHY IT PASSES. `ChatInterface` pushes a permanent greeting into the transcript on mount, and
// the template gives every assistant message `class="message ai"`. So `.message.ai` `.last()`
// IS that greeting until a reply exists, `toBeVisible()` resolves on it immediately, and
// `not.toContainText('Error')` — the only content assertion in the file — is satisfied by
// `Hello! How can I help you today?`. A probe against the dead server confirmed each step:
// `.message.ai` count 1, its text the greeting, `.message.notice` count 0. There is no
// positive assertion about the reply anywhere, so nothing here can distinguish a working
// agent from no agent at all.
//
// WHAT IS *NOT* WRONG WITH IT, so nobody spends the same hour twice. The bare
// `goto('http://localhost:8080')` with no `?ui=` query is CORRECT for this surface, and this
// file does NOT have the defect QA-37 fixed in the koog example. That jar's bundle predates
// PLAT-12 and carries no UI-mode selection at all — grepped for `resolveMode`, `bespoke` and
// `headless`, none present — so `/` really is the surface that renders `.chat-interface`. The
// koog example needed the query because it drives the vite web client, which does select.
//
// WHAT IS WRONG AND IS NOT FIXED HERE. `../playwright.config.ts` states no `timeout`, so every
// test in this directory runs on Playwright's 30 000 ms default with a real model round trip
// behind it. That is a real defect. It is left alone deliberately rather than guessed at: a
// budget is only worth what the measurement behind it is worth, and this example cannot be run
// from the QA-37 lane's position — it needs Maven, both ADK agents booted, a Google AI Studio
// key, and it sits behind a known A2A `:8082` failure. A number picked without samples is the
// thing that ticket exists to prevent.
//
// The repair — the vacuity first, the timeout second — is filed as QA-39, with this
// measurement as its evidence. Until it lands, a green run of this file means the page mounted
// and the greeting rendered. It does not mean the agents work.

test.describe('Example Project E2E', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:8080');
        // Wait for initial load
        await expect(page.locator('.chat-interface')).toBeVisible();
    });

    test('should send message and get response from demo-agent', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');
        const sendButton = page.locator('.input-area').getByRole('button', { name: 'Send' });

        await input.fill('Hello from E2E test');
        await sendButton.click();

        await expect(page.locator('.message.user', { hasText: 'Hello from E2E test' })).toBeVisible();

        // Wait for AI response
        const aiMessage = page.locator('.message.ai').last();
        await expect(aiMessage).toBeVisible();
        await expect(aiMessage).not.toContainText('Error');
    });
});
