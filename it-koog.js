#!/usr/bin/env node
// Koog AG-UI example integration test: boot the Koog Ktor server + the vue web client, then run
// the Playwright e2e (examples/pukeko-koog-ag-ui) against the live pair. Mirrors it-adk.js.
//
// Usage:  LLM_PROVIDER=google JAVA_HOME=/usr/lib/jvm/java-21-openjdk node it-koog.js [playwright args]
//         pnpm run it-koog -- [playwright args]
// Both spellings forward their arguments: the leading `--` pnpm inserts is removed here, and the
// run says so when it does — see scripts/harness-argv.mjs for why that token cannot be passed on.
// The LLM runs through Google AI Studio (GOOGLE_API_KEY, gemini-2.5-flash) by default.
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { createWriteStream, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveLocalBinOrExit, spawnLocalBin } from './scripts/local-bin.mjs';
import { DEFAULT_REPORT_PATH, reportFirstAttemptRate } from './scripts/first-attempt-rate.mjs';
import { playwrightArgsFrom, separatorNotice } from './scripts/harness-argv.mjs';
import {
  KOOG_OLLAMA_URL_ENV_VAR,
  createOllamaLock,
  defaultLockPath,
  isLocalGpuProvider,
  resolveKoogOllamaBaseUrl,
} from './scripts/ollama-gpu-lock.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve Playwright from this repo's own install, before anything is started. It
// is not needed until the end of the run, but a missing dependency must abort while
// there is still nothing to tear down — failing after the Koog server and the web
// client are up leaks them. Resolution is anchored to this repo root, so the run
// below can keep its own cwd (Playwright discovers its config from there).
const PLAYWRIGHT_BIN = resolveLocalBinOrExit('@playwright/test', 'playwright', __dirname);

const KOOG_EXAMPLE_DIR = resolve(__dirname, 'examples/pukeko-koog-ag-ui');
const KOOG_AGENT_DIR = resolve(KOOG_EXAMPLE_DIR, 'koog-agent');
// OPS-8: load the worktree-root `.env` so the Koog AG-UI port + web port shift
// together (offset 0 == today's 3000 / 5555). Inline env vars still win.
try { process.loadEnvFile(resolve(__dirname, '.env')); } catch { /* no .env: defaults */ }
const AGUI_PORT = Number(process.env.AGUI_PORT) || 3000;
const WEB_PORT = Number(process.env.WEB_PORT) || 5555;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const HEALTH_URL = `http://localhost:${AGUI_PORT}/health`;
const AGUI_URL = `http://localhost:${AGUI_PORT}/agents/default/run`;
const READY_TIMEOUT_MS = 180_000; // first `gradlew run` compiles; be generous.
const POLL_INTERVAL_MS = 2_000;

// JDK 21 is required (the AG-UI encoder is JVM-21 bytecode). The harness default JAVA_HOME is 17,
// so prefer the canonical JDK 21 path when present (a bare `node it-koog.js` must still use 21);
// otherwise honour the ambient JAVA_HOME. The DoD command also sets JAVA_HOME=21 explicitly.
const JAVA_21 = '/usr/lib/jvm/java-21-openjdk';
const JAVA_HOME = existsSync(JAVA_21) ? JAVA_21 : (process.env.JAVA_HOME || JAVA_21);
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'google';
// Cheap AI-Studio model for the e2e. `gemini-flash-lite-latest` is the always-current cheapest
// flash alias — used instead of a pinned `gemini-2.5-flash` because some AI-Studio keys/projects
// get a 404 "no longer available to new users" on the pinned older flash ids, while the `-latest`
// alias always resolves to a live model. Override with GOOGLE_MODEL. KoogAgent's own committed
// default (gemini-2.5-flash) is left untouched for the published demo.
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemini-flash-lite-latest';
// OPS-119 — the Ollama daemon this run will drive, resolved ONCE. It is both the lock key below
// and the value handed to the JVM in startKoogAgent(), so the address that is locked and the
// address that is dialled cannot drift apart. Resolved unconditionally (it costs nothing) but only
// USED when the provider is a local-GPU one. See scripts/ollama-gpu-lock.mjs for the precedence and
// for why the Kotlin default is deliberately not the one that wins.
const OLLAMA_BASE_URL = resolveKoogOllamaBaseUrl(process.env);

