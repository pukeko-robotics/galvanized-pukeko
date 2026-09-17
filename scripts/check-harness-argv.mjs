#!/usr/bin/env node
// Guard: the harnesses still forward the arguments they were given, and still refuse to hand
// Playwright the separator pnpm inserts.
//
// QA-34. `pnpm run it-gth-ag-ui -- --list` ran the entire suite and exited 0. The chain is in the
// header of `scripts/harness-argv.mjs`, along with the reasoning for stripping the separator
// rather than rejecting it. This file is what stops either half rotting, and it has two halves for
// the same reason `check-first-attempt-rate.mjs` and `check-ollama-gpu-lock.mjs` do:
//
//   1. THE COMPUTATION. What `playwrightArgsFrom` does to each shape of argv. The cells that carry
//      the reasoning are the ones pinning the EDGES of the rule: only one separator is removed,
//      only at the front, and an argv that never had one is returned untouched.
//
//   2. THE WIRING. A correct helper no harness calls forwards nothing. Reverting any of the three
//      launchers to the bare `process.argv.slice(2)` it used to have restores the exact bug while
//      leaving every computation cell green, and only reading the file notices. Comments are
//      stripped first: all three launchers now DISCUSS this separator in prose, and a search
//      satisfied by a comment would pass against a harness that had stopped doing any of it.
//
// A NOTE ON WHAT DISTINGUISHES THE TWO SPELLINGS, because it is not what it first looks like.
// After the fix the two spellings CONVERGE — `['--','--grep','x']` and `['--grep','x']` both
// forward `['--grep','x']` — so a cell comparing their outputs passes whether or not the strip
// exists. What separates them is the MUTATION DIFFERENTIAL: remove the strip and the `--` cells go
// red while the no-`--` cells stay green. Those green cells are the control, behaviour-neutral by
// construction, and they are what shows this change is confined to the separator rather than
// mangling argv in general.
//
// No browser, no server, no model: argument handling is arithmetic over strings, so this runs
// anywhere.
//
// Run: node scripts/check-harness-argv.mjs   (wired into "pnpm test")

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARG_SEPARATOR, playwrightArgsFrom, separatorNotice } from './harness-argv.mjs';
import { stripComments } from './source-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const fail = (msg) => failures.push(msg);

/**
 * Print a section's `ok` line only if the section actually passed.
 *
 * Failures are collected and printed together at the end, so an unconditional `ok` would sit above
 * them claiming a section held when it did not — a run whose summary disagrees with its result,
 * which is the shape of defect this whole file exists to catch.
 */
function okUnless(before, label) {
  if (failures.length === before) console.log(`  ok   ${label}`);
}

/**
 * One computation cell: run the helper over `argv` and compare both halves of its answer.
 *
 * `stripped` is asserted alongside `args` on purpose. It is what decides whether the run announces
 * the adjustment, so an implementation that returned the right arguments while claiming it had
 * changed nothing would be silent again — which is the defect, not a cosmetic difference.
 */
function expectArgs(argv, expectedArgs, expectedStripped, why) {
  const got = playwrightArgsFrom(argv);
  const gotArgs = JSON.stringify(got.args);
  const wantArgs = JSON.stringify(expectedArgs);
  if (gotArgs !== wantArgs) {
    fail(
      `playwrightArgsFrom(${JSON.stringify(argv)}) forwards ${gotArgs}, expected ${wantArgs} — ${why}`
    );
  }
  if (got.separatorStripped !== expectedStripped) {
    fail(
      `playwrightArgsFrom(${JSON.stringify(argv)}) reports separatorStripped=` +
        `${got.separatorStripped}, expected ${expectedStripped} — the run announces the adjustment ` +
        `on this flag, so getting it wrong either hides a rewrite or claims one that did not happen.`
    );
  }
}

console.log('harness argv — computation');
const beforeShapes = failures.length;

// The defect itself: what pnpm hands the script for `pnpm run it-gth-ag-ui -- --grep "x"`.
expectArgs(
  [ARG_SEPARATOR, '--grep', 'capture_image'],
  ['--grep', 'capture_image'],
  true,
  'this is the argv pnpm builds for `pnpm run <harness> -- --grep capture_image`. Forwarded with ' +
    'the separator still on the front, Playwright discards the rest and runs the whole suite.'
);

