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
  if (!/^\s*timeout:\s*[\d_]+\s*,/m.test(config)) {
    throw new Error(
      'no explicit `timeout` in playwright.config.ts — every test silently falls back to ' +
        "Playwright's 30 000 ms default while the specs state larger budgets they cannot reach " +
        '(the original QA-30 defect)'
    );
  }
});

// QA-44 — THE SAME KEY, PINNED BY VALUE. The check above catches a DELETED key, which was QA-30's
// defect. It cannot catch a LOWERED one, and a lowering is the worse failure here: it does not fail
// where it was made, it fails later, on someone else's branch, as a cell that times out and reads
// as ambient flakiness. This config backstops EVERY cell in `e2e/`, so a number below a given
// test's sum of per-step budgets makes that test's budgets unreachable decoration — QA-30's
// original defect arriving by a different route than the one QA-30 closed.
//
// THE RE-DERIVATION, 2026-09-19, done before pinning anything to this number and recorded because a
// pin quoting a stale sum is a guard that is wrong AND authoritative. `testDir: './e2e'` governs
// four specs, and the test timeout covers `beforeEach` plus the body, so each spec's constraint is
// the largest sum of budgeted waits in one of its tests:
//
//   - `chat-gth-headless.spec.ts`  120 000 = 30 000 nav + 30 000 tool badge + 45 000 resume text
//                                            + 15 000 captured frame       (QA-30, unchanged)
//   - `chat-gth.spec.ts`           135 000 =  5 000 nav (Playwright default) + 5 000 echo
//                                            + 110 000 ANSWER_STARTS_MS + 10 000 REPLY_TEXT_MS
//                                            + 5 000 the `Error` assertion  (QA-32, QA-35)
//   - `chat-gth-stock.spec.ts`      70 000 = 10 000 + 5 000 + 5 000 + 45 000 + 5 000   (QA-33)
//   - `chat.spec.ts`                55 000 =  5 000 + 5 000 + 30 000 + 10 000 + 5 000
//
// SO THE BINDING SPEC HAS MOVED and 150 000's stated provenance is out of date. QA-30 derived it as
// `chat-gth-headless`'s 120 000 plus 30 000 of slack; the largest sum under this config today is
// 135 000 in `chat-gth.spec.ts`, since QA-32 and QA-35 collapsed that file onto one 110 000 ms
// model-bound step. 150 000 still HOLDS — every budget in all four specs is still reachable, which
// is the property QA-30 was protecting — but the headroom is 15 000 ms, not 30 000. The number was
// deliberately NOT changed here: moving a measured backstop is QA-30/QA-33 territory and needs its
// own measurement campaign, not a drive-by edit inside a guard ticket.
//
// The regex takes the FIRST top-level `timeout:` in the file, which is this key today. A config
// that later grows a second one — a `webServer.timeout`, say — placed above it would retarget this
// pin silently, so keep the test budget first or anchor this more tightly when that day comes.
const ROOT_TIMEOUT_MS = 150_000;

// The sum this backstop actually has to clear today, per the re-derivation above. Named rather than
// spelled into the prose twice, so the two messages below cannot come to quote different numbers.
//
// BE CLEAR ABOUT WHAT IT DOES NOT DO: this is itself a measured constant that nothing guards. The
// pin above watches `playwright.config.ts`; nothing watches the SPECS this number was derived from.
// Raise `ANSWER_STARTS_MS` in `e2e/chat-gth.spec.ts` and the binding sum moves past 150 000, that
// file's budgets become unreachable decoration — QA-30's defect exactly — and every check here
// still passes while the message below goes on asserting 135 000. Closing that needs the guard to
// DERIVE the sums from the specs rather than restate one, which is a different assertion from this
// one and deliberately not attempted here.
const ROOT_BINDING_SUM_MS = 135_000;

