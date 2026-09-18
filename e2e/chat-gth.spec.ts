import { test, expect, type Page } from '@playwright/test';

// QA-32 — WHY THE LOCATORS AND BUDGETS IN THIS FILE LOOK LIKE THIS.
//
// Three cells here raced the live stream. They shared a symptom and nothing else, so they have
// three different fixes.
//
// 1. A WAIT THAT NEVER WAITED, and the enabling condition for the other two. Every cell stepped
//    over `expect(page.locator('.is-loading')).not.toBeVisible({ timeout: 30000 })`. NOTHING in
//    this repository renders `.is-loading` — the class appears only in spec files — and a locator
//    matching zero elements is already "not visible", so that assertion resolved on its first
//    poll, always. It could not fail, and it bought no time: the 30 000 ms was decoration. With
//    nothing between sending and asserting, Playwright's default 5 000 ms `expect` budget was
//    left covering an entire model round trip. Measured at runtime and not merely grepped: with
//    the turn in flight and `.stop-button` (`v-if="isLoading"`) visible,
//    `page.locator('.is-loading').count()` was 0 on all 29 probe samples. The replacement is a
//    real wait on the reply bubble's own arrival, below.
//
// 2. A LOCATOR THAT COULD MATCH THE WRONG ELEMENT. `.message.ai` `.last()` also matches the
//    greeting: `ChatInterface.vue` pushes `Hello! How can I help you today?` into `messages` as
//    an assistant message (in `onMounted`, and again in `clearHistory`), and the template gives
//    every assistant message `class="message ai"`. So before the reply bubble exists, `.last()`
//    IS the greeting, and the assertion compares against an element that will never contain the
//    expected word. No budget makes a wrong locator right — it only makes it lose the race less
//    often, which is the worse failure, because the rate drops while the defect stays.
//
//    The fix anchors on the turn being tested: `.message.user:has-text(…) ~ .message.ai`. A
//    `<template v-for>` emits no DOM node, so every message div is a sibling under `.messages`,
//    and the greeting PRECEDES the user turn — it is excluded structurally rather than by its
//    copy, which stays free to change. `.first()` rather than `.last()`: the probe measured two
//    `.message.ai` in the transcript and exactly one sibling match on all 29 samples, because a
//    turn is one assistant message and tool calls render as `parts` INSIDE that bubble rather
//    than as bubbles of their own. The cell below named `the greeting is an assistant bubble the
//    reply locator cannot match` is the guard that keeps both halves of that true.
//
// 3. AN ASSERTION ON STREAMED TEXT WITH NO BUDGET, which is what 1 left the 5 000 ms default
//    governing. Every assertion below now carries an explicit budget, sized from the measurement
//    recorded beside it.
//
// WHERE THE NUMBERS COME FROM. Measured in this repository on 2026-09-19 against the keyless
// local ollama path (gemma4:12b at temperature 0.7) — the path ALL THREE of this file's
// registered flake signatures are filed against, and the slower of the two the harness can run,
// so a budget that holds here holds on the openai path too. Serialised behind the OPS-118 GPU
// lock the harness takes, over 29 cells of an instrumented probe timing each milestone in the
// order these tests assert them, because each budget starts when the previous assertion
// resolved:
//
//   goto → `.chat-interface` visible          305 –    610 ms
//   send → the user turn echoes                16 –    116 ms
//   user turn → reply bubble visible          330 – 73 994 ms   <- the only model-bound step
//   reply bubble → it contains the word          5 –  1 292 ms
//
// READ THE SHAPE OF THE THIRD ROW BEFORE CHANGING ANY NUMBER HERE. Its median is 827 ms and its
// p90 is 7 433 ms, and its margin is taken from the 73 994 ms tail, not from the middle. It is
// time-to-first-rendered-part — ollama's prompt eval plus the first token — and it carries
// essentially all of the flow's latency. The fourth row is small because by the time the bubble
// paints, the text that satisfies the assertion has usually arrived with it.
//
// THESE TESTS DELIBERATELY DO NOT WAIT FOR THE STREAM TO FINISH. The probe measured the bubble
// still carrying `class="message ai streaming"` 1 285 – 16 336 ms after the asserted word was
// already present, with 5 of 24 samples not done inside a 20 000 ms cap and one earlier sample
// still streaming past 120 000 ms. Waiting on completion would tie these cells to gemma choosing
// to stop — QA-33's runaway — for no assertion gain, since what is asserted is in the bubble long
// before the stream ends.