function startKoogAgent() {
  const logPath = resolve(__dirname, 'it-koog-java.log');
  const bannerLines = [
    '  KOOG AG-UI SERVER — STARTING',
    `  provider=${LLM_PROVIDER}  model=${GOOGLE_MODEL}  port=${AGUI_PORT}`,
    '  Writing Koog server logs to:',
    '  it-koog-java.log',
  ];
  const width = Math.max(...bannerLines.map(l => l.length)) + 2;
  const bar = '═'.repeat(width);
  const pad = l => `║${l}${' '.repeat(width - l.length)}║`;
  console.log([`╔${bar}╗`, ...bannerLines.map(pad), `╚${bar}╝`].join('\n'));
  const logStream = createWriteStream(logPath, { flags: 'w' });
  const proc = spawn(
    './gradlew',
    ['run', '--no-daemon', '--console=plain', '-q'],
    {
      cwd: KOOG_AGENT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: {
        ...process.env,
        JAVA_HOME,
        LLM_PROVIDER,
        GOOGLE_MODEL,
        // OPS-119 — inject the SAME string the lock was keyed on. KoogAgent.kt would otherwise
        // fall back to its own committed default, `http://localhost:11434`, which denotes this
        // very daemon and hashes to a different lockfile — so the server would drive the card
        // this run only believes it has exclusive use of. Passing it makes the locked address and
        // the dialled address one value rather than two defaults that happen to agree.
        [KOOG_OLLAMA_URL_ENV_VAR]: OLLAMA_BASE_URL,
        AGUI_PORT: String(AGUI_PORT),
      },
    }
  );

  const onLine = line => logStream.write(`${line}\n`);
  createInterface({ input: proc.stdout }).on('line', onLine);
  createInterface({ input: proc.stderr }).on('line', onLine);
  proc.on('close', code => {
    if (code !== null && code !== 0) console.error(`Koog server exited with code ${code}`);
  });

  return proc;
}

async function waitForUrl(url, label) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  process.stdout.write(`Waiting for ${label} (${url})`);
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      console.log(' ready');
      return;
    } catch {
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  throw new Error(`${label} did not become ready within ${READY_TIMEOUT_MS / 1000}s`);
}

function killGroup(proc) {
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already gone */ }
}

// QA-34 — a leading `--` is pnpm's, not the caller's, and Playwright would discard everything
// after it. Stripped here and announced; scripts/harness-argv.mjs holds the reasoning.
const { args: playwrightArgs, separatorStripped } = playwrightArgsFrom(process.argv.slice(2));
if (separatorStripped) console.log(separatorNotice(playwrightArgs));

// OPS-119 — serialise this run against every other run driving the same Ollama daemon: the other
// harness in this repository, and Gaunt Sloth's integration harness in its own repository. The lock
// is a file keyed by the daemon address, so separate implementations exclude each other; see
// scripts/ollama-gpu-lock.mjs for the contract and why it is not a shared import.
//
// Taken ONLY when this run will actually drive the local card. The default provider here is
// `google`, a hosted API with no card to contend for, and locking it would queue a Gemini run
// behind an Ollama one for nothing.
//
// Taken BEFORE the server and the web client start, so a run that has to wait is holding no
// processes open while it waits, and released from a single 'exit' hook, which covers the normal
// path, the abort path and both signal handlers below (each of which ends in process.exit).
if (isLocalGpuProvider(LLM_PROVIDER)) {
  const lock = createOllamaLock({ lockPath: defaultLockPath(OLLAMA_BASE_URL) });
  const release = await lock.acquire(); // blocks until acquired, or throws loud at the deadline
  process.on('exit', release);
  console.log(`==> ollama GPU lock acquired for ${OLLAMA_BASE_URL} (${lock.lockPath})`);
}

const koogProc = startKoogAgent();

console.log('Starting Web Client...');
const webProc = spawn('pnpm', ['--filter', '@galvanized-pukeko/web-client', 'run', 'dev'], {
  cwd: __dirname,
  stdio: 'inherit',
  detached: true,
  env: { ...process.env, AGUI_URL },
});
webProc.on('error', err => console.error(`[Web Client] ${err.message}`));

function cleanup() {
  console.log('\nStopping services...');
  killGroup(koogProc);
  killGroup(webProc);
}

process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

let exitCode = 1;
try {
  await Promise.all([
    waitForUrl(HEALTH_URL, 'Koog AG-UI server'),
    waitForUrl(WEB_URL, 'Web Client'),
  ]);

  console.log('\nRunning integration tests...');
  exitCode = await new Promise(res => {
    const testProc = spawnLocalBin(PLAYWRIGHT_BIN, ['test', ...playwrightArgs], {
      cwd: KOOG_EXAMPLE_DIR,
      stdio: 'inherit',
    });
    testProc.on('close', res);
    testProc.on('error', err => { console.error(`Playwright: ${err.message}`); res(1); });
  });

  // QA-38 — print the FIRST-ATTEMPT pass rate, as the other two harnesses do. With retries in the
  // example's config a cell that failed and then passed is reported flaky and the run still exits
  // 0, so the exit code alone cannot show a live defect a retry absorbed.
  //
  // READ FROM THE EXAMPLE'S OWN REPORT, NOT THE ROOT ONE. This harness runs Playwright with the
  // example directory as its cwd, so the example's config governs and its json reporter writes
  // beside it. Pointing this at the repository root would find the file the OTHER harnesses write
  // and print a confident rate computed over somebody else's run — worse than no rate at all,
  // because nothing in the output would say which suite it described.
  try {
    const { lines } = reportFirstAttemptRate(resolve(KOOG_EXAMPLE_DIR, DEFAULT_REPORT_PATH));
    console.log(`\n${lines.join('\n')}`);
  } catch (err) {
    // Loud rather than silent: a missing report is the facility being broken, and an absent
    // rate must never read as a clean one.
    console.warn(`\nWARNING: first-attempt rate unavailable — ${err.message}`);
  }
} catch (err) {
  console.error(`\nAborted: ${err.message}`);
} finally {
  cleanup();
}

process.exit(exitCode);
