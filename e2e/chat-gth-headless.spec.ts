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
//
// QA-30 — WHERE THE TIMEOUTS IN THIS FILE COME FROM. Each per-assertion budget below is a
// measured step latency times a stated margin, and the sum of one test's budgets fits inside
// the `timeout` in playwright.config.ts, which is what makes them reachable rather than
// decorative. Measured in this repository on 2026-09-12 against the keyless local ollama path
// (gemma4:12b), model warm and serialised behind the OPS-118 GPU lock, n=4:
//
//   send → tool-call badge        3.6 / 5.1 / 5.3 / 5.3 s
//   badge → resume text part     13.9 / 14.4 / 15.9 / 21.1 s
//   send → resume text part      19.2 / 19.4 / 19.7 / 26.2 s
//   send → agent run ends        20.7 / 22.0 / 22.2 / 28.2 s
//
// Those are STEP latencies inside the round-trip. The cell's own wall time, which is what a
// budget actually has to cover, is larger — it adds the navigation in beforeEach and the
// badge-expand and image assertions afterwards. Over five runs of the full suite, same
// conditions:
//
//   capture round-trip, cell wall time    18.5 / 19.5 / 23.1 / 28.2 / 31.2 s
//
// Read that last number before widening OR narrowing anything. **31.2 s is a run that passed**:
// warm model, GPU lock held, nothing else on the card, the resume correct and every assertion
// green — and it is over the 30 000 ms default this suite used to run under. Two of those five
// are at or past that default. So the old budget was not merely thin, it was crossed by a
// healthy run, and QA-29's "2 of 5 first attempts red" needs no contention to explain it.
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
        // 30 000 ms: this whole test was measured at 1.3–6.1 s end to end.
        const assistant = page.locator('[data-testid="pk-headless-assistant"]').last();
        await expect(assistant).toBeVisible({ timeout: 30000 });
        await expect(assistant).toContainText(/pukeko/i, { timeout: 30000 });
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
    // the camera card in the transcript must show the client-fulfilled result.
    test('round-trips the shared capture_image client tool (interrupt → frame → resume)', async ({ page }) => {
        const input = page.locator('[data-testid="pk-headless-input"]');
        await input.click();
        await input.fill(
            'Call the capture_image tool exactly once, then briefly describe the returned image.'
        );
        await page.locator('[data-testid="pk-headless-send"]').click();

        // The tool call surfaces in the transcript as the camera card (RC-35), which renders
        // in place of the generic badge. The `placement-chat` class tells it apart from the
        // live camera pane, which mounts the same component with `placement="panel"`.
        // 30 000 ms against a measured 3.6–5.3 s: deliberately the most generous margin in
        // this file, because a run that starts after ollama has evicted the model pays the
        // model LOAD inside this first turn. If this budget is ever the one that fires, warm
        // the model (as the QA-29 sweep harness does) rather than widening it further.
        const card = page.locator('[data-testid="pk-camera-capture"].placement-chat');
        await expect(card).toBeVisible({ timeout: 30000 });

        // The agent RESUMES past the interrupt: a non-empty assistant text
        // follows the tool call (the model's description of the frame).
        //
        // QA-30 — 45 000 ms, and READ THIS BEFORE DIAGNOSING A FAILURE HERE.
        //
        // The margin: this step was measured at 13.9–21.1 s directly, and the 31.2 s run in the
        // table above implies about 23–24 s for it once its navigation and trailing assertions
        // are subtracted. So 45 000 is a little under 2x the largest value actually observed —
        // sized against that, not against the probe's smaller maximum, and not against green.
        //
        // `element(s) not found` on this locator does NOT
        // mean the resume emitted nothing. `.text-part` is rendered by HeadlessChat.vue only
        // where a text part EXISTS, so the locator has nothing to match until the resume's
        // answer begins — and the answer is gated behind a reasoning stream whose length the
        // model samples (this config runs at temperature 0.7). A long one leaves this locator
        // unmatched while the run is perfectly healthy: the page snapshot from a measured
        // budget crossing shows the badge present, the reasoning already describing the frame
        // mid-stream, and the Stop button still up.
        //
        // So the two cases are told apart by the SNAPSHOT, not by this message: read
        // `error-context.md` in the test-results dir the failure names. Reasoning still
        // streaming and the run in flight is a budget crossing; a finished run with no text
        // part is the real defect this assertion is for.
        //
        // There is deliberately no finer assertion on the reasoning part to split those two
        // automatically: the provider is chosen by GTH_LLM_PROVIDER, a model that does not
        // stream reasoning renders no `.thinking-part` at all, and an assertion on one would
        // red on a healthy run under any such provider.
        await expect(
            page.locator('[data-testid="pk-headless-assistant"] .text-part').last()
        ).not.toBeEmpty({ timeout: 45000 });

        // The camera card shows the captured frame uncollapsed, in place of the
        // generic view's raw `{mimeType, data: <base64>}` JSON.
        //
        // Scoping to the chat card keeps the live camera pane elsewhere on the
        // page from satisfying an image check that is about the tool call.
        // Together with the accessible name, a missing image or a fall-through
        // to the generic view fails this.
        //
        // The card takes its photo from the tool result when one is attached and
        // otherwise from the live capture session, so this image alone no longer
        // proves the result attached. The resume text above is what proves the
        // frame reached the server; the attach itself is pinned at unit level.
        const capturedFrame = card.getByRole('img', { name: 'Captured camera frame' });
        await expect(capturedFrame).toBeVisible({ timeout: 15000 });

        // And it carries the fake camera's real payload rather than a
        // placeholder: the envelope's mime type and base64 frame, re-assembled
        // into a data URL by parseImageEnvelope. Compared as a 16-character
        // slice so a mismatch prints a readable prefix instead of dumping the
        // whole base64 blob into the run log.
        expect((await capturedFrame.getAttribute('src'))?.slice(0, 16)).toBe('data:image/jpeg;');
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