/**
 * The assistant bubble belonging to one turn: the `.message.ai` that FOLLOWS that turn's user
 * message in the transcript.
 *
 * Written as a raw CSS string rather than a chained Playwright locator because the general
 * sibling combinator is the whole point — it is what excludes the greeting, which is a
 * `.message.ai` that precedes every user turn. `:has-text()` is a substring match, so `userText`
 * is a prefix of the sent prompt, long enough to be unique in the transcript.
 */
function replyTo(page: Page, userText: string) {
    return page.locator(`.message.user:has-text("${userText}") ~ .message.ai`).first();
}

// 110 000 ms — the ONE budget in this file that covers a model, sized from a measured
// 330 – 73 994 ms over 29 samples, so about 1.5x the largest value actually observed.
//
// A margin that generous is safe HERE and would not have been safe on the locator these cells
// used before, which is the distinction worth keeping. `replyTo` cannot match the greeting or any
// other element that already exists, so a longer budget cannot give a wrong element more time to
// be mistaken for a right one — it only decides how long a bubble that is either coming or not
// gets to arrive. Widening the old `.message.ai` `.last()` would have done the opposite: bought
// the greeting more time to sit there being compared against.
//
// It is a per-step bound, not the test's: a server that never answers reds here, at 110 s, with a
// message naming this step, rather than 40 s later as an anonymous test timeout.
const REPLY_BUBBLE_MS = 110000;

// 10 000 ms against a measured 5 – 1 292 ms — about 7.7x the largest observed. In the units the
// step is made of, 10 000 ms is roughly 320 generated tokens at the ~32 tokens/s QA-33 measured
// on this machine, for replies specified as one sentence. Small on purpose: the element it waits
// on does not exist until the model has begun rendering, so the model latency is spent by the
// assertion above this one, not by this one.
const REPLY_TEXT_MS = 10000;