// THE CONTROL. The direct spelling was already correct and must stay byte-identical: it is the
// half of the differential that stays green when the strip is removed, which is what shows the
// change is scoped to the separator.
expectArgs(
  ['--grep', 'capture_image'],
  ['--grep', 'capture_image'],
  false,
  'the `node it-gth-ag-ui.js --grep capture_image` spelling worked before this change and must be ' +
    'untouched by it.'
);

// The ordinary invocation — `pnpm run it-gth-ag-ui`, no arguments at all — is the one everybody
// actually runs, and the one a bug here would break for everybody at once.
expectArgs([], [], false, 'a no-argument run must forward nothing and announce nothing.');

expectArgs(
  [ARG_SEPARATOR],
  [],
  true,
  '`pnpm run it-gth-ag-ui --` forwards a lone separator, which Playwright would read as ' +
    'end-of-options. Nothing follows it, so nothing is lost — but it is still not an argument the ' +
    'caller typed.'
);

// Only ONE, and only LEADING. These two cells are why the implementation is a single leading
// comparison rather than a filter, and deleting either lets a filter pass unnoticed.
expectArgs(
  [ARG_SEPARATOR, ARG_SEPARATOR],
  [ARG_SEPARATOR],
  true,
  'exactly one separator is pnpm\'s; a second one is the caller\'s. `pnpm run it-koog -- -- --foo` ' +
    'must still reach Playwright with a real `--`, or a caller who genuinely wants end-of-options ' +
    'has no way left to ask for one.'
);
expectArgs(
  ['--grep', 'capture_image', ARG_SEPARATOR],
  ['--grep', 'capture_image', ARG_SEPARATOR],
  false,
  'a separator that is not at the front cannot have come from pnpm, so it is forwarded as typed.'
);
expectArgs(
  ['--headed', ARG_SEPARATOR, 'e2e/chat.spec.ts'],
  ['--headed', ARG_SEPARATOR, 'e2e/chat.spec.ts'],
  false,
  'a separator in the middle is the caller distinguishing options from positionals — the one ' +
    'thing the token is actually for.'
);

// An argument that merely looks like the separator is not the separator.
expectArgs(
  ['---', '--grep', 'x'],
  ['---', '--grep', 'x'],
  false,
  'only the exact two-dash token is pnpm\'s separator; a longer run of dashes is a (malformed) ' +
    'flag and belongs to the caller.'
);

okUnless(beforeShapes, 'argument handling over all argv shapes');

// The notice. The defect was SILENCE, so a strip nobody is told about would be a quieter version
// of the same problem. Pinned on content rather than wording: it has to name the token it removed
// and show what is actually being forwarded, or it does not let a reader of a log reconstruct the
// run.
{
  const beforeNotice = failures.length;
  const notice = separatorNotice(['--grep', 'capture_image']);
  if (!notice.includes(ARG_SEPARATOR)) {
    fail(`The strip notice does not name the "${ARG_SEPARATOR}" it removed: ${notice}`);
  }
  if (!notice.includes('--grep capture_image')) {
    fail(
      `The strip notice does not show what is being forwarded, so a log cannot tell which run it ` +
        `describes: ${notice}`
    );
  }
  if (!/[Pp]laywright/.test(notice)) {
    fail(`The strip notice does not say where the arguments are going: ${notice}`);
  }
  const empty = separatorNotice([]);
  if (!/nothing/i.test(empty)) {
    fail(
      `With nothing left to forward the notice reads "${empty}" — it must say so rather than ` +
        `trailing off, which reads as truncated output.`
    );
  }
  okUnless(beforeNotice, 'the strip is announced, naming the token and the forwarded arguments');
}

console.log('harness argv — wiring');
const beforeWiring = failures.length;

