import { test, expect, type Page } from '@playwright/test';

// QA-35 — WHY THE LOCATORS AND BUDGETS IN THIS FILE LOOK LIKE THIS.
//
// The two message cells below carried the same three defects `e2e/chat-gth.spec.ts` carried, and
// they are fixed the same way. That file's header holds the long reasoning; this is the short
// form plus the numbers, which are this harness's own and are NOT the ones over there.
//
// 1. A WAIT THAT NEVER WAITED. Both cells stepped over
//    `expect(page.locator('.is-loading')).not.toBeVisible({ timeout: 30000 })`. Nothing in this
//    repository renders `.is-loading` — the class appears only in spec files — and a locator
//    matching zero elements is already "not visible", so that line resolved on its first poll,
//    always. It could not fail and it bought no time. With nothing between sending and asserting,
//    Playwright's default 5 000 ms `expect` budget was left covering an entire model round trip.
//
// 2. A LOCATOR THAT COULD MATCH THE WRONG ELEMENT. This spec drives `?ui=bespoke`, which renders
//    `ChatInterface.vue`, which pushes `Hello! How can I help you today?` into `messages` as an
//    assistant message in `onMounted` — and the template gives every assistant message
//    `class="message ai"`. So `.message.ai` `.last()` IS the greeting until the reply exists.
//    Measured here, not assumed: on all 20 samples of a QA-35 probe against this harness a bare
//    `.message.ai` resolved to 2 elements. The fix anchors on the turn under test —
//    `.message.user:has-text(…) ~ .message.ai` — which excludes the greeting by POSITION, so the
//    greeting copy stays free to change.
//
// 3. AN ASSERTION ON THE WHOLE BUBBLE RATHER THAN ON THE ANSWER. `.message.ai` is the bubble, and
//    it holds the model's reasoning (`.thinking-part`) and its tool-call badges as well as its
//    text (`.text-part`). `answerOf` below reads only the text parts. On THIS harness the
//    distinction is currently invisible — gemini-flash-lite rendered no reasoning at all on any
//    of the 20 samples (`.thinking-part` count 0 every time) — and that is exactly why it is
//    worth writing down: the bubble-level assertion was verifying the answer here and something
//    broader on a reasoning provider, so the two were not checking the same thing. Narrowing to
//    the answer makes this cell provider-independent, and costs nothing where no reasoning is
//    rendered, because the answer is then the whole bubble's text anyway.
//
// WHERE THE NUMBERS COME FROM. Measured 2026-09-19 by a QA-35 probe over 20 turns against the
// live pair this harness boots — the ADK Java agent on `gemini-flash-lite-latest` — timing each
// milestone in the order these tests assert them, because each budget starts when the previous
// assertion resolved:
//
//   goto → `.chat-interface` visible     217 –   410 ms
//   send → the user turn echoes            3 –     7 ms
//   user turn → the answer begins      1 835 – 3 362 ms   <- the only model-bound step
//   the answer begins → it has the word    14 –    50 ms
//
// These are NOT `chat-gth.spec.ts`'s numbers and must not be reconciled with them: different
// backend, different provider, different model.

/**
 * The assistant bubble belonging to one turn: the `.message.ai` that FOLLOWS that turn's user
 * message. A raw CSS string because the general sibling combinator is the whole point — it is
 * what excludes the greeting, which precedes every user turn. `:has-text()` is a substring match,
 * so `userText` is a prefix of the sent prompt, long enough to be unique in the transcript.
 */
function replyTo(page: Page, userText: string) {
    return page.locator(`.message.user:has-text("${userText}") ~ .message.ai`).first();
}

/**
 * The ANSWER inside an assistant bubble: every `.text-part` joined, reasoning and tool-call
 * badges excluded.
 *
 * A string for `expect.poll` rather than a locator for `toContainText`, because a bubble can hold
 * more than one text part — a tool call, or a context fold, opens a new one — and
 * `expect(bubble.locator('.text-part')).toContainText('…')` is then a STRICT MODE VIOLATION
 * rather than a match against the joined text. Measured against a two-part fixture on Playwright
 * 1.61: `strict mode violation: … resolved to 2 elements`.
 */
async function answerOf(bubble: ReturnType<typeof replyTo>): Promise<string> {
    return (await bubble.locator('.text-part').allInnerTexts()).join('');
}

