// QA-46 — DERIVE the per-test sum of budgeted waits from the specs, instead of restating one.
//
// WHAT THIS IS FOR. A Playwright `timeout` is the budget for a whole test: `beforeEach` plus the
// body plus `afterEach`. Every per-assertion budget inside that test is reachable only if the sum
// of the budgets before it, plus its own, fits inside that number. When it does not, the test dies
// at the config's backstop instead of at the budget naming its own step — every failure arrives as
// one anonymous test timeout, and the per-assertion numbers are decoration. That is QA-30's defect,
// and the cheapest way to reintroduce it is to raise one budget by 20 000 ms in a spec file while
// nothing looks at the config.
//
// WHY A DERIVATION AND NOT A PIN. QA-43 and QA-44 pinned the two configs' `timeout` by value, which
// catches the config moving. Neither could catch the SPECS moving, and the guard's own explanation
// of why 150 000 was enough — the largest per-test sum, restated as a constant — was itself an
// unguarded measured number that the same edit would falsify. Pinning that constant too would have
// compared the guard's number to the guard's number: green, idempotent, and measuring nothing. So
// this computes the sums from the source and the caller asserts an INEQUALITY, which fails when the
// relationship breaks rather than when a number changes.
//
// WHY A NARROW SOURCE SCAN AND NOT A TYPESCRIPT PARSE. Every way this breaks is a numeric literal
// or a named constant sitting in a spec file — a budget edited upward, a step added to a test, a
// constant re-measured. A parse buys the evaluation of computed expressions, which is not where the
// risk lives, and pays for it with a surface that rots against every spec refactor. The guards in
// this directory are source scans that state their limits; this is one more of them.
//
// WHAT IT CANNOT SEE — the boundary, and it is MEASURED rather than asserted. Each of these has a
// fixture in scripts/check-first-attempt-rate.mjs pinning the behaviour described:
//
//   - A BUDGET INSIDE A HELPER is invisible. Only statements lexically inside a `test(...)` body or
//     a `beforeEach`/`afterEach` hook are summed, so `await waitForReply(page)` contributes nothing
//     however large the budget inside `waitForReply` is, and the sum comes out too LOW — the
//     direction that passes. This is the demonstrated blind spot: it is the one shape here that
//     fails silently, and the fixture records the exact under-count so the limit stays true.
//   - A BUDGET THIS CANNOT EVALUATE is REFUSED, not skipped. `{ timeout: BASE * 2 }`, a budget read
//     from a variable declared with something other than a plain number, two `timeout:` keys in one
//     statement: each throws, naming the file and the statement. A budget silently contributing
//     zero is the failure this file exists to stop, so an unreadable one stops the run instead.
//   - `test.setTimeout()`, `test.slow()` and `test.describe.configure({ timeout })` are not read.
//     All three RAISE a test's own budget, so ignoring them makes the inequality conservative — it
//     can red on a test that would in fact have fitted, which is a loud and correctable failure
//     rather than a silent one. Reasoned, not measured: no spec here uses any of them.
//   - HOOK SCOPE IS APPROXIMATED. Every `beforeEach`/`afterEach` in a file is added to every test in
//     that file, so nested describes with their own hooks over-count. Conservative in the same
//     direction, and again not the shape that hides a defect.
//   - AN ASSERTION ENDS AT A SEMICOLON. Every spec here is prettier-formatted and states them, and
//     a file relying on automatic semicolon insertion would have one assertion's budget read as
//     part of the next statement — which surfaces as a refusal (two `timeout:` keys in one
//     statement) rather than as a wrong number, so it is loud. Reasoned, not measured.
//
// The arithmetic it DOES do is the arithmetic the spec files' own footers do by hand, and that
// agreement is the evidence it is right: on the four specs under the root config this reproduces
// 120 000 / 135 000 / 70 000 / 55 000, the four sums QA-30, QA-32/QA-35, QA-33 and QA-35 recorded
// independently of it.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { blankCommentsAndStrings, stripComments } from './source-scan.mjs';

/**
 * Playwright's default `expect` timeout. An assertion with no `{ timeout }` of its own is given
 * this, and several of the sums the spec files record depend on it: `chat-gth.spec.ts`'s
 * `beforeEach` deliberately leaves `.chat-interface` on the default and counts 5 000 for it.
 *
 * Not configurable in this repository — no config here sets `expect.timeout` — and a config that
 * started to would need this to follow, which is why the caller reads it from here rather than
 * spelling 5 000 into a message.
 */
export const PLAYWRIGHT_DEFAULT_EXPECT_MS = 5_000;

/** Playwright's own default `testMatch`, which is what decides whether a file is a spec at all. */
const SPEC_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;