// Every launcher that forwards arguments to Playwright — DISCOVERED, not listed. All three
// existing harnesses had this defect, so a fourth will most likely be written the same way, and a
// hand-maintained list would pass over it in silence: the failure mode of the bug itself. This is
// the reasoning `tsconfig.tooling.json` already adopted for its `include` patterns — glob, so the
// next `it-*.js` is covered on the day it is added rather than on the day someone remembers.
const isHarness = (name) => /^it-.*\.js$/.test(name);
const isLauncher = (name) => /^start-.*\.js$/.test(name);
const rootFiles = readdirSync(ROOT).sort();
const HARNESSES = rootFiles.filter(isHarness);

// An enumeration that cannot match is indistinguishable from a clean result, so an empty one is a
// failure rather than a quiet pass — the pattern itself is the thing being trusted here.
if (HARNESSES.length === 0) {
  fail(
    `No it-*.js harness was found in ${ROOT}. Either they have been renamed or moved — in which ` +
      `case this pattern must follow them — or this check has been silently testing nothing.`
  );
}

const WRAPPED_CALL = 'playwrightArgsFrom(process.argv.slice(2))';

/**
 * A launcher's code with comments removed and whitespace flattened.
 *
 * Comments go first because all of these launchers now DISCUSS this separator in prose, and a
 * search satisfied by a comment would pass against one that had stopped doing any of it.
 * Whitespace is flattened so a reformat breaking a call across lines does not read as a launcher
 * that stopped making it.
 */
function readCode(rel) {
  try {
    return stripComments(readFileSync(resolve(ROOT, rel), 'utf8')).replace(/\s+/g, ' ');
  } catch (err) {
    fail(`${rel} could not be read, so its argument forwarding could not be checked: ${err.message}`);
    return undefined;
  }
}

for (const rel of HARNESSES) {
  const code = readCode(rel);
  if (code === undefined) continue;

  const required = [
    ['harness-argv.mjs', 'does not import the shared argument handling'],
    [WRAPPED_CALL, `does not read its arguments through ${WRAPPED_CALL}`],
    ['separatorNotice(', 'never announces a strip, so it would adjust its own arguments silently'],
    ['...playwrightArgs', 'never spreads the handled arguments into its Playwright invocation'],
  ];
  for (const [needle, why] of required) {
    if (!code.includes(needle)) {
      fail(
        `${rel} ${why} (no "${needle}" in its code). Arguments passed to it would be discarded by ` +
          `Playwright and the run would report success over the wrong tests.`
      );
    }
  }

  // The one that catches a revert. `process.argv.slice(2)` appears legitimately INSIDE the wrapped
  // call, so those occurrences are removed before looking; anything left is a raw read heading
  // straight for the Playwright argv.
  if (code.split(WRAPPED_CALL).join('').includes('process.argv.slice(2)')) {
    fail(
      `${rel} still reads process.argv.slice(2) directly somewhere outside ${WRAPPED_CALL}. That is ` +
        `the pre-QA-34 shape: the separator pnpm inserts reaches Playwright, which silently drops ` +
        `every argument after it.`
    );
  }
}

// The interactive launchers take no Playwright arguments at all, which is why they are exempt from
// everything above rather than merely untested. Stated as an assertion because the exemption is
// only sound while it stays true: the day one of them starts reading its own argv to forward, it
// inherits this defect, and the reader of that diff should be told here rather than discovering it
// from a run that tested the wrong thing.
for (const rel of rootFiles.filter(isLauncher)) {
  const code = readCode(rel);
  if (code === undefined) continue;
  if (code.split(WRAPPED_CALL).join('').includes('process.argv.slice(2)')) {
    fail(
      `${rel} reads process.argv.slice(2) outside ${WRAPPED_CALL}. If it now forwards arguments to ` +
        `Playwright it must route them through scripts/harness-argv.mjs, or the separator pnpm ` +
        `inserts will silently discard everything after it. If it reads its arguments for some ` +
        `other purpose, this check is the wrong shape and should be changed deliberately.`
    );
  }
}

okUnless(
  beforeWiring,
  `${HARNESSES.length} harnesses route their argv through the shared handling ` +
    `(${HARNESSES.join(', ')})`
);

if (failures.length > 0) {
  console.error(`\nHarness argv check failed (${failures.length}):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error('');
  process.exit(1);
}

console.log('\nharness argv: all checks passed');
