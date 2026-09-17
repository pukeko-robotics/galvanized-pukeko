#!/usr/bin/env node
// Guard: the local-GPU lock still works, and still rendezvouses with the OTHER implementation.
//
// OPS-118. `scripts/ollama-gpu-lock.mjs` is a second implementation of a lock whose first
// implementation lives in another repository — Gaunt Sloth's
// `packages/app/integration-tests/support/ollamaLock.mjs`. Neither can import the other (see the
// header of the lock for why), so what makes them exclude each other is agreement on two things:
// the lockfile PATH, and the lockfile CONTENT. Both are asserted here against pinned values.
//
// WHY PINNED VALUES AND NOT A RECOMPUTATION. Asserting that the path equals what the path function
// computes is a tautology that passes against any implementation, including one that has silently
// drifted away from the other repository's. The constants below are instead MEASURED: they are the
// output of running both implementations side by side and comparing them, which is the only thing
// that can actually see a divergence. That experiment cannot live in this repository — it needs a
// Gaunt Sloth checkout, and this repository is cloned and built on its own — so its result is
// pinned here and its provenance recorded:
//
//   Measured 2026-09-12 against gaunt-sloth
//   packages/app/integration-tests/support/ollamaLock.mjs, all four hosts MATCH, and the
//   127.0.0.1:11434 value is also the lockfile a real `pnpm run it ollama` in that repository was
//   observed to take. Re-measure by running both implementations' defaultLockPath over the HOSTS
//   below and comparing; if they ever differ, the two are no longer serialising and one side has
//   to move.
//
// If a value here ever needs changing, that is not a test to update — it is the two copies coming
// apart, and the fix is to change both repositories together.
//
// THE THIRD PARTICIPANT. This repository's Koog example drives the same daemon from a JVM server
// that reads its own variable (`OLLAMA_BASE_URL`) and carries its own default spelling of the
// loopback address. It takes part not by computing the key on the JVM side but by having
// `it-koog.js` resolve the address once in Node, lock on it, and inject that same string into the
// server's environment — one derivation rather than a third formula to keep in step. Section 10
// pins that, and it is also where the reason the two spellings must NOT be conflated is recorded.
//
// No daemon, no GPU and no model are involved: the lock is a file, so all of this runs anywhere.
//
// Run: node scripts/check-ollama-gpu-lock.mjs   (wired into "pnpm test")

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_OLLAMA_HOST,
  KOOG_OLLAMA_URL_ENV_VAR,
  LOCAL_GPU_PROVIDERS,
  createOllamaLock,
  defaultLockPath,
  isHolderAlive,
  isLocalGpuProvider,
  resolveKoogOllamaBaseUrl,
  resolveOllamaHost,
} from './ollama-gpu-lock.mjs';
import { AG_UI_EXAMPLE_DIR, configFileNameFor, declaredLlmType } from './llm-config.mjs';
import { stripComments } from './source-scan.mjs';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');

// ---------------------------------------------------------------------------
// Child mode — used by the two-process mutual-exclusion check below.
// ---------------------------------------------------------------------------
// Real processes rather than two acquires inside one: the liveness probe asks the operating system
// about a pid, so a same-process test would be answering a question it never really asks.
if (process.argv[2] === '--hold') {
  const [, , , lockPath, holdMs] = process.argv;
  const lock = createOllamaLock({ lockPath, waitMs: 60_000, log: () => {} });
  const release = await lock.acquire();
  console.log(`ACQUIRED ${Date.now()}`);
  await new Promise((r) => setTimeout(r, Number(holdMs)));
  console.log(`RELEASING ${Date.now()}`);
  release();
  process.exit(0);
}

const failures = [];
const fail = (msg) => failures.push(msg);

// A private directory for every lockfile this guard creates. Never the real lock path: a test that
// took the lockfile a genuine run uses would stall that run, or be stalled by it.
const SCRATCH = mkdtempSync(join(tmpdir(), 'gp-lock-check-'));
let seq = 0;
const scratchLock = () => join(SCRATCH, `lock-${process.pid}-${(seq += 1)}`);

