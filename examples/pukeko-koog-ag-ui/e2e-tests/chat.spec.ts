import { test, expect, type Page } from '@playwright/test';

// Same vue web client (@galvanized-pukeko/web-client) and selectors as the ADK e2e
// (root e2e/chat.spec.ts) — only the backend differs: here the AG-UI stream comes from
// the Koog Ktor server (koogAgent) via a real streamed Gemini reply.
//
// koogAgent is a pure text streamer: it binds no tools and drops ToolCall frames, so this
// spec covers ONLY the text round-trip (Button / Enter) + static UI. No A2UI-surface test.
//
// QA-37 — WHAT THIS SURFACE ACTUALLY DOES, MEASURED ON THIS HARNESS.
//
// Every number below comes from 45 samples taken against the live pair `it-koog.js` boots —
// the Koog Ktor server on `gemini-flash-lite-latest` through Google AI Studio, and the vite
// web client — timing each milestone in the order these tests assert them, because each
// budget's clock starts when the previous assertion resolved. The sample is deliberately two
// populations, because they answer different questions:
//
//   WARM  40 turns back to back against one running pair, one fresh page per turn.
//   COLD   5 turns, each the FIRST turn against a freshly started Koog JVM and a freshly
//          started vite — which is the shape the suite itself has, and the shape a warm
//          probe cannot see. The cold turn pays Koog's lazy LLM init, the first TLS
//          handshake to AI Studio, JVM warmup and vite's first transform of the client.
//
//   milestone                              warm (n=40)        cold (n=5)      pooled max
//   goto -> `.chat-interface` visible        44 –  111 ms      150 – 157 ms      157 ms
//   send -> the user turn echoes              3 –  393 ms       35 –  47 ms      393 ms
//   user turn -> the answer begins          619 – 1 136 ms   1 192 – 1 448 ms  1 448 ms
//   the answer begins -> it has the word     31 –  172 ms       56 –  85 ms      172 ms
//
// The echo figure is bimodal and it is worth knowing why before anyone reads 393 ms as
// latency: the Enter turns echo in 3 – 8 ms and the Button turns in 376 – 393 ms. Nothing
// is waiting on the server in either case — the user turn is pushed into local state on
// send. The difference is Playwright's own actionability and stability wait on `click()`.
//
// THREE FACTS ABOUT THIS SURFACE, CHECKED RATHER THAN ASSUMED, EACH ON ALL 45 SAMPLES.
// They are what make the locators below the right ones, and each would be a different
// spec if it were false:
//
//   `.thinking-part` count 0.  koogAgent emits TEXT_MESSAGE_CONTENT only, so the answer
//                              and the bubble are the same event here. On a provider that
//                              renders reasoning they are not, which is why the budget
//                              below waits for the ANSWER and not for the bubble — the
//                              same shape as the other two specs, so the three do not
//                              quietly disagree about which milestone is model-bound.
//   `.message.ai` count 1 before a reply exists.  The permanent greeting `ChatInterface.vue`
//                              pushes in `onMounted` IS an assistant bubble, so a bare
//                              `.message.ai` `.last()` would be the greeting until the
//                              reply arrived. `replyTo` anchors on the turn instead.
//   `.text-part` count 1 in a reply bubble.  A single part today, so `answerOf`'s join is
//                              not yet load-bearing here — it is kept because a tool call
//                              or a context fold opens a second part, and
//                              `expect(bubble.locator('.text-part'))` is then a strict-mode
//                              violation rather than a match against the joined text.

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

// 5 000 ms against a pooled max of 393 ms — about 12.7x. Not a latency budget: the user turn is
// pushed into local state on send, so nothing here waits on the server or the model, and the
// largest observation is Playwright's own click wait. It is a tolerance for a scheduler stall
// on a loaded box.
const ECHO_MS = 5000;