/** Assertions that WAIT. A non-awaited `expect(...)` does not retry and buys no time. */
const AWAITED_ASSERTION = /(?<![\w$.])await\s+expect\s*(?:\.\s*poll)?\s*\(/g;

const TEST_CALL = /(?<![\w$.])test(?:\s*\.\s*(?:only|skip|fixme))?\s*\(/g;
const HOOK_CALL = /(?<![\w$.])test\s*\.\s*(beforeEach|afterEach)\s*\(/g;
const NUMERIC_CONST = /(?<![\w$])const\s+([A-Za-z_$][\w$]*)\s*=\s*(\d[\d_]*)\s*;/g;
const TIMEOUT_KEY = /(?<![\w$.])timeout\s*:/g;
const TIMEOUT_VALUE = /(?<![\w$.])timeout\s*:\s*([A-Za-z_$][\w$]*|\d[\d_]*)\s*(?=[,}])/;

const num = (raw) => Number(String(raw).replace(/_/g, ''));

/** Every `{`-depth in `code`, where a key directly inside `defineConfig({ … })` sits at depth 1. */
function braceDepths(code) {
  const depths = [];
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (c === '}') depth -= 1;
    depths[i] = depth;
    if (c === '{') depth += 1;
  }
  return depths;
}

/** The index just past the `)` matching the `(` at `open`, over comment- and string-blanked code. */
function matchingParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced parentheses from offset ${open}`);
}

/**
 * The index of the `;` ending the statement that starts at `from`.
 *
 * Tracked at bracket depth rather than by searching for the next `;`, because an `expect.poll`
 * callback may be a block with statements of its own, and the first `;` would then be inside it.
 */
function statementEnd(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ';' && depth === 0) return i;
  }
  return code.length;
}

/**
 * Every `timeout:` key in a config, with the brace depth it sits at.
 *
 * THE BUG THIS EXISTS TO FIX. The pins it replaced read the first `timeout:` that a line-anchored
 * regex matched, which is the TEST timeout only for as long as it happens to be written first. A
 * `webServer: { timeout: 30_000 }` added above it — the exact shape
 * `packages/galvanized-pukeko-vue-ui/playwright.config.ts` already has — would have retargeted both
 * pins onto a dev-server boot tolerance, silently, and the pin would then have been asserting a
 * number about something else entirely. Depth tells the two apart: a key of the object passed to
 * `defineConfig` is at depth 1, and anything nested inside one of its values is deeper.
 */
export function configTimeoutKeys(source) {
  const code = blankCommentsAndStrings(source);
  const depths = braceDepths(code);
  const found = [];
  for (const m of code.matchAll(/(?<![\w$.])timeout\s*:\s*(\d[\d_]*)\s*(?=[,}])/g)) {
    found.push({ index: m.index, depth: depths[m.index], ms: num(m[1]) });
  }
  return found;
}

/**
 * The test timeout a Playwright config states, or `null` if it states none as a plain number.
 *
 * Throws if the config states more than one top-level `timeout:` — that is not a case to guess at,
 * and a guess would be a pin asserting a number about whichever key was written first.
 */
export function configTestTimeout(source, label) {
  const top = configTimeoutKeys(source).filter((k) => k.depth === 1);
  if (top.length > 1) {
    throw new Error(
      `${label} states ${top.length} top-level \`timeout:\` keys (${top
        .map((k) => k.ms)
        .join(', ')}). Only one of them can be the test timeout, and nothing here can tell which, ` +
        'so the pin refuses rather than picking the first.'
    );
  }
  return top[0] ?? null;
}

/** A config's `testDir`, read as written. Exactly one is required: a guess picks the wrong suite. */
export function configTestDir(source, label) {
  const matches = [...stripComments(source).matchAll(/(?<![\w$.])testDir\s*:\s*['"]([^'"]+)['"]/g)];
  if (matches.length !== 1) {
    throw new Error(
      `${label} states ${matches.length} \`testDir\` keys; exactly one is needed to know which ` +
        'directory holds the specs this timeout governs.'
    );
  }
  return matches[0][1];
}

