import { test, expect, type Page } from '@playwright/test';

// Same vue web client (@galvanized-pukeko/web-client) and selectors as the ADK e2e
// (root e2e/chat.spec.ts) — only the backend differs: here the AG-UI stream comes from
// the Koog Ktor server (koogAgent) via a real gemini-2.5-flash streamed reply.
//
// koogAgent is a pure text streamer: it binds no tools and drops ToolCall frames, so this
// spec covers ONLY the text round-trip (Button / Enter) + static UI. No A2UI-surface test.
//
// QA-35 — WHY THE LOCATORS AND BUDGETS LOOK LIKE THIS, AND WHAT IS NOT KNOWN ABOUT THEM.
//
// The two message cells carried the three defects the root `e2e/chat.spec.ts` carried, and are
// fixed the same way; that file's header holds the reasoning in full. In short: the
// `.is-loading` line they stepped over matched nothing anywhere in this repository, so it
// resolved on its first poll and bought no time; `.message.ai` `.last()` also matches the
// permanent greeting `ChatInterface.vue` pushes in `onMounted`, so it was the greeting until the
// reply existed; and `.message.ai` is the whole bubble, so a content assertion on it reads the
// model's reasoning as well as its answer.
//
// THE BUDGETS BELOW ARE TRANSFERRED, NOT MEASURED ON THIS HARNESS. They are taken from a QA-35
// probe of 20 turns against the ADK harness, which drives THE SAME web client on THE SAME bespoke
// surface against THE SAME provider family (`gemini-flash-lite-latest` through Google AI Studio)
// with no tools on either side, and which measured `user turn → the answer begins` at
// 1 835 – 3 362 ms and `the answer begins → it has the word` at 14 – 50 ms. That is the whole
// of the transfer argument: same client, same surface, same provider, same shape of turn. It is
// an argument, not a measurement, and nobody has run this file against a live Koog server since
// these numbers were written — see the note on the `goto` below for why.
//
// THEY ARE ALSO BOUNDED FROM ABOVE, which is the more important half. This example's
// `playwright.config.ts` states no `timeout`, so every test here gets Playwright's 30 000 ms
// default, and a budget larger than that is unreachable decoration rather than a budget. The sum
// below is what has to fit:
//
//   5 000 (beforeEach, default) + 3 000 (echo) + 10 000 (answer starts) + 5 000 (the word)
//     + 3 000 (Error) = 26 000 ms   against a 30 000 ms test timeout
//
// So the model-bound margin here is about 3x the largest transferred observation, where the root
// spec affords 8.9x. That is a ceiling imposed by the config, not a judgement that this path is
// faster, and raising it means deciding what this example's test timeout should be first.

/**
 * The assistant bubble belonging to one turn: the `.message.ai` that FOLLOWS that turn's user
 * message. A raw CSS string because the general sibling combinator is the whole point — it is
 * what excludes the greeting, which precedes every user turn, and excludes it by POSITION, so
 * the greeting copy stays free to change.
 */
function replyTo(page: Page, userText: string) {
    return page.locator(`.message.user:has-text("${userText}") ~ .message.ai`).first();
}

/**
 * The ANSWER inside an assistant bubble: every `.text-part` joined, reasoning excluded.
 *
 * A string for `expect.poll` rather than a locator for `toContainText`, because a bubble can hold
 * more than one text part and `expect(bubble.locator('.text-part')).toContainText('…')` is then a
 * strict mode violation rather than a match against the joined text.
 */
async function answerOf(bubble: ReturnType<typeof replyTo>): Promise<string> {
    return (await bubble.locator('.text-part').allInnerTexts()).join('');
}

// ANSWER_STARTS_MS waits for the model's answer to BEGIN, not for the reply bubble to appear.
// The bubble is painted by whichever part of the turn arrives first, so on a provider that
// renders reasoning it appears while the answer is still far away; koogAgent streams text only,
// which makes the two the same event here, but the shape matches the other two specs so the
// three do not quietly disagree about which milestone is the model-bound one.
const ECHO_MS = 3000;
const ANSWER_STARTS_MS = 10000;
const REPLY_TEXT_MS = 5000;
const ERROR_MS = 3000;

test.describe('Koog AG-UI Chat Interface', () => {
    test.beforeEach(async ({ page }) => {
        // NOTE (QA-35): this navigation is stale and this spec cannot currently reach its first
        // assertion. PLAT-12 made the no-query default the HEADLESS surface, which never renders
        // `.chat-interface` — only `?ui=bespoke` does, which is why the root `e2e/chat.spec.ts`
        // carries that query and this file does not. Deliberately left alone here rather than
        // repaired in passing: restoring this example's coverage is a decision with an owner, and
        // a one-token edit nobody can run is not that decision.
        await page.goto('/');
        await expect(page.locator('.chat-interface')).toBeVisible();
    });

    test('should send message via button', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');
        const sendButton = page.locator('.input-area').getByRole('button', { name: 'Send' });

        await input.fill('Hello via Button. Your response must include word Button.');
        await sendButton.click();

        await expect(page.locator('.message.user', { hasText: 'Hello via Button' })).toBeVisible({
            timeout: ECHO_MS,
        });

        const aiMessage = replyTo(page, 'Hello via Button');
        await expect.poll(() => answerOf(aiMessage), { timeout: ANSWER_STARTS_MS }).not.toBe('');
        await expect.poll(() => answerOf(aiMessage), { timeout: REPLY_TEXT_MS }).toContain('Button');
        // AFTER the content assertion, not before it: an empty bubble contains no "Error", so
        // asserting this while the bubble is still empty is very nearly an assertion that cannot
        // fail. It stays on the whole bubble while the assertion above narrows to the answer,
        // because a positive assertion must be narrow and a negative one should be wide.
        await expect(aiMessage).not.toContainText('Error', { timeout: ERROR_MS });
    });

    test('should send message via Enter key', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');

        await input.fill('Hello via Enter. Your response must include word Enter.');
        await input.press('Enter');

        await expect(page.locator('.message.user', { hasText: 'Hello via Enter' })).toBeVisible({
            timeout: ECHO_MS,
        });

        const aiMessage = replyTo(page, 'Hello via Enter');
        await expect.poll(() => answerOf(aiMessage), { timeout: ANSWER_STARTS_MS }).not.toBe('');
        await expect.poll(() => answerOf(aiMessage), { timeout: REPLY_TEXT_MS }).toContain('Enter');
        await expect(aiMessage).not.toContainText('Error', { timeout: ERROR_MS });
    });

    test('should display helper text', async ({ page }) => {
        await expect(page.getByText('Click Send or press Enter to send your message')).toBeVisible();
    });
});
