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
// The pins are on the FACILITY, not on the numbers: the budget's value is a decision to be made
// from measurement and re-made when the measurement changes, so this guard checks that the config
// states one at all rather than which one. Removing the reporter, renaming its output file,
// deleting the `timeout` key, or dropping the call from any harness all fail here.
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

check(`${KOOG_CONFIG} declares the json reporter at the pinned path`, () => {
  const koogConfig = readFileSync(join(REPO_ROOT, KOOG_CONFIG), 'utf8');
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

if (failures > 0) {
  console.error(`\nfirst-attempt rate: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nfirst-attempt rate: all checks passed');
