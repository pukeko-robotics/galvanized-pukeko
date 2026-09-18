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
//    real wait: on the A2UI cell the reply bubble's own arrival, and on the three message cells
//    the model's answer beginning — see ANSWER_STARTS_MS below for why those are not the same
//    milestone on this surface.
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
//   user turn → reply bubble visible          330 – 73 994 ms   <- the model-bound step
//   reply bubble → the BUBBLE contains the word  5 –  1 292 ms
//
// READ THE SHAPE OF THE THIRD ROW BEFORE CHANGING ANY NUMBER HERE. Its median is 827 ms and its
// p90 is 7 433 ms, and its margin is taken from the 73 994 ms tail, not from the middle. It is
// time-to-first-rendered-part — ollama's prompt eval plus the first token — and it carries
// essentially all of the flow's latency.
//
// THE FOURTH ROW ABOVE IS A MEASUREMENT OF THE OLD ASSERTION AND NO CELL USES IT ANY MORE. It is
// small because the bubble's text includes the model's REASONING, which arrives first and already
// contains the asserted word; QA-35 re-measured the same step against the ANSWER and got
// 3 420 – 96 424 ms. The row is kept because it is the evidence for that, not because it sizes
// anything. The A2UI cell still uses the third row; the message cells are sized at
// ANSWER_STARTS_MS and REPLY_TEXT_MS below.
//
// THESE TESTS DELIBERATELY DO NOT WAIT FOR THE STREAM TO FINISH. The probe measured the bubble
// still carrying `class="message ai streaming"` 1 285 – 16 336 ms after the asserted word was
// already present, with 5 of 24 samples not done inside a 20 000 ms cap and one earlier sample
// still streaming past 120 000 ms. Waiting on completion would tie these cells to gemma choosing
// to stop — QA-33's runaway — for no assertion gain, since what is asserted is in the bubble long
// before the stream ends.
//
// QA-35 — WHY THE CONTENT ASSERTIONS TARGET THE ANSWER AND NOT THE BUBBLE.
//
// 4. THE BUBBLE IS NOT THE ANSWER. `.message.ai` is the whole assistant bubble, and on this
//    surface it contains the model's visible reasoning as well: `ChatInterface.vue` renders a
//    `thinking` part as `.thinking-part` and a `text` part as `.text-part`, siblings inside one
//    `.message-content`. `toContainText` on the bubble therefore reads BOTH. On the keyless
//    ollama path that is not a theoretical gap — gemma's reasoning quotes the system prompt
//    verbatim, so on all 20 samples of a QA-35 probe the thinking block contained "Gaunt Sloth"
//    (e.g. `I have a system prompt that tells me my name is "Gaunt Sloth"`) roughly 2 500 ms
//    before the answer did. A bubble-level assertion is satisfied by the model THINKING the right
//    thing while ANSWERING the wrong one, and a provider that renders no reasoning at all is
//    meanwhile verifying only the answer — so the two providers were checking different text
//    through one assertion. `answerOf` below is what makes them check the same thing.
//
//    The negative assertion stays on the WHOLE bubble on purpose. The asymmetry is deliberate and
//    is not an oversight: a positive assertion must be narrow, because any extra text it can read
//    is text that can satisfy it falsely; a negative assertion should be wide, because any part of
//    the bubble rendering "Error" is a failure wherever it sits.

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

/**
 * The ANSWER inside an assistant bubble: every `.text-part` joined, reasoning excluded.
 *
 * Returned as a string for `expect.poll` rather than as a locator for `toContainText`, because a
 * bubble can hold more than one text part — a tool call, or a context fold, opens a new one — and
 * `expect(bubble.locator('.text-part')).toContainText('…')` is then a STRICT MODE VIOLATION, not a
 * match against the joined text. Measured, not assumed: against a two-part fixture Playwright
 * 1.61 reports `strict mode violation: … resolved to 2 elements`. Joining also keeps a word that
 * straddles a part boundary findable.
 *
 * It waits properly. Before the model emits any text the bubble holds only `.thinking-part`, so
 * this returns `''` and the poll keeps polling — which is exactly the interval the budget beside
 * each call is sized for.
 */