// ---------------------------------------------------------------------------
// 1. The host formula — the rendezvous key.
// ---------------------------------------------------------------------------
// This must stay byte-identical to the expression in gaunt-sloth's it.js, including the parts that
// look wrong on their own: a bare host:port is NOT expanded into a URL, because the other side
// does not expand it either and the two must derive the same STRING.
{
  const cases = [
    [{}, DEFAULT_OLLAMA_HOST, 'an unset environment falls back to the documented default'],
    [{ OLLAMA_HOST: '' }, DEFAULT_OLLAMA_HOST, 'an empty OLLAMA_HOST falls back'],
    [
      { OLLAMA_HOST: 'http://192.168.1.50:11434' },
      'http://192.168.1.50:11434',
      'OLLAMA_HOST is honoured',
    ],
    [
      { OLLAMA_HOST: 'http://192.168.1.50:11434///' },
      'http://192.168.1.50:11434',
      'trailing slashes are stripped',
    ],
    [
      { OLLAMA_HOST: '127.0.0.1:1234' },
      '127.0.0.1:1234',
      'a bare host:port is used AS GIVEN — normalising it here would key this side on a ' +
        'different string from the other implementation and the two would stop serialising',
    ],
  ];
  for (const [env, expected, why] of cases) {
    const got = resolveOllamaHost(env);
    if (got !== expected) {
      fail(`resolveOllamaHost(${JSON.stringify(env)}) returned "${got}", expected "${expected}" — ${why}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. The lockfile path — measured against the other implementation. See the header.
// ---------------------------------------------------------------------------
{
  const HOSTS = [
    ['http://127.0.0.1:11434', 'gth-it-ollama-59869455d4c6.lock'],
    ['http://192.168.1.50:11434', 'gth-it-ollama-5f90929b9840.lock'],
    ['127.0.0.1:1234', 'gth-it-ollama-90f6505db61e.lock'],
    // `KoogAgent.kt`'s committed Ollama default is `localhost`, not `127.0.0.1`. Pinned here to
    // record that it is a DIFFERENT file for the SAME daemon — which is why `it-koog.js` resolves
    // the address itself and injects it into the JVM rather than letting this default apply
    // (OPS-119, and section 10 below pins that wiring). Remove the injection and a Koog run lands
    // on this path while every other participant is on the one above.
    ['http://localhost:11434', 'gth-it-ollama-5fbca2731f95.lock'],
  ];
  for (const [host, expected] of HOSTS) {
    const got = basename(defaultLockPath(host));
    if (got !== expected) {
      fail(
        `defaultLockPath("${host}") names "${got}", not the measured "${expected}". This repository ` +
          `and Gaunt Sloth now take different lockfiles for the same daemon, so real-LLM runs in ` +
          `the two no longer serialise. Fix both implementations together — do not edit this value.`
      );
    }
  }
  if (defaultLockPath('http://127.0.0.1:11434') === defaultLockPath('http://localhost:11434')) {
    fail('Two different host strings produced the same lockfile; the key is not host-specific.');
  }
  // The whole default path, as a launcher with an unset environment will take it.
  const byDefault = defaultLockPath(resolveOllamaHost({}));
  if (basename(byDefault) !== 'gth-it-ollama-59869455d4c6.lock') {
    fail(`With no OLLAMA_HOST set, this side takes ${byDefault} — not the measured shared lockfile.`);
  }
}

// ---------------------------------------------------------------------------
// 3. The lockfile CONTENT — the other half of the contract.
// ---------------------------------------------------------------------------
// The other implementation reads `pid` and `at` back out of this file to decide whether a holder
// has crashed or gone stale. A file it cannot parse is treated as held, so it would wait out its
// full deadline behind a run of ours that had already finished.
{
  const lockPath = scratchLock();
  const lock = createOllamaLock({ lockPath, log: () => {} });
  const release = await lock.acquire();
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (e) {
    fail(`The lockfile this implementation writes is not readable JSON: ${e.message}`);
  }
  if (parsed) {
    if (parsed.pid !== process.pid) {
      fail(`Lockfile records pid ${parsed.pid}, not the holding process's ${process.pid}.`);
    }
    if (!Number.isFinite(parsed.at) || Math.abs(Date.now() - parsed.at) > 60_000) {
      fail(`Lockfile records at=${parsed.at}, which is not a plausible current epoch-millis.`);
    }
  }
  release();
  try {
    readFileSync(lockPath, 'utf8');
    fail('Releasing the lock left the lockfile behind; the next run would wait it out.');
  } catch {
    /* gone, as it should be */
  }
}

// ---------------------------------------------------------------------------
// 4. Mutual exclusion, with two real processes.
// ---------------------------------------------------------------------------
{
  const lockPath = scratchLock();
  const HOLD_MS = 1200;
  const SECOND_STARTS_AFTER_MS = 300;

  const run = (holdMs, delayMs) =>
    new Promise((resolveRun) => {
      setTimeout(() => {
        const out = [];
        const p = spawn(process.execPath, [SELF, '--hold', lockPath, String(holdMs)]);
        p.stdout.on('data', (d) => out.push(String(d)));
        p.on('close', (code) => resolveRun({ code, out: out.join('') }));
      }, delayMs);
    });

  const [first, second] = await Promise.all([
    run(HOLD_MS, 0),
    run(50, SECOND_STARTS_AFTER_MS),
  ]);

  const at = (text, label) => {
    const m = new RegExp(`${label} (\\d+)`).exec(text);
    return m ? Number(m[1]) : undefined;
  };
  const firstReleasing = at(first.out, 'RELEASING');
  const secondAcquired = at(second.out, 'ACQUIRED');

  if (first.code !== 0 || second.code !== 0) {
    fail(`A lock-holding child exited non-zero (${first.code}, ${second.code}).`);
  } else if (firstReleasing === undefined || secondAcquired === undefined) {
    fail('A lock-holding child did not report its timings; the exclusion check could not run.');
  } else if (secondAcquired < firstReleasing) {
    fail(
      `Two processes held the lock at once: the second acquired ${firstReleasing - secondAcquired}ms ` +
        `BEFORE the first released. Nothing is being serialised.`
    );
  }
}

// ---------------------------------------------------------------------------
// 5. A crashed holder is reclaimed immediately.
// ---------------------------------------------------------------------------
// Without this, a run killed mid-flight wedges every later run for the whole of staleMs.
{
  const lockPath = scratchLock();
  // A pid that provably no longer exists: run a process to completion and reuse its number.
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  if (isHolderAlive(dead)) {
    fail(`isHolderAlive(${dead}) says a process that has already exited is still running.`);
  }
  writeFileSync(lockPath, JSON.stringify({ pid: dead, at: Date.now() }));
  const started = Date.now();
  const lock = createOllamaLock({ lockPath, waitMs: 5_000, log: () => {} });
  try {
    const release = await lock.acquire();
    if (Date.now() - started > 3_000) {
      fail('Reclaiming a dead holder took seconds; it should not wait at all.');
    }
    release();
  } catch (e) {
    fail(`A lock held by the dead pid ${dead} was not reclaimed: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// 6. A LIVE holder is not stolen, and a waiter eventually gives up loudly.
// ---------------------------------------------------------------------------
// The counterpart to 5, and the more important half: stealing from a live holder puts two runs on
// one GPU, which is the entire failure this lock exists to prevent.
{
  const lockPath = scratchLock();
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }));
  const lock = createOllamaLock({ lockPath, waitMs: 500, staleMs: 60 * 60_000, log: () => {} });
  try {
    const release = await lock.acquire();
    release();
    fail(
      `A lock held by a LIVE process (pid ${process.pid}) was taken anyway. Two runs would now be ` +
        `driving the same daemon.`
    );
  } catch (e) {
    if (!/still held/.test(e.message)) {
      fail(`Waiting on a live holder failed with an unexpected error: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. The time-based backstop still reclaims a hold that has gone on too long.
// ---------------------------------------------------------------------------
// A holder can be alive and yet finished with the GPU — a wedged process, or one whose release
// hook never ran. staleMs is the backstop for everything the liveness probe cannot see.
{
  const lockPath = scratchLock();
  const staleMs = 1_000;
  writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, at: Date.now() - (staleMs + 5_000) })
  );
  const lock = createOllamaLock({ lockPath, waitMs: 5_000, staleMs, log: () => {} });
  try {
    const release = await lock.acquire();
    release();
  } catch (e) {
    fail(`A hold older than staleMs was not reclaimed: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// 8. The gate: which configurations count as local-GPU.
// ---------------------------------------------------------------------------
{
  const configDir = resolve(ROOT, AG_UI_EXAMPLE_DIR);
  const ollamaType = declaredLlmType(resolve(configDir, configFileNameFor('ollama')));
  if (ollamaType !== 'ollama') {
    fail(
      `The shipped ollama configuration declares llm.type ${JSON.stringify(ollamaType)}, so the ` +
        `harness would not recognise it as a local-GPU run and would not lock.`
    );
  }
  if (!LOCAL_GPU_PROVIDERS.includes(ollamaType)) {
    fail(`LOCAL_GPU_PROVIDERS does not list "${ollamaType}", so an ollama run would not lock.`);
  }
  const openaiType = declaredLlmType(resolve(configDir, configFileNameFor('openai')));
  if (LOCAL_GPU_PROVIDERS.includes(openaiType)) {
    fail(
      `LOCAL_GPU_PROVIDERS lists "${openaiType}", a hosted provider. Runs that contend for nothing ` +
        `would queue behind local ones.`
    );
  }
  if (declaredLlmType(resolve(configDir, 'no-such-file.json')) !== undefined) {
    fail('declaredLlmType returned a type for a file that does not exist.');
  }
}

// ---------------------------------------------------------------------------
// 9. THE HARNESS ACTUALLY TAKES THE LOCK.
// ---------------------------------------------------------------------------
// Everything above tests the module. None of it notices a harness that stopped calling it — which
// leaves every check green while restoring the collision this node fixed. Comments are stripped
// first: this file's own subject matter is discussed in prose in those launchers, and a search
// satisfied by a comment would pass against a harness that does not lock at all.
{
  const read = (rel) => {
    try {
      return stripComments(readFileSync(resolve(ROOT, rel), 'utf8'));
    } catch {
      fail(`${rel} could not be read; the GPU-lock wiring could not be checked.`);
      return undefined;
    }
  };

  const harness = read('it-gth-ag-ui.js');
  if (harness !== undefined) {
    const required = [
      ['ollama-gpu-lock.mjs', 'does not import the GPU lock'],
      ['createOllamaLock(', 'does not create a lock'],
      ['.acquire()', 'never acquires the lock it created'],
      ['LOCAL_GPU_PROVIDERS', 'does not gate on which providers contend for the GPU'],
      ["process.on('exit'", 'never registers the release hook, so the lockfile would outlive it'],
    ];
    for (const [needle, why] of required) {
      if (!harness.includes(needle)) {
        fail(
          `it-gth-ag-ui.js ${why} (no "${needle}" in its code). A real-LLM run there would collide ` +
            `with one in Gaunt Sloth instead of queueing behind it.`
        );
      }
    }
  }

  // The interactive launchers deliberately do NOT lock — see the note at the top of
  // scripts/ollama-gpu-lock.mjs. A developer's session is open-ended, and staleMs reclaims a hold
  // that outlasts it, so locking one would either rob the session or wedge every bounded run
  // behind it. This is a decision, not an omission; if it is ever revisited, change this check
  // deliberately and say why.
  for (const rel of [
    'start-gth-ag-ui.js',
    `${AG_UI_EXAMPLE_DIR}/start.js`,
    'examples/pukeko-koog-ag-ui/start.js',
  ]) {
    const source = read(rel);
    if (source !== undefined && source.includes('createOllamaLock(')) {
      fail(
        `${rel} takes the GPU lock. Interactive launchers must not: the hold is open-ended, and ` +
          `staleMs would either rob the session or wedge every bounded run behind it.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 10. THE KOOG HARNESS — same daemon, same lockfile, one derivation.
// ---------------------------------------------------------------------------
// OPS-119. The Koog example's server is a JVM process that reads its own variable
// (`OLLAMA_BASE_URL`) and carries its own default (`http://localhost:11434`), which denotes the
// same daemon as the `127.0.0.1` spelling above and hashes to a different file. Two runs would
// each hold a lock nothing else respected and drive one card.
//
// The fix is not a normaliser on either side. `it-koog.js` resolves the address ONCE, keys the
// lock on it, and injects that same string into the JVM's environment — so the address locked and
// the address dialled are one value. What has to be pinned is therefore that single derivation and
// the wiring that carries it, which is what this section does.
{
  // The precedence, as behaviour. The third case is the one the node was filed for: with nothing
  // set, a Koog run must land on the SAME lockfile as an unconfigured `gth` run, which means
  // resolving to the JavaScript default rather than the Kotlin one.
  const cases = [
    [{}, DEFAULT_OLLAMA_HOST, 'an unset environment resolves to the JS default, not the Kotlin one'],
    [
      { OLLAMA_HOST: 'http://192.168.1.50:11434' },
      'http://192.168.1.50:11434',
      'OLLAMA_HOST moves the Koog daemon too, so pointing the JS side elsewhere does not leave ' +
        'Koog behind on loopback with a lock nobody shares',
    ],
    [
      { OLLAMA_BASE_URL: 'http://10.0.0.5:11434' },
      'http://10.0.0.5:11434',
      'the variable the Koog README documents is honoured',
    ],
    [
      { OLLAMA_BASE_URL: 'http://10.0.0.5:11434', OLLAMA_HOST: 'http://192.168.1.50:11434' },
      'http://10.0.0.5:11434',
      'the Koog-specific variable wins when both are set — the injected value is what the server ' +
        'dials, so it must also be what the lock is keyed on',
    ],
    [
      { OLLAMA_BASE_URL: 'http://10.0.0.5:11434///' },
      'http://10.0.0.5:11434',
      'trailing slashes are stripped, matching resolveOllamaHost, so one daemon is one lock',
    ],
    [
      { OLLAMA_HOST: '127.0.0.1:1234' },
      '127.0.0.1:1234',
      'a bare host:port is passed through AS GIVEN. Synthesising a scheme would key this harness ' +
        'on a different string from Gaunt Sloth’s it.js and the two would stop serialising; ' +
        'Koog being handed a base URL it may refuse fails loudly, a broken rendezvous does not',
    ],
  ];
  for (const [env, expected, why] of cases) {
    const got = resolveKoogOllamaBaseUrl(env);
    if (got !== expected) {
      fail(
        `resolveKoogOllamaBaseUrl(${JSON.stringify(env)}) returned "${got}", expected "${expected}" — ${why}.`
      );
    }
  }

  // The property the whole section buys, stated directly rather than left to be inferred from the
  // cases above: with no environment at all, the Koog harness and the Gaunt Sloth harness take the
  // same file.
  const koogDefault = defaultLockPath(resolveKoogOllamaBaseUrl({}));
  const jsDefault = defaultLockPath(resolveOllamaHost({}));
  if (koogDefault !== jsDefault) {
    fail(
      `With nothing set, a Koog run would take ${basename(koogDefault)} while every other ` +
        `participant takes ${basename(jsDefault)}. They drive one daemon, so both would proceed ` +
        `at once against one card — the exact collision this lock exists to prevent.`
    );
  }
  // And the Kotlin fallback is NOT that file, which is why the injection is load-bearing rather
  // than belt-and-braces. If this ever stops holding, the injection could be dropped safely; until
  // then, dropping it silently reintroduces the split.
  if (defaultLockPath('http://localhost:11434') === jsDefault) {
    fail(
      'The Kotlin default `http://localhost:11434` now hashes to the shared lockfile. That would ' +
        'make the OLLAMA_BASE_URL injection in it-koog.js redundant, but it almost certainly ' +
        'means defaultLockPath stopped distinguishing hosts — check that before relaxing anything.'
    );
  }

  // The gate is case-insensitive because KoogAgent.kt routes on `LLM_PROVIDER?.lowercase()`. A
  // raw includes() would let `LLM_PROVIDER=Ollama` start a genuine Ollama run that took no lock.
  for (const spelling of ['ollama', 'Ollama', 'OLLAMA']) {
    if (!isLocalGpuProvider(spelling)) {
      fail(
        `isLocalGpuProvider("${spelling}") is false, but KoogAgent.kt lowercases LLM_PROVIDER ` +
          `before routing — so that spelling would drive the GPU without taking the lock.`
      );
    }
  }
  for (const hosted of ['google', 'openai', undefined]) {
    if (isLocalGpuProvider(hosted)) {
      fail(
        `isLocalGpuProvider(${JSON.stringify(hosted)}) is true. A hosted provider has no card to ` +
          `contend for; locking it queues a Gemini run behind an Ollama one for nothing.`
      );
    }
  }

  // The wiring. Everything above tests the module and none of it notices a harness that stopped
  // calling it — the omission that let this defect sit invisible behind a green `pnpm test`:
  // section 9 scanned `it-gth-ag-ui.js` only, so `it-koog.js` taking no lock at all was never a
  // failing check. Comments are stripped for the reason section 9 gives.
  const koog = (() => {
    try {
      return stripComments(readFileSync(resolve(ROOT, 'it-koog.js'), 'utf8'));
    } catch {
      fail('it-koog.js could not be read; the Koog GPU-lock wiring could not be checked.');
      return undefined;
    }
  })();
  if (koog !== undefined) {
    const required = [
      ['ollama-gpu-lock.mjs', 'does not import the GPU lock'],
      ['createOllamaLock(', 'does not create a lock'],
      ['.acquire()', 'never acquires the lock it created'],
      [
        'isLocalGpuProvider(',
        'does not gate on whether the run will drive the local card, so it would either lock ' +
          'every hosted run or lock none',
      ],
      [
        'resolveKoogOllamaBaseUrl(',
        'does not resolve the daemon address through the shared derivation, so its lock key and ' +
          'the JVM’s base URL are free to drift apart',
      ],
      [
        // A REGEX, and specifically not the bare variable name. `OLLAMA_BASE_URL` also names a
        // local constant in that file, so a plain substring search for it is satisfied by the
        // declaration alone and stays green with the injection deleted — measured: removing the
        // injection left this check passing until it was tightened to the assignment itself.
        // Whitespace-tolerant so reformatting the object literal does not cry wolf.
        /\[\s*KOOG_OLLAMA_URL_ENV_VAR\s*\]\s*:\s*OLLAMA_BASE_URL\b/,
        'does not inject the resolved address into the server environment, so KoogAgent.kt falls ' +
          'back to its own localhost default and dials the daemon under a name that hashes to a ' +
          'different lockfile from the one this run is holding',
      ],
      ["process.on('exit'", 'never registers the release hook, so the lockfile would outlive it'],
    ];
    for (const [needle, why] of required) {
      const present =
        needle instanceof RegExp ? needle.test(koog) : koog.includes(needle);
      if (!present) {
        fail(
          `it-koog.js ${why} (no ${needle instanceof RegExp ? String(needle) : `"${needle}"`} in ` +
            `its code). A local-GPU run there would collide with one in this repository or in ` +
            `Gaunt Sloth instead of queueing behind it.`
        );
      }
    }
  }

  // ORDER, not just presence. A run that has to wait must be holding nothing open while it waits.
  // Acquiring after anything started would begin a gradle compile and a dev server, then block for
  // up to the full waitMs — leaving both bound to the example's ports for the duration.
  //
  // BOTH spawn sites are checked, not just the Koog server's. This harness starts two processes,
  // and a check that pinned only the first would leave the comment above asserting a property the
  // guard did not cover — the same gap as a needle that matches a declaration instead of a use.
  if (koog !== undefined) {
    // CALL SITES, not names: `startKoogAgent()` also occurs in `function startKoogAgent() {`, which
    // sits above the lock, so searching for the bare name reports correct code as broken.
    const acquiredAt = koog.indexOf('.acquire()');
    const spawnSites = [
      ['the Koog server', 'a Koog server', /\bkoogProc\s*=\s*startKoogAgent\(\)/],
      ['the web client', 'a web client', /\bwebProc\s*=\s*spawn\(/],
    ];
    for (const [label, indefinite, re] of spawnSites) {
      const startsAt = re.exec(koog)?.index ?? -1;
      if (startsAt < 0) {
        fail(
          `it-koog.js no longer has a recognisable start for ${indefinite}, so the guard cannot ` +
            `tell whether the GPU lock is taken before it. Update this check rather than ` +
            `dropping it.`
        );
        continue;
      }
      if (acquiredAt >= 0 && acquiredAt > startsAt) {
        fail(
          `it-koog.js starts ${label} before it acquires the GPU lock. A run that has to queue ` +
            `would sit on the example ports, with a gradle build running, while it waited.`
        );
      }
    }
  }

  // The JVM half of the same wiring. The injection above is only load-bearing while the server
  // still reads that variable name — rename it on the Kotlin side and the Node side goes on
  // setting a variable nobody reads, the fallback applies again, and every check up to here stays
  // green. That is a silent un-pairing across a language boundary, which is precisely what this
  // file exists to refuse. Pinned by reading the source: the JVM cannot be imported from here.
  const KOOG_AGENT_KT =
    'examples/pukeko-koog-ag-ui/koog-agent/src/main/kotlin/com/pukeko/example/koog/KoogAgent.kt';
  let kotlin;
  try {
    kotlin = stripComments(readFileSync(resolve(ROOT, KOOG_AGENT_KT), 'utf8'));
  } catch {
    fail(`${KOOG_AGENT_KT} could not be read; the JVM half of the lock wiring is unverified.`);
  }
  if (kotlin !== undefined) {
    if (!kotlin.includes(`System.getenv("${KOOG_OLLAMA_URL_ENV_VAR}")`)) {
      fail(
        `${KOOG_AGENT_KT} no longer reads ${KOOG_OLLAMA_URL_ENV_VAR}. it-koog.js injects the ` +
          `address it locked under that name, so the server would be resolving its daemon some ` +
          `other way and the lock would guard an address nothing dials.`
      );
    }
    // A provenance check rather than a hazard: changing this literal does not break the injection
    // the way renaming the variable does. It invalidates section 2's pinned entry for
    // `http://localhost:11434`, which documents the file an un-injected Koog run would take — a
    // stated fact that would quietly become about a spelling nothing uses. The remedy is a
    // deliberate two-line edit, not a re-derivation of the lock.
    if (!kotlin.includes('"http://localhost:11434"')) {
      fail(
        `${KOOG_AGENT_KT}'s Ollama fallback is no longer "http://localhost:11434". The injection ` +
          `in it-koog.js still works, but section 2 pins that spelling as the file an un-injected ` +
          `Koog run would take, and that is now about an address the server never uses. Update ` +
          `section 2's entry and this literal together, recomputing the hash for the new default.`
      );
    }
  }
}

rmSync(SCRATCH, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\nOllama GPU lock check failed (${failures.length}):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error('');
  process.exit(1);
}

console.log(
  `Ollama GPU lock OK (shared lockfile ${basename(defaultLockPath(resolveOllamaHost({})))}; ` +
    `local-GPU providers: ${LOCAL_GPU_PROVIDERS.join(', ')}).`
);