// 30 000 ms against a measured 1 835 – 3 362 ms — about 8.9x the largest observed, and the only
// budget here that covers a model. The multiplier is large because the sample is TIGHT (p50
// 2 345 ms, max 3 362 ms): a narrow spread means the tail has not been explored, not that there
// isn't one, and what lives in this tail is a hosted provider retrying or rate-limiting.
//
// IT WAITS FOR THE ANSWER TO BEGIN, NOT FOR THE BUBBLE, and the two are the same event only
// because this provider renders no reasoning. On a provider that does, the bubble is painted by
// the thinking block within a few hundred ms while the answer is still tens of seconds away, so a
// budget split at "bubble visible" would leave the whole round trip to the step after it. Keeping
// the same shape here as `chat-gth.spec.ts` costs nothing on this harness and means the two files
// do not quietly disagree about which milestone is the model-bound one.
//
// A margin this generous is safe because of `replyTo`, and would not have been on the locator
// these cells used before. `replyTo` cannot match the greeting or any other element that already
// exists, so a longer budget only decides how long a reply that is either coming or not gets to
// arrive; widening the old `.message.ai` `.last()` would instead have bought the greeting more
// time to sit there being compared against.
const ANSWER_STARTS_MS = 30000;

// 10 000 ms, and deliberately ABOVE its measurement rather than a multiple of it. The probe timed
// this step at 14 – 50 ms, but only because the asserted word landed in the model's first delta
// on every sample. What the step must actually tolerate is the word arriving LATER in a longer
// answer, which is the model's choice of wording and is not something those samples measured. So
// the number is sized for the case that was not observed.
const REPLY_TEXT_MS = 10000;

// 5 000 ms against a measured 3 – 7 ms. Not a latency budget: the user turn is pushed into local
// state on send, so nothing here waits on the server or the model. It is a tolerance for a
// scheduler stall on a loaded box.
const ECHO_MS = 5000;

// PER-FILE ARITHMETIC. `playwright.config.ts` gives every test 150 000 ms, covering `beforeEach`
// plus the body, so a budget is reachable only if everything before it plus itself fits inside
// that number:
//
//   5 000 (beforeEach, default) + 5 000 (echo) + 30 000 (answer starts) + 10 000 (the word)
//     + 5 000 (Error) = 55 000 ms
//
// against `timeout: 150_000`, so every budget above can be spent in full with room to spare.

test.describe('Chat Interface', () => {
    test.beforeEach(async ({ page }) => {
        // Bespoke surface is opt-in via ?ui=bespoke now that the no-query
        // default is headless (PLAT-12). It renders `.chat-interface`.
        await page.goto('/?ui=bespoke');
        // Left on Playwright's 5 000 ms default deliberately, against a measured 217 – 410 ms:
        // about 12x the largest observed, and no model is involved.
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
        // AFTER the content assertion, not before it. An empty bubble contains no "Error", so
        // asserting this while the bubble is still empty is very nearly an assertion that cannot
        // fail. 5 000 ms is how long a genuinely errored reply takes to red, not a wait.
        //
        // It stays on the WHOLE bubble while the assertion above narrows to the answer, and the
        // asymmetry is the point: a positive assertion must be narrow, because any extra text it
        // can read is text that can satisfy it falsely, while a negative assertion should be
        // wide, because any part of the bubble rendering "Error" is a failure wherever it sits.
        await expect(aiMessage).not.toContainText('Error', { timeout: 5000 });
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
        await expect(aiMessage).not.toContainText('Error', { timeout: 5000 });
    });

    test('should display helper text', async ({ page }) => {
        await expect(page.getByText('Click Send or press Enter to send your message')).toBeVisible();
    });

    // The guard that keeps defect 2 above fixed, and the reason the two cells can use `.first()`.
    //
    // Deliberately BOTH an absence and a presence assertion. An absence assertion on its own
    // passes for free the moment a class is renamed: `.message.ai` matching nothing would satisfy
    // "the reply locator matches nothing" while silently disabling every other cell in this file.
    // Pairing it with the count of assistant bubbles makes a rename red here first.
    test('the greeting is an assistant bubble the reply locator cannot match', async ({ page }) => {
        // PRESENCE — the greeting really is a `.message.ai`, which is what made a bare
        // `.message.ai` locator ambiguous. Rename the class in ChatInterface.vue and this reds.
        await expect(page.locator('.message.ai')).toHaveCount(1, { timeout: 5000 });

        // THE DIFFERENTIAL — the locator these cells used to use resolves right here, with no
        // turn sent and no reply in existence. This is what the absence assertion below is
        // absence *relative to*; without it that assertion says nothing about the change.
        await expect(page.locator('.message.ai').last()).toBeVisible({ timeout: 5000 });

        // ABSENCE — the locator the cells use now matches nothing in the empty state, because it
        // is anchored on a user turn and the greeting precedes every user turn.
        await expect(page.locator('.message.user ~ .message.ai')).toHaveCount(0, { timeout: 5000 });
    });

    // A2UI render coverage lives in the machine-checkable specs — agent-adk AdkLocalAgentA2uiWireTest
    // (wire level) and vue-ui HeadlessChatA2UI.spec.ts (component level).
    // The bespoke ChatInterface path this spec exercises is defaulted away by PLAT-12 and deleted by
    // PLAT-13, so a bespoke A2UI render test would assert on a doomed surface; the previously
    // quarantined `should render A2UI form` fixme was removed with the fix rather than un-skipped here.
});
