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
//
// QA-33 — WHERE THE TIMEOUTS IN THIS FILE COME FROM. Each budget below is a measured step
// latency times a stated margin, and the sum of the test's budgets fits inside the `timeout`
// in playwright.config.ts, which is what makes them reachable rather than decorative. This is
// a DIFFERENT surface from chat-gth-headless.spec.ts, so none of that file's numbers were
// reasoned across; these were measured here.
//
// Measured in this repository on 2026-09-18 against the keyless local ollama path
// (gemma4:12b at temperature 0.7), serialised behind the OPS-118 GPU lock the harness takes,
// over 26 cells of an instrumented probe timing each milestone in the order this test asserts
// them — because each budget starts when the previous assertion resolved:
//
//   goto → textarea visible               929 – 1 024 ms
//   fill → send button enabled                3 – 5 ms
//   send click → user message visible         2 – 4 ms
//   user message → assistant bubble       1 283 – 17 824 ms
//   assistant bubble → it contains the word   6 – 82 ms
//
// READ THE SHAPE OF THAT FOURTH ROW BEFORE CHANGING ANY NUMBER HERE. It is the only
// model-bound step in the file, and the other four are not slow versions of it — they are
// local DOM work that is over in single-digit milliseconds. Sizing them from the round-trip
// total would put four unjustified numbers back where this node found five.
//
// The fourth row's spread is not machine load. Throughput was flat at 31.75 – 32.20 tokens/s
// across all 26 cells; what varies is how many tokens the model chooses to emit before the
// answer begins — 37 to 571 over the same 26. So that step's latency is
// (tokens ÷ ~32 per second) plus prompt eval, plus the model LOAD when ollama has evicted it.
// Four of the 26 paid that load inside this step and measured 6 797 / 9 804 / 10 311 /
// 12 806 ms, which is INSIDE the spread of the runs that did not — residency matters less
// here than how long an answer the model samples.
test.describe('Chat Interface (Gaunt Sloth AG-UI, stock CopilotKit UI)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/?ui=stock');
        // 10 000 ms against a measured 929 – 1 024 ms — about 10x the largest observed, and no
        // model is involved. The tight band is itself a measurement: two of the 26 cells ran
        // with the vite dep cache deleted and landed at 966 and 1 016 ms, because the harness
        // polls the web client for readiness before Playwright navigates, so a cold dev
        // server's pre-bundle is paid before this step rather than inside it.
        await expect(
            page.locator('[data-testid="copilot-chat-input-textarea"]')
        ).toBeVisible({ timeout: 10000 });
    });

    test('should stream an assistant reply through CopilotChat', async ({ page }) => {
        const input = page.locator('[data-testid="copilot-chat-input-textarea"]');

        await input.click();
        await input.fill('Say the single word: pukeko');

        const sendButton = page.locator('[data-testid="copilot-chat-input-send"]');
        // 5 000 ms against a measured 3 – 5 ms. The button enables off local reactivity when
        // the textarea stops being empty; there is no network and no model in this step. So
        // the number is not a latency budget at all, it is a tolerance for a scheduler stall
        // on a loaded box, and it is set to Playwright's own default expect timeout rather
        // than to some multiple of 4 ms.
        await expect(sendButton).toBeEnabled({ timeout: 5000 });
        await sendButton.click();

        // User message echoes into the transcript.
        // 5 000 ms against a measured 2 – 4 ms. Same class as the assertion above: CopilotKit
        // appends the user turn to local state on send, so this never waits on the server.
        await expect(
            page.locator('[data-testid="copilot-user-message"]', { hasText: 'pukeko' })
        ).toBeVisible({ timeout: 5000 });

        // An assistant message appears and accumulates non-empty streamed text.
        const assistant = page.locator('[data-testid="copilot-assistant-message"]').last();
        // 45 000 ms, and this is the one budget in the file that has to cover a model.
        //
        // The margin: measured 1 283 – 17 824 ms over 26 cells, so this is about 2.5x the
        // largest value actually observed. Stated in the units the step is actually made of,
        // 45 000 ms buys roughly 1 300 generated tokens at the measured ~32 tokens/s once the
        // model load and prompt eval are subtracted — against a largest observed answer of
        // 571 tokens.
        //
        // Both bounds are deliberate. It is well above the legitimate distribution, and well
        // below a gemma runaway, which ends only at the 16 384-token context bound and takes
        // about eight minutes. A runaway SHOULD fail this assertion rather than be waited out,
        // so if this budget is the one that fires, read `journalctl -u ollama` for the runaway
        // signature (an `eval time` line near 15 000 output tokens, or an `n_gen` climb that
        // ends at `release … stop processing` with no timing block) before widening anything.
        await expect(assistant).toBeVisible({ timeout: 45000 });
        // 5 000 ms against a measured 6 – 82 ms. This budget is small because the element it
        // waits on does not exist until the answer text does: in 23 of the 26 cells the bubble
        // already carried the whole word when it became visible, and in the other three it
        // carried a prefix ("p", "puk") and the rest arrived within 82 ms. All of the model
        // latency is therefore spent by the assertion ABOVE, not this one. 5 000 ms is about
        // 160 tokens at the measured rate, for a reply that is one word.
        await expect(assistant).toContainText(/pukeko/i, { timeout: 5000 });
    });
});

// QA-33 — THE PER-FILE ARITHMETIC, which is the other half of what makes these numbers real.
//
// The test timeout in playwright.config.ts covers `beforeEach` plus the test body, so a
// budget is only reachable if the budgets before it plus its own fit inside that number:
//
//   10 000 + 5 000 + 5 000 + 45 000 + 5 000 = 70 000 ms
//
// against `timeout: 150_000`. The unbudgeted actions add about 0.4 s to the worst case
// (`goto` measured 283 – 332 ms, the click and fill together 31 – 45 ms; neither has an
// explicit budget and both are bounded only by the test timeout), so the file's worst case is
// roughly 70 400 ms and every budget above can be spent in full, with about 79 600 ms spare.
//
// The config `timeout` is deliberately NOT changed. It is 150 000 because
// chat-gth-headless.spec.ts's longest test sums to 120 000, and this node does not touch that
// file — lowering it to fit this one would make those budgets unreachable, which is the exact
// defect QA-30 fixed, and raising it is what lets unjustified numbers look reachable. The test
// timeout follows the budgets; the budgets do not follow the test timeout.