check('playwright.config.ts states the measured test timeout, at its measured value', () => {
  const stated = /^\s*timeout:\s*([\d_]+)\s*,/m.exec(config);
  if (!stated) {
    throw new Error(
      'no explicit `timeout` in playwright.config.ts, so there is no value to pin — see the ' +
        `check above for what its absence costs. It stated ${grouped(ROOT_TIMEOUT_MS)} ms, which ` +
        'QA-30 derived on 2026-09-12 as the sum of the per-step budgets of the longest test in ' +
        'e2e/chat-gth-headless.spec.ts (30 000 + 30 000 + 45 000 + 15 000 = 120 000) plus slack. ' +
        `The largest per-test sum under this config today is ${grouped(ROOT_BINDING_SUM_MS)} ms, ` +
        'in e2e/chat-gth.spec.ts (QA-32, QA-35). If you are re-measuring this budget, write the ' +
        'new number into the config AND into ROOT_TIMEOUT_MS in this file, in the same change.'
    );
  }
  const ms = Number(stated[1].replace(/_/g, ''));
  if (ms !== ROOT_TIMEOUT_MS) {
    throw new Error(
      `playwright.config.ts states a test timeout of ${grouped(ms)} ms, but this pin says ` +
        `${grouped(ROOT_TIMEOUT_MS)}. ` +
        'That is not a round guess to be adjusted until a run goes green. QA-30 derived it on ' +
        '2026-09-12 as the sum of the per-step budgets of the longest test in ' +
        'e2e/chat-gth-headless.spec.ts (30 000 + 30 000 + 45 000 + 15 000 = 120 000) plus slack, ' +
        'and the largest per-test sum under this config today is ' +
        `${grouped(ROOT_BINDING_SUM_MS)} ms, in e2e/chat-gth.spec.ts (QA-32, QA-35) — so anything ` +
        `below ${grouped(ROOT_BINDING_SUM_MS)} makes that file's per-assertion budgets ` +
        'unreachable decoration, which is the defect QA-30 exists to prevent. A lowering does not ' +
        "fail where it is edited; it fails later, on someone else's branch, as a cell that times " +
        'out and reads as ambient flakiness. If you have DELIBERATELY RE-MEASURED it, this red is ' +
        'expected and correct, and the fix is to update BOTH places in the same change: the ' +
        'config and ROOT_TIMEOUT_MS in this file. Do not delete this assertion to clear the red.'
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
const KOOG_TIMEOUT_MS = 50_000;

check(`${KOOG_CONFIG} states the measured test timeout, at its measured value`, () => {
  const stated = /^\s*timeout:\s*([\d_]+)\s*,/m.exec(koogConfig);
  if (!stated) {
    throw new Error(
      'no explicit `timeout` in the koog example config — every cell there falls back to ' +
        "Playwright's 30 000 ms default, while e2e-tests/chat.spec.ts states per-step budgets " +
        'summing to 38 000 ms that it can then never be given, and a test dying at 30 000 tells ' +
        `its reader the wrong number. The key stated ${grouped(KOOG_TIMEOUT_MS)} ms, which QA-37 ` +
        'derived from 45 samples — 40 warm and 5 cold — against this harness and no other, so it ' +
        'would stop being copied from the ADK example. If you are re-measuring it, write the new ' +
        'number into the config AND into KOOG_TIMEOUT_MS in this file, in the same change. ' +
        'Removing this assertion instead is the ordinary way a pin like this dies.'
    );
  }
  const ms = Number(stated[1].replace(/_/g, ''));
  if (ms !== KOOG_TIMEOUT_MS) {
    throw new Error(
      `the koog example config states a test timeout of ${grouped(ms)} ms, but this pin says ` +
        `${grouped(KOOG_TIMEOUT_MS)}. ` +
        'That is not a round guess to be adjusted until a run goes green: QA-37 derived it from 45 ' +
        'samples — 40 warm and 5 cold — against this harness and no other. A lowering does not ' +
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