test.describe('Chat Interface (Gaunt Sloth AG-UI)', () => {
    test.beforeEach(async ({ page }) => {
        // Bespoke surface is opt-in via ?ui=bespoke now that the no-query
        // default is headless (PLAT-12). It renders `.chat-interface`.
        await page.goto('/?ui=bespoke');
        // Left on Playwright's 5 000 ms default deliberately, against a measured 305 – 610 ms:
        // about 8x the largest observed, no model is involved, and this `beforeEach` is shared
        // with the A2UI cell at the foot of the file, which belongs to QA-31. Recording the
        // number without changing the behaviour keeps that cell untouched.
        await expect(page.locator('.chat-interface')).toBeVisible();
    });

    // The guard for defect 2 above, and the reason the three cells below can use `.first()`.
    //
    // It is deliberately BOTH an absence and a presence assertion. An absence assertion on its
    // own passes for free the moment a class is renamed — `.message.ai` matching nothing would
    // satisfy "the reply locator matches nothing" while silently disabling every other cell in
    // this file. Pairing it with the count of assistant bubbles makes a rename red here first.
    test('the greeting is an assistant bubble the reply locator cannot match', async ({ page }) => {
        // PRESENCE — the greeting really is a `.message.ai`, which is what makes a bare
        // `.message.ai` locator ambiguous. Rename the class in ChatInterface.vue and this reds.
        await expect(page.locator('.message.ai')).toHaveCount(1, { timeout: 5000 });

        // THE DIFFERENTIAL — the locator these cells used to use resolves, right here, with no
        // turn sent and no reply in existence. This is what the absence assertion below is
        // absence *relative to*; without it that assertion says nothing about the change.
        await expect(page.locator('.message.ai').last()).toBeVisible({ timeout: 5000 });

        // ABSENCE — the locator the cells use now matches nothing in the empty state, because it
        // is anchored on a user turn and the greeting precedes every user turn.
        await expect(page.locator('.message.user ~ .message.ai')).toHaveCount(0, { timeout: 5000 });
    });

    test('should send message via button', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');
        const sendButton = page.locator('.input-area').getByRole('button', { name: 'Send' });

        await input.fill('Hello via Button. Your response must include word Button.');
        await sendButton.click();

        // 5 000 ms against a measured 16 – 116 ms. Not a latency budget: the user turn is pushed
        // into local state on send, so nothing here waits on the server or the model. The number
        // is a tolerance for a scheduler stall on a loaded box.
        await expect(page.locator('.message.user', { hasText: 'Hello via Button' })).toBeVisible({
            timeout: 5000,
        });

        const aiMessage = replyTo(page, 'Hello via Button');
        await expect(aiMessage).toBeVisible({ timeout: REPLY_BUBBLE_MS });
        await expect(aiMessage).toContainText('Button', { timeout: REPLY_TEXT_MS });
        // AFTER the content assertion, not before it. An empty bubble contains no "Error", so
        // asserting this while the bubble is still empty is very nearly an assertion that cannot
        // fail. 5 000 ms is how long a genuinely errored reply takes to red, not a wait.
        await expect(aiMessage).not.toContainText('Error', { timeout: 5000 });
    });

    test('should send message via Enter key', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');

        await input.fill('What does the Enter key do on a keyboard? Reply in one sentence.');
        await input.press('Enter');

        // 5 000 ms — same class as the button cell's echo assertion above.
        await expect(
            page.locator('.message.user', { hasText: 'What does the Enter key do' })
        ).toBeVisible({ timeout: 5000 });

        const aiMessage = replyTo(page, 'What does the Enter key do');
        await expect(aiMessage).toBeVisible({ timeout: REPLY_BUBBLE_MS });
        await expect(aiMessage).toContainText('Enter', { timeout: REPLY_TEXT_MS });
        await expect(aiMessage).not.toContainText('Error', { timeout: 5000 });
    });

    test('should use identity from system prompt', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');
        await input.fill('What is your name? Reply in one sentence.');
        await input.press('Enter');

        // This cell had no echo assertion. It needs one now, because the reply locator is
        // anchored on the user turn: asserting the anchor first makes a missing echo red as a
        // missing echo, instead of arriving 110 s later as a missing reply.
        await expect(page.locator('.message.user', { hasText: 'What is your name' })).toBeVisible({
            timeout: 5000,
        });

        const aiMessage = replyTo(page, 'What is your name');
        await expect(aiMessage).toBeVisible({ timeout: REPLY_BUBBLE_MS });
        await expect(aiMessage).toContainText('Gaunt Sloth', { timeout: REPLY_TEXT_MS });
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

// QA-32 — THE PER-FILE ARITHMETIC, the other half of what makes these numbers real. The test
// timeout in playwright.config.ts covers `beforeEach` plus the body, so a budget is reachable
// only if everything before it plus itself fits inside that number. The longest test here is one
// of the two message cells:
//
//   5 000 (beforeEach, default) + 5 000 (echo) + 110 000 (bubble) + 10 000 (text) + 5 000 (Error)
//     = 135 000 ms
//
// against `timeout: 150_000`. The unbudgeted actions add well under a second (`goto` and the
// fill/click are bounded only by the test timeout and were measured in the hundreds of ms), so
// every budget above can be spent in full with roughly 14 000 ms spare.
//
// The config `timeout` is deliberately NOT changed: it is 150 000 because
// chat-gth-headless.spec.ts's longest test sums to 120 000. The budgets follow the measurements
// and the test timeout follows the budgets, never the other way round.