/** The string literal that a call's first argument is, read out of the original source. */
function firstStringArgument(source, openParen) {
  const m = /^\s*(['"`])((?:\\.|[^\\])*?)\1/.exec(source.slice(openParen + 1));
  return m ? m[2] : null;
}

/**
 * The waits one region of a spec budgets, in source order.
 *
 * `region` is a slice of the comment- and string-blanked code; `offset` is where it starts in the
 * file, so a message can point at the original text.
 */
function budgetsIn(code, from, to, consts, label) {
  const budgets = [];
  AWAITED_ASSERTION.lastIndex = from;
  let m = AWAITED_ASSERTION.exec(code);
  while (m && m.index < to) {
    const start = m.index;
    const end = statementEnd(code, start);
    const statement = code.slice(start, Math.min(end, to));
    const keys = [...statement.matchAll(TIMEOUT_KEY)];
    if (keys.length > 1) {
      throw new Error(
        `${label}: an assertion at offset ${start} states ${keys.length} \`timeout:\` keys, so ` +
          'which one is its budget is ambiguous. Split the assertion, or teach this scan the shape.'
      );
    }
    if (keys.length === 0) {
      budgets.push({ ms: PLAYWRIGHT_DEFAULT_EXPECT_MS, source: 'the Playwright expect default' });
    } else {
      const value = TIMEOUT_VALUE.exec(statement);
      if (!value) {
        throw new Error(
          `${label}: an assertion at offset ${start} states a \`timeout:\` whose value is not a ` +
            'plain number or a named constant, so this scan cannot add it up. A budget that ' +
            'silently counted as zero is the defect this file exists to stop, so it refuses ' +
            'instead: give the value a file-level `const`, or extend this scan deliberately.'
        );
      }
      const token = value[1];
      if (/^\d/.test(token)) {
        budgets.push({ ms: num(token), source: `the literal ${token}` });
      } else if (consts.has(token)) {
        budgets.push({ ms: consts.get(token), source: token });
      } else {
        throw new Error(
          `${label}: an assertion at offset ${start} budgets \`${token}\`, which is not declared ` +
            'in this file as a constant with a plain numeric value. This scan will not guess at ' +
            'it — see the note above about a budget counting as zero.'
        );
      }
    }
    AWAITED_ASSERTION.lastIndex = Math.max(end, start + 1);
    m = AWAITED_ASSERTION.exec(code);
  }
  return budgets;
}

const sum = (budgets) => budgets.reduce((total, b) => total + b.ms, 0);

/**
 * Every test in one spec source, with the budget Playwright's `timeout` has to cover for it.
 *
 * Throws if the file holds no test at all: an enumeration that cannot match is indistinguishable
 * from a clean result, and this one is an input to an inequality that would then hold vacuously.
 */
export function specBudgets(source, label) {
  const code = blankCommentsAndStrings(source);

  const consts = new Map();
  for (const m of code.matchAll(NUMERIC_CONST)) consts.set(m[1], num(m[2]));

  const hooks = [];
  for (const m of code.matchAll(HOOK_CALL)) {
    const open = m.index + m[0].length - 1;
    hooks.push(...budgetsIn(code, open, matchingParen(code, open), consts, label));
  }

  const tests = [];
  for (const m of code.matchAll(TEST_CALL)) {
    const open = m.index + m[0].length - 1;
    const close = matchingParen(code, open);
    const body = budgetsIn(code, open, close, consts, label);
    tests.push({
      file: label,
      title: firstStringArgument(source, open) ?? `the test at offset ${open}`,
      hookMs: sum(hooks),
      bodyMs: sum(body),
      totalMs: sum(hooks) + sum(body),
      budgets: [...hooks, ...body],
    });
  }

  if (tests.length === 0) {
    throw new Error(
      `${label} holds no \`test(…)\` call this scan can find. Either the file really declares no ` +
        'test, or it declares them in a shape this pattern does not match — and the second reads ' +
        'exactly like a spec with no budgets to check, which is the way this guard goes quiet.'
    );
  }

  return tests;
}

/** Every spec file under `dir`, in the order Playwright would find them. */
export function specFilesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...specFilesUnder(full));
    else if (SPEC_FILE.test(entry)) found.push(full);
  }
  return found;
}

/**
 * The whole derivation for one config: its test directory, its specs, every test's budget sum, and
 * the largest of them — which is the number the config's `timeout` has to cover.
 */
export function deriveBudgets(repoRoot, configPath, configSource) {
  const dir = join(repoRoot, configTestDir(configSource, configPath));
  const files = specFilesUnder(dir);
  if (files.length === 0) {
    throw new Error(
      `no spec file under ${relative(repoRoot, dir)}, which ${configPath} names as its testDir. ` +
        'An empty enumeration makes every check below pass while measuring nothing.'
    );
  }
  const tests = [];
  for (const file of files) {
    tests.push(...specBudgets(readFileSync(file, 'utf8'), relative(repoRoot, file)));
  }
  const largest = tests.reduce((a, b) => (b.totalMs > a.totalMs ? b : a));
  return { dir: relative(repoRoot, dir), files: files.map((f) => relative(repoRoot, f)), tests, largest };
}

/** The largest sum in each file, for a run to print — the derivation, shown rather than restated. */
export function largestPerFile(tests) {
  const byFile = new Map();
  for (const t of tests) {
    const held = byFile.get(t.file);
    if (!held || t.totalMs > held.totalMs) byFile.set(t.file, t);
  }
  return [...byFile.values()];
}
