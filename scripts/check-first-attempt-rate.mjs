#!/usr/bin/env node
// Guard: the first-attempt pass rate is still computed correctly, can still be computed at all,
// and is still printed by every harness that runs the suite.
//
// QA-30. `scripts/first-attempt-rate.mjs` is what makes a retry-absorbed failure visible on this
// suite. Three separate things have to hold for it to be worth anything, and none of them fails
// loudly on its own:
//
//   1. THE COMPUTATION. Asserted below against fixtures whose shape was captured from a real
//      Playwright JSON report (v1.61) — a clean cell, a cell that failed first and passed on a
//      retry, a hard failure, and a skip. Cases 5-7 are the ones that carry the reasoning: an
//      EMPTY report must be refused rather than formatted as a perfect score, results that are
//      not in retry order must still be read by `retry`, and a cell with no first attempt at all
//      must not be counted clean.
//
//   2. THE WIRING. A correct reader over a report nobody writes reports nothing. So the json
//      reporter's presence and its output path are pinned against `playwright.config.ts`, and so
//      is the existence of an explicit `timeout` — whose ABSENCE was the original QA-30 defect,
//      because it silently handed every test Playwright's 30 000 ms default while the specs stated
//      larger budgets they could never reach.
//
//   3b. THE BUDGETS THE TIMEOUT HAS TO COVER. QA-46. A `timeout` that is present and at its
//      measured value is still wrong if the specs have outgrown it: the test dies at the config's
//      backstop instead of at the per-assertion budget naming its own step, and those budgets
//      become decoration — QA-30's defect, arriving from the spec side instead of the config side.
//      So for EACH config below that states a test timeout, the largest per-test sum of budgeted
//      waits is DERIVED from the specs that config governs and its `timeout` is asserted to cover
//      it — the root config's over `e2e/**` (QA-46) and the koog example's over its own
//      `e2e-tests/**` (QA-47). What that replaced was a constant restating the sum,
//      which nothing watched: raising one budget in one spec falsified it, and the guard went on
//      quoting it in the very message a reader would trust. `scripts/e2e-budget-scan.mjs` does the
//      reading and states, and measures with fixtures, what it cannot see.
//
//   3. THE HARNESSES. QA-38. A correct reader and a written report still print nothing if no
//      harness calls them, and for a whole release cycle `it-adk.js` did not: it ran the suite and
//      reported pass/fail, its rate had to be recomputed by hand afterwards, and nothing here
//      noticed. Checking that the mechanism exists without checking that it is connected is the
//      shape this repository has been bitten by before. So the harnesses are DISCOVERED by the
//      `it-*.js` pattern and each is required to report — a hand-maintained list would be a second
//      copy of the population, and the fourth harness would be the one nobody checked.
//
// THE PINS ARE MOSTLY ON THE FACILITY, AND ON TWO NUMBERS. Removing the reporter, renaming its
// output file, deleting a `timeout` key, or dropping the call from any harness all fail here — that
// is the facility, and it is most of what this file does.
//
// The two numbers are the `timeout` in the ROOT config (QA-44) and the `timeout` in the KOOG
// example's config (QA-43), each pinned by exact VALUE as well as by presence. THE TWO CONFIGS ARE
// NOW TREATED THE SAME, and the reason they briefly were not is worth keeping, because the
// difference was a decision at the time rather than an inconsistency:
//
//   - The KOOG config's defect was a SILENT LOWERING: a key edited down does not fail where it was
//     edited, it fails later on someone else's branch as a cell that times out, which reads as
//     ambient flakiness and gets absorbed by the known-flakes register. Presence cannot see that at
//     all, so QA-43 pinned the value there.
//   - The ROOT config's defect was an ABSENT key, so presence is what HAD to hold there, and QA-43
//     deliberately left it at that rather than widen its own diff over a config it had not been
//     asked to re-measure. QA-44 then asked whether that asymmetry was still right and ruled it was
//     not: presence cannot detect a lowering here either, and the root config is a backstop for
//     EVERY headless cell rather than for one example harness, so the larger exposure was the
//     unguarded one. Both are pinned now, and there is no config here whose measured `timeout` is
//     guarded by presence alone.
//
// A VALUE PIN AND THE DERIVED INEQUALITY ARE NOT THE SAME ASSERTION, and neither replaces the
// other. The pin notices a number changing and says where the old one came from; the inequality
// notices the RELATIONSHIP breaking and says nothing about who moved. Raise the root timeout to
// 200 000 and only the pin reds — the inequality is happier than before. Raise a spec's budget past
// the backstop and only the inequality reds — the config never moved. Both failures are real and
// they do not overlap.
//
// Pinning a value does also red on a legitimate, deliberately re-measured number, and that is the
// point rather than the cost — it is the one moment the person changing it is already looking at
// it and can be told where the old number came from. Both failure messages say so, and both name
// what has to change together.
//
// WHAT A SOURCE SCAN CANNOT SEE, stated so nobody reads more into a green run than is there. The
// harness section reads text, because what it is checking is not reachable by importing the
// harnesses — they boot servers at module scope. Text can be satisfied without the behaviour: a
// call inside a branch that never runs, or one whose result is computed and thrown away, passes
// here. Comments are stripped first, which closes the likeliest of those (the harnesses DISCUSS
// this facility in prose, and a search satisfied by a comment would pass against one that had
// stopped doing any of it); the rest is a known limit, not an oversight. The alternative — parsing
// each harness to prove the value reaches stdout — reds on correct code after an ordinary
// refactor, and a guard that cries wolf gets its finding suppressed rather than read.
//
// No browser, no server, no model: all of this is arithmetic over fixtures, so it runs anywhere.
//
// Run: node scripts/check-first-attempt-rate.mjs   (wired into "pnpm test")

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  configTestDir,
  configTestTimeout,
  configTimeoutKeys,
  deriveBudgets,
  largestPerFile,
  specBudgets,
} from './e2e-budget-scan.mjs';
import { DEFAULT_REPORT_PATH, summarise, formatSummary } from './first-attempt-rate.mjs';
import { stripComments } from './source-scan.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${label}\n       ${err.message}`);
  }
}

