import { test, expect } from '@playwright/test';

// QA-39 — WHY NOTHING IN THIS FILE ASSERTS ON `.last()`.
//
// `ChatInterface` pushes a permanent greeting into the transcript on mount, and the template
// gives it `class="message ai"` — the same class a reply gets. So `.message.ai` is NON-EMPTY
// before anything is sent, `.last()` resolves to the greeting for as long as no reply exists,
// and any assertion hung off it is satisfied by `Hello! How can I help you today?`. This test
// used to do exactly that, with a single negative content assertion, and it reported
// `1 passed` in 131 ms against a browser bundle served with NOTHING behind it: the bundle
// extracted from the published `io.github.galvanized-pukeko:galvanized-pukeko-agent-adk:0.0.3`
// jar — the artefact `demo-ui-agent` actually depends on — with `/agents/default/run`
// returning 404. A green run meant the page had mounted. It did not mean the agents worked.
//
// The reply is therefore addressed BY INDEX. The greeting is index 0, so the first reply is
// index 1, and no amount of waiting can confuse that with the fixture. The same dead-surface
// measurement run against this file now FAILS, and that is the property to preserve: if you
// change these locators, re-measure it before you trust a green run.
//
// THE STRING `Error` IS LOAD-BEARING. This surface has no separate failure channel. Both
// failure paths push an ORDINARY `.message.ai` bubble, already `done`, with no distinguishing
// class: the stream's `onError` pushes `Error: <message>`, and a POST that throws pushes
// `Error sending message. Please try again.`. Against the dead surface that bubble appears
// about 100 ms after the click, so index 1 EXISTS there — what tells a working agent from an
// absent one is that word. If the app's copy changes, this test goes quietly vacuous again;
// change it here in the same commit.
//
// IF THIS GOES RED ON AN EMPTY `.message-content` WITH THE AGENTS RUNNING, the cause is
// upstream of this file. The 0.0.3 bundle hands its subscriber the accumulated text buffer
// BEFORE the current delta is appended, and its `TEXT_MESSAGE_END` handler does not flush, so
// the rendered reply trails one delta and a reply arriving as a single chunk renders as an
// empty bubble. That is the discriminator if you are bisecting it: a multi-delta stream
// renders non-empty (minus its last token), a single-delta one renders blank, and the agent
// emits one delta per streamed chunk. Current `vue-ui` flushes on END; this example pins the
// old jar, so the example carries the bug. An empty
// bubble is a failed turn as far as the user is concerned, so the assertion stays — fix it by
// moving the example to a jar that carries the flush.
//
// THERE IS NO `.message.notice` ON THIS SURFACE, so do not "improve" this file by asserting on
// one. The 0.0.3 bundle contains neither the class nor a CSS rule for it. The notice kind
// arrived later in `vue-ui`, and even there it carries a deliberate interrupt ("Stopped by
// you"), not a failed turn — a failure is still an `Error:` bubble. An assertion that
// `.message.notice` has count 0 could not fail here, which is the same family of defect as the
// one above.
//
// WHAT IS *NOT* WRONG WITH IT, so nobody spends the same hour twice. The bare
// `goto('http://localhost:8080')` with no `?ui=` query is CORRECT for this surface. That jar's
// bundle predates PLAT-12 and carries no UI-mode selection at all — grepped for `resolveMode`,
// `bespoke` and `headless`, none present — so `/` really is the surface that renders
// `.chat-interface`. The koog example needs the query because it drives the vite web client,
// which does select.
//
// WHAT IS STILL WRONG AND IS NOT FIXED HERE. `../playwright.config.ts` states no `timeout`, so
// every test in this directory runs on Playwright's 30 000 ms default with a real model round
// trip behind it. That is left alone deliberately rather than guessed at: sizing it honestly
// needs Maven, both ADK agents booted, a Google AI Studio key, and it sits behind a known A2A
// `:8082` failure. A number picked without samples is the thing QA-37 exists to prevent.

// The greeting the app pushes on mount — the fixture every assertion below has to get past.
const GREETING = 'Hello! How can I help you today?';

test.describe('Example Project E2E', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:8080');
        // Wait for initial load
        await expect(page.locator('.chat-interface')).toBeVisible();
    });

    test('should send message and get response from demo-agent', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');
        const sendButton = page.locator('.input-area').getByRole('button', { name: 'Send' });
        const assistantMessages = page.locator('.message.ai');

        // Pin the fixture the reply is indexed against: exactly one assistant message, the
        // greeting, before anything has been sent. If that ever stops holding, the index below
        // is addressing the wrong bubble and this is the assertion that says so.
        await expect(assistantMessages).toHaveCount(1);
        await expect(assistantMessages.first()).toContainText(GREETING);

        await input.fill('Hello from E2E test');
        await sendButton.click();

        await expect(page.locator('.message.user', { hasText: 'Hello from E2E test' })).toBeVisible();

        // The reply is the first assistant message AFTER the greeting: index 1, never `.last()`.
        const reply = assistantMessages.nth(1);
        await expect(reply).toBeVisible();
        // It has to say something of its own...
        await expect(reply.locator('.message-content')).toContainText(/\S/);
        // ...and it has to be a reply rather than the app's failure bubble (see the header:
        // failures arrive on this very locator, which is what makes this line load-bearing).
        await expect(reply).not.toContainText('Error');
    });
});