// 20 000 ms against a pooled 619 – 1 448 ms. The only model-bound step in this file.
//
// THE MULTIPLIER IS NOT THE INSTRUMENT HERE, and saying so is the point of this comment. 20 000
// is about 13.8x the largest observation, more than the 8.9x the ADK spec allows itself — not
// because this path is believed riskier, but because it is FASTER. What is unexplored in this
// distribution is a hosted provider rate-limiting or retrying, and that costs whole seconds
// regardless of how quick the happy path is, so a multiple of a 1.4 s observation buys less
// absolute headroom for the same failure than the same multiple of a 3.4 s one. The number is
// sized as ~18.5 s of headroom over the worst COLD observation, and the multiplier is a
// consequence of that rather than the reason for it.
//
// A margin this generous costs nothing in the green case and is safe because of `replyTo` and
// `answerOf`: neither can match anything that already exists — `replyTo` is anchored on a user
// turn the greeting precedes, and `answerOf` returns '' for a bubble holding no text part. So a
// longer budget only decides how long a reply that is either coming or not gets to arrive. It
// would NOT have been safe on a bare `.message.ai` `.last()`, which would merely have been
// given longer to keep matching the greeting.
const ANSWER_STARTS_MS = 20000;

// 5 000 ms against a pooled 31 – 172 ms — about 29x, and deliberately far above its measurement
// rather than a multiple of it. Every one of the 45 samples carried the asserted word in the
// model's first delta, so what the samples measured is not what this step must tolerate: that is
// the word arriving LATER in a longer answer, which is the model's choice of wording. The
// answers observed ran 67 – 137 characters under a system prompt asking for "a few short
// sentences", so the unobserved case is a wordier reply, not a slower one.
const REPLY_TEXT_MS = 5000;

// 3 000 ms, and the only budget here that is not a wait at all. No sample rendered "Error", and
// this assertion is evaluated once the answer is already non-empty and already contains the
// asserted word, so the DOM it reads has settled. The number therefore decides how long a
// genuinely errored reply takes to REPORT, not how long a good one is given to arrive.
const ERROR_MS = 3000;

// PER-FILE ARITHMETIC. `playwright.config.ts` now states `timeout: 50_000`, covering `beforeEach`
// plus the body, so a budget is reachable only if everything before it plus itself fits inside
// that number:
//
//   5 000 (beforeEach, Playwright's default) + 5 000 (echo) + 20 000 (answer starts)
//     + 5 000 (the word) + 3 000 (Error) = 38 000 ms
//
// against 50 000, so every budget above can be spent in full and still leave 12 000 ms over.
// That headroom is what was missing while the config stated no timeout at all: the 30 000 ms
// default would have made this sum unreachable, and a test that died at 30 000 while its call
// log counted against 38 000 tells its reader the wrong number.
//
// ONE STEP IS NOT IN THAT SUM AND DELIBERATELY SO: `page.goto` carries its own navigation
// timeout, Playwright's 30 000 ms default, which is not one of the budgets above. It is treated
// as covered by the 12 000 ms of slack rather than counted as a step, because the measurement
// says it costs 44 – 157 ms. The consequence of the arithmetic not covering it is worth stating:
// a genuinely HUNG navigation would exhaust the test timeout instead of reding at a step budget
// that names it, which is the one case where a failure here arrives as an anonymous test timeout.

test.describe('Koog AG-UI Chat Interface', () => {
    test.beforeEach(async ({ page }) => {
        // The bespoke surface is opt-in via `?ui=bespoke`. PLAT-12 made the no-query default the
        // HEADLESS surface, which never renders `.chat-interface`, so the query is not decoration
        // and dropping it does not merely change which UI is tested — it makes every cell in this
        // file fail in `beforeEach` before reaching an assertion of its own.
        await page.goto('/?ui=bespoke');
        // Left on Playwright's 5 000 ms default deliberately, against a pooled max of 157 ms:
        // about 32x the largest observed, and no model is involved.
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