function assertEqual(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

/**
 * A millisecond figure written the way this repository's configs and nodes write one — `50 000`,
 * not `50000`. Interpolated rather than spelled out in the prose of the messages below, so a
 * re-measurement that updates a constant cannot leave a message quoting the number it replaced;
 * grouped so the message still matches what someone searching for the measurement will have read.
 *
 * Declared here rather than beside either caller because both value pins in this file use it.
 */
function grouped(n) {
  return n.toLocaleString('en-US').replaceAll(',', ' ');
}

/**
 * One cell in the shape the JSON reporter emits: a spec carrying one test per project, whose
 * `results` carry a `retry` index and a status.
 */
function cell(title, line, results, status) {
  return {
    title,
    file: 'chat-gth-headless.spec.ts',
    line,
    tests: [{ projectName: 'chromium', expectedStatus: 'passed', status, results }],
  };
}

/** A report with one file suite holding the given specs. */
function report(specs) {
  return { suites: [{ title: 'chat-gth-headless.spec.ts', file: 'chat-gth-headless.spec.ts', specs }] };
}

const CLEAN = cell('a clean cell', 36, [{ retry: 0, status: 'passed', duration: 1300 }], 'expected');
const ABSORBED = cell(
  'round-trips the shared capture_image client tool',
  64,
  [
    { retry: 0, status: 'failed', duration: 30000 },
    { retry: 1, status: 'passed', duration: 25300 },
  ],
  'flaky'
);
const HARD_FAIL = cell(
  'a cell that never passes',
  99,
  [
    { retry: 0, status: 'failed', duration: 30000 },
    { retry: 1, status: 'failed', duration: 30000 },
  ],
  'unexpected'
);
const SKIPPED = cell('a skipped cell', 120, [{ retry: 0, status: 'skipped', duration: 0 }], 'skipped');

console.log('first-attempt rate — computation');

check('a clean run is the full rate', () => {
  const s = summarise(report([CLEAN, cell('another', 40, [{ retry: 0, status: 'passed' }], 'expected')]));
  assertEqual([s.clean, s.total, s.dirty], [2, 2, 0], 'clean run');
  assertEqual(s.absorbed, [], 'nothing absorbed');
});

check('a retry-absorbed cell lowers the rate and is named', () => {
  const s = summarise(report([CLEAN, ABSORBED]));
  assertEqual([s.clean, s.total], [1, 2], 'one of two clean');
  assertEqual(s.absorbed.length, 1, 'one absorbed cell');
  if (!s.absorbed[0].includes('capture_image')) {
    throw new Error(`absorbed label does not name the cell: ${s.absorbed[0]}`);
  }
  // The line that a run prints, which is the whole point of the facility.
  if (!formatSummary(s)[0].startsWith('first-attempt pass rate: 1/2 cells')) {
    throw new Error(`unexpected summary line: ${formatSummary(s)[0]}`);
  }
});

check('a hard failure is reported as failed, not as absorbed', () => {
  const s = summarise(report([CLEAN, HARD_FAIL]));
  assertEqual([s.clean, s.total], [1, 2], 'one of two clean');
  assertEqual(s.absorbed, [], 'a never-passing cell was not absorbed by a retry');
  assertEqual(s.failed.length, 1, 'one outright failure');
});

check('a skip is excluded from the denominator and is not counted clean', () => {
  const s = summarise(report([CLEAN, SKIPPED]));
  assertEqual([s.clean, s.total, s.skipped], [1, 1, 1], 'skip excluded');
});

check('an EMPTY report is refused rather than formatted as a perfect score', () => {
  let threw = false;
  try {
    summarise(report([]));
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('an empty report was summarised instead of refused');
  // And a report that is entirely skips is equally empty of attempts.
  let threwAllSkipped = false;
  try {
    summarise(report([SKIPPED]));
  } catch {
    threwAllSkipped = true;
  }
  if (!threwAllSkipped) throw new Error('an all-skipped report was summarised instead of refused');
});

check('the FIRST attempt is the one with retry 0, whatever order results arrive in', () => {
  const reversed = cell(
    'results out of order',
    64,
    [
      { retry: 1, status: 'passed', duration: 25300 },
      { retry: 0, status: 'failed', duration: 30000 },
    ],
    'flaky'
  );
  const s = summarise(report([reversed]));
  assertEqual([s.clean, s.total], [0, 1], 'read by retry index, not by array position');
});

check('a cell with no first attempt is not counted clean', () => {
  const s = summarise(report([cell('no retry 0', 64, [{ retry: 1, status: 'passed' }], 'flaky')]));
  assertEqual([s.clean, s.total, s.dirty], [0, 1, 1], 'unknown first attempt is not clean');
});

check('cells are found inside nested describe suites', () => {
  const nested = {
    suites: [
      {
        title: 'chat-gth-headless.spec.ts',
        file: 'chat-gth-headless.spec.ts',
        specs: [],
        suites: [{ title: 'Chat Interface', specs: [CLEAN, ABSORBED] }],
      },
    ],
  };
  const s = summarise(nested);
  assertEqual([s.clean, s.total], [1, 2], 'nested describe walked');
});

console.log('first-attempt rate — wiring');

const config = readFileSync(join(REPO_ROOT, 'playwright.config.ts'), 'utf8');

check('playwright.config.ts declares the json reporter at the pinned path', () => {
  if (!config.includes("'json'")) {
    throw new Error('the json reporter is gone from playwright.config.ts — nothing writes the report');
  }
  if (!config.includes(DEFAULT_REPORT_PATH)) {
    throw new Error(
      `the json reporter no longer writes ${DEFAULT_REPORT_PATH}, which is where the reader looks`
    );
  }
});

check('playwright.config.ts states an explicit test timeout', () => {
  if (!configTestTimeout(config, 'playwright.config.ts')) {
    throw new Error(
      'no explicit top-level `timeout` in playwright.config.ts — every test silently falls back to ' +
        "Playwright's 30 000 ms default while the specs state larger budgets they cannot reach " +
        '(the original QA-30 defect)'
    );
  }
});

console.log('first-attempt rate — the per-test budgets that timeout has to cover');

// QA-46 — THE EXTRACTION'S OWN RULES, pinned against sources written here rather than against the
// specs, which are free to change. The inequality below is only worth its run if the scan can
// actually see a budget: a scan that quietly returned nothing would make it hold forever, which is
// the assertion-that-cannot-fail this node was filed to avoid building.

const FIXTURE_COUNTING = `
import { test, expect } from '@playwright/test';

const SLOW_MS = 40000;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app')).toBeVisible({ timeout: 7000 });
});

/*
 * PROSE IN THE SHAPE OF CODE, which is why comments are blanked before anything is counted. If
 * this block reached the scan it would contribute a test and a budget that no run will ever
 * execute:
 *   test('a phantom test', async ({ page }) => {
 *     await expect(page.locator('.gone')).toBeVisible({ timeout: 999999 });
 *   });
 */
test('a test that budgets four ways', async ({ page }) => {
  // The same shape on one line: await expect(page.locator('.x')).toBeVisible({ timeout: 888888 });
  await expect(page.locator('.a')).toBeVisible();
  await expect(page.locator('.b')).toBeVisible({ timeout: 11000 });
  await expect.poll(() => page.title(), { timeout: SLOW_MS }).not.toBe('');
  // A PROMPT QUOTING AN ASSERTION, which is why string bodies are blanked too. These specs really
  // do send prose to a model; a scan that read it would budget for text nothing runs.
  await page.fill('#q', 'await expect(x).toBeVisible({ timeout: 777777 });');
  expect((await page.title()).slice(0, 2)).toBe('ok');
});
`;

check('the extraction reads a hook, a literal, a named constant and the Playwright default', () => {
  const tests = specBudgets(FIXTURE_COUNTING, 'fixture');
  assertEqual(tests.length, 1, 'one test found');
  assertEqual(tests[0].title, 'a test that budgets four ways', 'the test is named from its title');
  // 7 000 in the hook, which shares the test's timeout; then 5 000 for the unbudgeted assertion
  // (Playwright's expect default), 11 000 for the literal and 40 000 through the constant. The
  // trailing `expect(...)` is NOT awaited, does not retry and buys no time — which is exactly why
  // e2e/chat-gth-headless.spec.ts sums to 120 000 and not 125 000.
  assertEqual([tests[0].hookMs, tests[0].bodyMs, tests[0].totalMs], [7000, 56000, 63000], 'sums');
});

// THE DEMONSTRATED BLIND SPOT, and the reason this file says "narrow" rather than "complete".
//
// Only statements lexically inside a test or a hook are summed, so a budget reached through a
// helper is invisible and the sum comes out LOW — the direction that passes. This fixture is that
// boundary, measured: the helper budgets 200 000 ms, the test really cannot fit inside any timeout
// this repository states, and the extraction reports 1 000.
//
// It is pinned rather than described because a limitation that is only written down is what QA-46
// exists to stop. If someone teaches the scan to follow helpers, this check reds and they are
// standing in the right place to move the boundary deliberately.
const FIXTURE_HELPER_BUDGET = `
import { test, expect } from '@playwright/test';

async function waitForReply(page) {
  await expect(page.locator('.reply')).toBeVisible({ timeout: 200000 });
}

test('a budget the extraction cannot see', async ({ page }) => {
  await waitForReply(page);
  await expect(page.locator('.done')).toBeVisible({ timeout: 1000 });
});
`;

check('a budget behind a helper is NOT seen — the measured boundary of this extraction', () => {
  const tests = specBudgets(FIXTURE_HELPER_BUDGET, 'fixture');
  assertEqual(tests[0].totalMs, 1000, 'the helper 200 000 is not counted');
});

check('a budget this extraction cannot evaluate is refused, never counted as zero', () => {
  const computed = `
import { test, expect } from '@playwright/test';
const BASE = 1000;
test('computed', async ({ page }) => {
  await expect(page.locator('.a')).toBeVisible({ timeout: BASE * 2 });
});
`;
  let threw = false;
  try {
    specBudgets(computed, 'fixture');
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('an expression budget was silently dropped instead of refusing');

  const undeclared = `
import { test, expect } from '@playwright/test';
test('undeclared', async ({ page }) => {
  await expect(page.locator('.a')).toBeVisible({ timeout: SOMEWHERE_ELSE_MS });
});
`;
  let threwUndeclared = false;
  try {
    specBudgets(undeclared, 'fixture');
  } catch {
    threwUndeclared = true;
  }
  if (!threwUndeclared) throw new Error('a budget naming an unknown constant was counted as zero');
});

check('a spec the pattern cannot match is refused, not reported as a spec with no budgets', () => {
  let threw = false;
  try {
    specBudgets("import { test } from '@playwright/test';\nconst nothing = 1;\n", 'fixture');
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(
      'a file with no matchable test was accepted. An enumeration that cannot match is ' +
        'indistinguishable from a clean result, and this one feeds an inequality.'
    );
  }
});

// QA-46 — THE `webServer.timeout` BUG, fixed and proven here rather than left as a comment saying
// to be careful. The pins used to read the first line-anchored `timeout:` in a config, so a nested
// one written above the test timeout — the shape
// packages/galvanized-pukeko-vue-ui/playwright.config.ts already has — would have retargeted them
// onto a dev-server boot tolerance without a word. Brace depth tells them apart.
//
// THE OTHER TWO LINES ARE ADVERSARIAL ON PURPOSE and are what make the blanking in
// scripts/source-scan.mjs a measured requirement rather than a precaution. The template literal is
// the root config's own `baseURL`: its interpolation is brace-balanced, so a naive count survives
// it today, and this keeps that true by measurement instead of by luck. The `metadata` note holds a
// lone closing brace inside a string, which is the case that does NOT balance — unblanked, it ends
// the enclosing object early and every key after it, the test timeout included, lands at the wrong
// depth and is simply not found. No config in this repository has one; this is where that stops
// being load-bearing.
const FIXTURE_CONFIG = [
  "import { defineConfig } from '@playwright/test';",
  'export default defineConfig({',
  "  testDir: './e2e',",
  '  use: { baseURL: `http://localhost:${process.env.WEB_PORT || 5555}` },',
  "  metadata: { note: 'a lone closing brace } inside a string' },",
  "  webServer: { command: 'pnpm dev', timeout: 30_000 },",
  '  timeout: 150_000,',
  '});',
].join('\n');

check('a nested webServer.timeout written ABOVE the test timeout does not retarget the pin', () => {
  const keys = configTimeoutKeys(FIXTURE_CONFIG);
  assertEqual(keys.map((k) => [k.ms, k.depth]), [[30000, 2], [150000, 1]], 'both keys, by depth');
  assertEqual(configTestTimeout(FIXTURE_CONFIG, 'fixture').ms, 150000, 'the top-level one');
  assertEqual(configTestDir(FIXTURE_CONFIG, 'fixture'), './e2e', 'testDir');
});

check('two top-level timeouts are refused rather than resolved by writing order', () => {
  const twice = FIXTURE_CONFIG.replace("  testDir: './e2e',", "  testDir: './e2e',\n  timeout: 90_000,");
  let threw = false;
  try {
    configTestTimeout(twice, 'fixture');
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('a config with two top-level timeouts was resolved by position');
});

/**
 * The derivation and the inequality for ONE config: the two checks, the derivation printed, and an
 * accessor for the binding sum that this config's value pin names in its failure message — which
 * is what stops that message quoting a sum nobody recomputed.
 *
 * BOTH CONFIGS GO THROUGH THIS RATHER THAN THROUGH TWO COPIES OF IT, and that is worth a sentence
 * because the duplication would be invisible. Most of what follows is a failure MESSAGE, and a
 * failure message is the one part of a guard that no green run ever reads: a second copy would be
 * free to drift from the first for as long as both configs stayed green, which is exactly the
 * period during which nobody looks. The differences between the two configs are their path, their
 * specs and their number, and all three are arguments.
 */
function budgetCoverage(configPath, configSource) {
  let derived = null;

  check(`the budget extraction reads every spec ${configPath} governs`, () => {
    derived = deriveBudgets(REPO_ROOT, configPath, configSource);
    for (const spec of largestPerFile(derived.tests)) {
      if (spec.totalMs <= 0) {
        throw new Error(
          `${spec.file} yielded no budgeted wait at all. Either every assertion there really is ` +
            'unbudgeted, or the shape this scan matches has moved — and the second reads exactly ' +
            'like the first from here.'
        );
      }
    }
  });

  check(`${configPath} gives every test time to spend the budgets its own spec states`, () => {
    if (!derived) {
      throw new Error('the extraction above failed, so this inequality was never evaluated');
    }
    const stated = configTestTimeout(configSource, configPath);
    if (!stated) {
      throw new Error(
        `no top-level \`timeout\` in ${configPath}, so this inequality has nothing to compare the ` +
          'derived sum against. The pin on that key is what says what its absence costs.'
      );
    }
    const worst = derived.largest;
    if (stated.ms < worst.totalMs) {
      throw new Error(
        `${configPath} gives each test ${grouped(stated.ms)} ms, but ${worst.file} states a ` +
          `test whose own per-assertion budgets sum to ${grouped(worst.totalMs)} ms — ` +
          `"${worst.title}", short by ${grouped(worst.totalMs - stated.ms)} ms. ` +
          'That test can no longer reach its last budgets: it dies at this config\'s backstop as an ' +
          'anonymous test timeout instead of at the budget naming its own step, and every number ' +
          'after the crossing point is decoration — the defect QA-30 exists to prevent, arriving ' +
          'from the spec side rather than the config side. ' +
          'THE FIX IS NOT TO RAISE THE CONFIG SO THIS GOES GREEN. The test timeout follows the ' +
          'budgets and the budgets follow their measurements, never the other way round: if the ' +
          'budget is right then the backstop needs re-measuring as its own piece of work, and if it ' +
          'is not then the budget is what should move. This check does not care which, only that ' +
          'somebody decided.'
      );
    }
  });

  if (derived) {
    // The derivation, PRINTED rather than restated in a comment. A run shows the largest per-test
    // sum in each spec, so a reader checking the arithmetic reads today's numbers instead of the
    // ones that were true when someone last wrote them down.
    for (const spec of largestPerFile(derived.tests).sort((a, b) => b.totalMs - a.totalMs)) {
      console.log(`       ${String(grouped(spec.totalMs)).padStart(9)} ms  ${spec.file}  "${spec.title}"`);
    }
  }

  /** The binding sum, as this config's value pin names it — derived at run time, never restated. */
  return () => {
    if (!derived) return 'a sum the extraction above could not derive';
    return `${grouped(derived.largest.totalMs)} ms, in ${derived.largest.file}`;
  };
}

// The derivation over the real specs the ROOT config governs.
const bindingSum = budgetCoverage('playwright.config.ts', config);

console.log('first-attempt rate — the measured numbers, pinned by value');

// QA-44 — THE SAME KEY, PINNED BY VALUE. The presence check catches a DELETED key, which was
// QA-30's defect, and the inequality above catches the SPECS outgrowing it. Neither catches a
// LOWERED key, and a lowering is the worst of the three: it does not fail where it was made, it
// fails later, on someone else's branch, as a cell that times out and reads as ambient flakiness.
//
// WHERE 150 000 COMES FROM. QA-30 derived it on 2026-09-12 as the sum of the per-step budgets of
// the longest test in `e2e/chat-gth-headless.spec.ts` (30 000 + 30 000 + 45 000 + 15 000 = 120 000)
// plus slack. That provenance is history, not a live claim: the binding spec moved when QA-32 and
// QA-35 collapsed `chat-gth.spec.ts` onto one 110 000 ms model-bound step. WHAT THE BINDING SUM IS
// TODAY IS NOT WRITTEN DOWN ANYWHERE HERE ON PURPOSE — QA-46 replaced the constant that used to
// restate it with the derivation above, which recomputes it every run and prints it. A sum restated
// in a comment is falsified by an edit one directory away, and then goes on being the most
// authoritative sentence in the file.
const ROOT_TIMEOUT_MS = 150_000;

check('playwright.config.ts states the measured test timeout, at its measured value', () => {
  const stated = configTestTimeout(config, 'playwright.config.ts');
  if (!stated) {
    throw new Error(
      'no explicit top-level `timeout` in playwright.config.ts, so there is no value to pin — see ' +
        `the presence check above for what its absence costs. It stated ${grouped(ROOT_TIMEOUT_MS)} ` +
        'ms, which QA-30 derived on 2026-09-12 as the sum of the per-step budgets of the longest ' +
        'test in e2e/chat-gth-headless.spec.ts (30 000 + 30 000 + 45 000 + 15 000 = 120 000) plus ' +
        `slack. The largest per-test sum under this config today is ${bindingSum()}. If you are ` +
        're-measuring this budget, write the new number into the config AND into ROOT_TIMEOUT_MS ' +
        'in this file, in the same change.'
    );
  }
  if (stated.ms !== ROOT_TIMEOUT_MS) {
    throw new Error(
      `playwright.config.ts states a test timeout of ${grouped(stated.ms)} ms, but this pin says ` +
        `${grouped(ROOT_TIMEOUT_MS)}. ` +
        'That is not a round guess to be adjusted until a run goes green. QA-30 derived it on ' +
        '2026-09-12 as the sum of the per-step budgets of the longest test in ' +
        'e2e/chat-gth-headless.spec.ts (30 000 + 30 000 + 45 000 + 15 000 = 120 000) plus slack, ' +
        `and the largest per-test sum under this config today is ${bindingSum()} — so anything ` +
        'below that makes the per-assertion budgets of the test it names unreachable decoration, ' +
        'which is the defect QA-30 exists to prevent. The inequality check above is what watches ' +
        'for that; this one watches the number itself, because a lowering does not fail where it ' +
        "is edited — it fails later, on someone else's branch, as a cell that times out and reads " +
        'as ambient flakiness. If you have DELIBERATELY RE-MEASURED it, this red is expected and ' +
        'correct, and the fix is to update BOTH places in the same change: the config and ' +
        'ROOT_TIMEOUT_MS in this file. Do not delete this assertion to clear the red.'
    );
  }
});

console.log('first-attempt rate — the harnesses that must report one');

/**
 * A launcher's code with comments removed and whitespace flattened.
 *
 * Comments go first because these launchers DISCUSS this facility in prose, and a search satisfied
 * by a comment ABOUT reporting would pass against a harness that had stopped doing any of it.
 * Whitespace is flattened so a reformat breaking a call across lines does not read as a harness
 * that stopped making it.
 */
function launcherCode(rel) {
  return stripComments(readFileSync(join(REPO_ROOT, rel), 'utf8')).replace(/\s+/g, ' ');
}

// The population, DISCOVERED rather than listed, and by the same `it-*.js` pattern
// scripts/check-harness-argv.mjs uses — deliberately identical, so a reader reconciles one
// definition of "a harness" rather than two. `tsconfig.tooling.json` globs the same set for the
// same reason: the next harness is covered on the day it is added, not on the day someone
// remembers to add it here.
const rootFiles = readdirSync(REPO_ROOT).sort();
const HARNESSES = rootFiles.filter((name) => /^it-.*\.js$/.test(name));

check('the it-*.js enumeration finds harnesses at all', () => {
  if (HARNESSES.length === 0) {
    throw new Error(
      `no it-*.js harness found in ${REPO_ROOT} — either they have been renamed or moved, in which ` +
        'case this pattern must follow them, or every harness check below has been testing ' +
        'nothing. An enumeration that cannot match is indistinguishable from a clean result.'
    );
  }
});

const REQUIRED_IN_HARNESS = [
  ['first-attempt-rate.mjs', 'does not import the reader'],
  ['reportFirstAttemptRate(', 'never calls the reader, so its run prints no first-attempt rate'],
  [
    'DEFAULT_REPORT_PATH',
    'does not name its report through the shared DEFAULT_REPORT_PATH, so a path written out by ' +
      'hand here and the one the json reporter writes can drift apart with neither side failing',
  ],
];

for (const rel of HARNESSES) {
  check(`${rel} reports the first-attempt rate`, () => {
    const code = launcherCode(rel);
    for (const [needle, why] of REQUIRED_IN_HARNESS) {
      if (!code.includes(needle)) {
        throw new Error(
          `${rel} ${why} (no "${needle}" in its code). It would report only pass and fail, and a ` +
            'run that needed three retries would be indistinguishable from one that was clean on ' +
            'the first attempt — the distinction every flake adjudication here turns on.'
        );
      }
    }
  });
}

// The interactive launchers run no tests, which is why they are exempt from the loop above rather
// than merely untested. Stated as an assertion because the exemption is only sound while it stays
// true: the day one of them runs the suite it acquires a report to read and a rate to print, and
// the reader of that diff should be told here rather than finding out from a run that quietly
// reported nothing.
check('the start-*.js launchers still run no Playwright, so they have no rate to report', () => {
  for (const rel of rootFiles.filter((name) => /^start-.*\.js$/.test(name))) {
    if (/playwright/i.test(launcherCode(rel))) {
      throw new Error(
        `${rel} now names Playwright in its code. If it runs the suite it must print the ` +
          'first-attempt rate too, like every it-*.js harness above. If it uses Playwright for ' +
          'something else, this exemption is the wrong shape and should be changed deliberately.'
      );
    }
  }
});

// The other end of the koog harness's wiring. `it-koog.js` runs Playwright with the example
// directory as its cwd, so THAT config governs its run and its own json reporter is what writes
// the report the harness reads; the root config's reporter never reaches it.
//
// NAMED LITERALLY, where the harnesses above are discovered, and the difference is deliberate:
// configs are a different population. Most Playwright configs here correctly have no json reporter
// — the vue-ui visual harness, and the adk example that no it-*.js drives — so discovering them
// would red on correct code instead of widening coverage. What keeps the literal honest is that
// the enumeration above is not one: a new harness is required to report, and one reading a report
// nothing writes says so on every run it makes.
const KOOG_CONFIG = 'examples/pukeko-koog-ag-ui/playwright.config.ts';
// Read ONCE, at module scope, for both checks below — the same shape as the root config above.
const koogConfig = readFileSync(join(REPO_ROOT, KOOG_CONFIG), 'utf8');

check(`${KOOG_CONFIG} declares the json reporter at the pinned path`, () => {
  if (!koogConfig.includes("'json'")) {
    throw new Error(
      'the json reporter is gone from the koog example config, so nothing writes the report ' +
        'it-koog.js reads and its rate degrades to a warning nobody is watching for'
    );
  }
  if (!koogConfig.includes(DEFAULT_REPORT_PATH)) {
    throw new Error(
      `the koog example no longer writes ${DEFAULT_REPORT_PATH}, which is where it-koog.js looks`
    );
  }
});

console.log('first-attempt rate — the per-test budgets the koog example timeout has to cover');

// QA-47 — THE SAME INEQUALITY, POINTED AT THIS CONFIG TOO. Until now the koog example had the value
// pin below and nothing else, so a budget raised inside `e2e-tests/chat.spec.ts` past 50 000 went
// unnoticed here in precisely the way it no longer could at the root. The two guards answer
// different questions and neither substitutes for the other: the pin notices this number being
// re-derived to something nobody sampled, the inequality notices the specs outgrowing it.
//
// THE ONE ASSUMPTION THAT DID NOT SURVIVE THE MOVE, because it had never been exercised. A config's
// `testDir` is resolved against THAT CONFIG'S OWN DIRECTORY, and the extraction used to join it onto
// the repository root — which is the same thing for the root config and only for the root config.
// That is not a shape a second caller reveals by failing loudly, either: `./e2e-tests` under the
// repository root simply does not exist, so it would have surfaced as a missing directory rather
// than as the wrong one. `scripts/e2e-budget-scan.mjs` now resolves it the way Playwright does.
//
// AN EMPTY ENUMERATION IS A FAILURE, not a satisfied inequality. A derived sum against this
// config's timeout is a real assertion; nought against it is one that cannot fail, and the two are
// indistinguishable from a green tick. The extraction refuses a `testDir` holding no spec for that
// reason, and this call relies on that refusal rather than on the directory staying populated.
const koogBindingSum = budgetCoverage(KOOG_CONFIG, koogConfig);

// THE SURVEY THIS CALL COMPLETES, written down because an absent search and an empty one read
// identically later. Every Playwright config tracked in this repository was enumerated from
// `git ls-files` rather than a bare `grep` — `grep` here honours `.gitignore`, so a zero could have
// meant filtered rather than absent — and cross-checked against a `find` over the working tree,
// which does not. Both name the same four, and no other config here wants this treatment:
//
//   - `playwright.config.ts` (root): covered since QA-46. Its numbers are printed by the run above,
//     not restated here — that restatement is the thing QA-46 removed.
//   - `examples/pukeko-koog-ag-ui/playwright.config.ts`: this call, printed the same way.
//   - `examples/adk-ui-agent-to-adk-agent/playwright.config.ts`: states NO `timeout`, so there is no
//     number for an inequality to compare against and wiring it in would assert nothing. One thing
//     is worth recording rather than leaving as an absence: run this same extraction over it and it
//     derives 35 000 ms against the 30 000 ms Playwright default that config silently falls back to
//     — so the gap QA-39 adjudicated as "cannot be sized here" is not merely unsized, it is already
//     crossed, in the same worst-case currency the two checks above use. That does not make it
//     sizable here: QA-39's reasons stand (Maven, both ADK agents, an AI Studio key, and the A2A
//     :8082 NPE that OPS-23 and BE-6 record), and a number chosen without samples is what QA-37
//     exists to prevent. It makes it a MEASURED gap rather than a suspected one, which is a node
//     rather than a line here. Measured 2026-09-20, and nothing watches it — which is the other
//     half of why it belongs in a node.
//   - `packages/galvanized-pukeko-vue-ui/playwright.config.ts`: states no test `timeout` either, and
//     its one visual spec states no per-assertion budget at all — everything the extraction finds
//     there is Playwright's own expect default. Nothing was measured, so there is nothing to cover
//     and nothing to pin. Its `webServer.timeout` is a dev-server boot tolerance, which is the very
//     shape the depth check exists to keep out rather than something this would ever read.

// QA-43 — THE MEASURED TEST BUDGET, pinned by VALUE and not merely by presence. The root config's
// `timeout` is pinned the same way now (QA-44); see the header for why the two configs were once
// treated differently and no longer are.
//
// THE SURVEY THAT PRECEDED THIS ASSERTION, written down because an absent search and an empty one
// read identically later. Every config tracked in this repository was enumerated from `git ls-files`
// rather than a bare `grep` — `grep` here honours `.gitignore`, so a zero could have meant filtered
// rather than absent — and each was read for a constant arrived at by measurement:
//
//   - `playwright.config.ts` (root): `timeout: 150_000`, measured (QA-30). This was the one other
//     measured-and-value-unpinned constant the survey found, and QA-43 left it that way on purpose.
//     QA-44 has since pinned it too — the assertion and its own re-derivation are above, beside the
//     presence check. No measured `timeout` in this repository is guarded by presence alone now.
//   - `examples/adk-ui-agent-to-adk-agent/playwright.config.ts`: states NO `timeout` at all. That is
//     the same defect QA-37 fixed here, and it is left open on purpose: QA-39 ruled it "cannot be
//     sized here" — sizing it honestly needs Maven, both ADK agents, an AI Studio key, and it runs
//     into the A2A :8082 NPE that OPS-23 and BE-6 record. A number chosen without samples is exactly
//     what QA-37 exists to prevent. Carried forward as an ADJUDICATED GAP, which is a different
//     answer from "it is fine" — do not read the absence of an assertion here as the latter.
//   - `packages/galvanized-pukeko-vue-ui/playwright.config.ts`: its `webServer.timeout: 30_000` is a
//     dev-server boot tolerance with a stated rationale and no sample count, and its visual specs
//     state no per-assertion budget at all, so the absent test `timeout` there is not the QA-30
//     defect. Not measured; nothing to pin.
//   - The three `testTimeout: 10000` vitest configs (web-client, demo-mcp, ui-mcp-server-js): one
//     round number repeated verbatim in three files, with no measurement recorded anywhere.
//   - The vite configs and the root `it-*.js` / `start-*.js` launchers: NONE. Their numbers are
//     ports, poll intervals and boot-readiness tolerances — the koog one says "be generous" in its
//     own comment — not measurements.
//
// The koog spec's own per-step budgets (`ECHO_MS`, `ANSWER_STARTS_MS`, `REPLY_TEXT_MS`, `ERROR_MS`)
// are the measured numbers this 50 000 is a sum of, and are left unpinned on purpose: each sits
// directly beneath the sample count that justifies it, so anyone changing one is already reading its
// measurement. This number is the one that is far from its justification, which is what earns it a
// guard.
//
// QA-46 CONSIDERED RETIRING THIS AND DID NOT, which is worth a sentence because the derived
// inequality above looks like it subsumes a value pin and does not. 50 000 is a MEASUREMENT — 45
// samples — where a derived sum is a CONSEQUENCE of numbers measured elsewhere. An inequality
// notices the koog specs outgrowing 50 000; only a value pin notices 50 000 itself being re-derived
// to something nobody sampled, and that is the failure QA-37 built it for. The two constants QA-46
// looked at got opposite answers for the same reason: the one that restated the root config's
// binding sum was a consequence, and computing it replaced it; this one is a measurement, and
// nothing can recompute a measurement.
const KOOG_TIMEOUT_MS = 50_000;

check(`${KOOG_CONFIG} states the measured test timeout, at its measured value`, () => {
  const stated = configTestTimeout(koogConfig, KOOG_CONFIG);
  if (!stated) {
    throw new Error(
      'no explicit `timeout` in the koog example config — every cell there falls back to ' +
        "Playwright's 30 000 ms default, while the largest per-test sum its own specs state — " +
        `${koogBindingSum()} — can then never be given to the test that states it, and a test ` +
        'dying at 30 000 tells its reader the wrong number. ' +
        `The key stated ${grouped(KOOG_TIMEOUT_MS)} ms, which QA-37 ` +
        'derived from 45 samples — 40 warm and 5 cold — against this harness and no other, so it ' +
        'would stop being copied from the ADK example. If you are re-measuring it, write the new ' +
        'number into the config AND into KOOG_TIMEOUT_MS in this file, in the same change. ' +
        'Removing this assertion instead is the ordinary way a pin like this dies.'
    );
  }
  if (stated.ms !== KOOG_TIMEOUT_MS) {
    throw new Error(
      `the koog example config states a test timeout of ${grouped(stated.ms)} ms, but this pin says ` +
        `${grouped(KOOG_TIMEOUT_MS)}. ` +
        'That is not a round guess to be adjusted until a run goes green: QA-37 derived it from 45 ' +
        'samples — 40 warm and 5 cold — against this harness and no other, and the largest ' +
        `per-test sum under this config today is ${koogBindingSum()}. A lowering does not ` +
        'fail where it is edited; it fails later, on someone else\'s branch, as a cell that times ' +
        'out and reads as ambient flakiness. If you have DELIBERATELY RE-MEASURED it, this red is ' +
        'expected and correct, and the fix is to update BOTH places in the same change: the config ' +
        'and KOOG_TIMEOUT_MS in this file. Do not delete this assertion to clear the red.'
    );
  }
});

if (failures > 0) {
  console.error(`\nfirst-attempt rate: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nfirst-attempt rate: all checks passed');