async function answerOf(bubble: ReturnType<typeof replyTo>): Promise<string> {
    return (await bubble.locator('.text-part').allInnerTexts()).join('');
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

// QA-35 — THE MODEL-BOUND STEP ON A MESSAGE CELL, and why it is not the one above.
//
// `REPLY_BUBBLE_MS` waits for the bubble. On this surface the bubble is painted by whichever part
// of the turn arrives FIRST, and when the model renders reasoning that is the thinking block —
// measured at 307 – 3 871 ms after the echo across 40 samples of the two message prompts. So
// "the reply bubble is visible" is not a milestone that says anything about the model having
// answered, and a budget split there leaves essentially the whole round trip to the step after
// it. That is not a hypothesis: it is what a 15 000 ms answer budget did on the ollama path,
// failing twice with `Received string: ""` while the bubble had been up for a second.
//
// The milestone that does mean something is THE ANSWER BECOMING NON-EMPTY, which strictly
// implies the bubble, so the two assertions collapse into one and the arithmetic stays whole.
//
// 110 000 ms against a measured 3 420 – 96 424 ms over 19 of 20 Button samples (the slowest of
// the prompts here), and 4 212 – 25 348 ms over 20 Enter samples. That is about 1.14x the
// largest observed and it is THIN — said plainly rather than dressed up, because the budget is
// bounded from above by this file's 150 000 ms test timeout and not by a judgement that 1.14x is
// enough. The 20th Button sample produced no answer at all inside a 120 s cap after 25 377
// characters of reasoning: that is QA-33's runaway, and no number that fits this file covers it.
const ANSWER_STARTS_MS = 110000;

// 10 000 ms against a measured 4 – 366 ms over the 39 of 40 samples that produced an answer at
// all — about 27x the largest observed.
//
// Small because the step is now small: by the time the answer has a first character, the word
// that satisfies these cells is a few tokens behind it. All of the model's latency is spent by
// the assertion above this one, which is the arrangement the old split only appeared to have.
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
        // The one model-bound step: this turn's bubble exists AND the model has stopped reasoning
        // and started answering. See ANSWER_STARTS_MS for why the bubble alone is not that step.
        await expect.poll(() => answerOf(aiMessage), { timeout: ANSWER_STARTS_MS }).not.toBe('');
        await expect.poll(() => answerOf(aiMessage), { timeout: REPLY_TEXT_MS }).toContain('Button');
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
        await expect.poll(() => answerOf(aiMessage), { timeout: ANSWER_STARTS_MS }).not.toBe('');
        await expect.poll(() => answerOf(aiMessage), { timeout: REPLY_TEXT_MS }).toContain('Enter');
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
        await expect.poll(() => answerOf(aiMessage), { timeout: ANSWER_STARTS_MS }).not.toBe('');
        // The cell this file's QA-35 note is written about: on ollama the reasoning block quotes
        // the name from the system prompt long before the answer does, so asserting on the bubble
        // here passes while the model is still deciding what to say.
        await expect.poll(() => answerOf(aiMessage), { timeout: REPLY_TEXT_MS }).toContain(
            'Gaunt Sloth'
        );
    });

    test('should render an A2UI surface via show_a2ui_surface', async ({ page }) => {
        const input = page.locator('input[name="chat-input"]');
        await input.fill(
            'Use the show_a2ui_surface tool now. Call it with this exact surfaceJsonl:\n' +
            '{"surfaceUpdate":{"surfaceId":"s1","components":[{"id":"t1","component":{"Text":{"text":{"literalString":"Name"}}}},{"id":"r","component":{"Column":{"children":{"explicitList":["t1"]}}}}]}}\n' +
            '{"beginRendering":{"surfaceId":"s1","root":"r"}}'
        );
        await input.press('Enter');

        // QA-35 — what stood here was `expect(page.locator('.is-loading')).not.toBeVisible({
        // timeout: 60000 })`, and it waited for nothing at all: see point 1 at the head of this
        // file. The two lines below are its replacement, and they are the SAME two steps the
        // message cells above take — the echo, then that turn's own reply bubble.
        //
        // 5 000 ms, same class as the echo assertions above: measured 4 – 13 ms over 20 samples,
        // and nothing here waits on the server. The cell had no echo assertion before; it needs
        // one now, because the reply locator is anchored on the user turn, and without the anchor
        // asserted first a missing echo would arrive much later as a missing reply.
        await expect(
            page.locator('.message.user', { hasText: 'Use the show_a2ui_surface tool now' })
        ).toBeVisible({ timeout: 5000 });

        // REPLY_BUBBLE_MS, the same constant and the same step as the message cells: this turn's
        // assistant bubble arriving. Measured on this cell's own prompt at 208 – 4 886 ms over 20
        // samples (p50 315 ms), which sits well inside the 330 – 73 994 ms that sized the constant
        // — so a tool-call turn does not paint its bubble more slowly than a text turn, and this
        // step does not need a number of its own.
        const aiMessage = replyTo(page, 'Use the show_a2ui_surface tool now');
        await expect(aiMessage).toBeVisible({ timeout: REPLY_BUBBLE_MS });

        // A2UI surface should appear in the right panel.
        //
        // THE 10 000 MS BELONGS TO QA-31 AND IS DELIBERATELY UNTOUCHED. Be clear about what the
        // line above did and did not buy it: the bubble is painted by the reasoning block and
        // arrives ~315 ms after the echo, so this budget now starts about a third of a second
        // later than it used to and otherwise covers the same interval. The wait above is
        // strictly correct — a dead server now reds at a step that names itself — but it is not
        // headroom, and nothing here should be read as having made this assertion safer.
        await expect(page.locator('.a2ui-surface')).toBeVisible({ timeout: 10000 });
    });
});

// QA-32 — THE PER-FILE ARITHMETIC, the other half of what makes these numbers real. The test
// timeout in playwright.config.ts covers `beforeEach` plus the body, so a budget is reachable
// only if everything before it plus itself fits inside that number. The longest test here is one
// of the two message cells:
//
//   5 000 (beforeEach, default) + 5 000 (echo) + 110 000 (answer starts) + 10 000 (the word)
//     + 5 000 (Error) = 135 000 ms
//
// against `timeout: 150_000`. The unbudgeted actions add well under a second (`goto` and the
// fill/click are bounded only by the test timeout and were measured in the hundreds of ms), so
// every budget above can be spent in full with roughly 14 000 ms spare.
//
// The A2UI cell is shorter and also fits: 5 000 + 5 000 + 110 000 (bubble) + 10 000 (surface)
// = 130 000 ms.
//
// QA-35 changed WHICH step carries the 110 000 on the message cells without changing the sum, and
// that is the constraint anyone re-splitting these budgets inherits: there is room here for
// exactly ONE step that waits on the model. A shape with two of them does not fit, whatever the
// two numbers are.
//
// The config `timeout` is deliberately NOT changed: it is 150 000 because
// chat-gth-headless.spec.ts's longest test sums to 120 000. The budgets follow the measurements
// and the test timeout follows the budgets, never the other way round.
