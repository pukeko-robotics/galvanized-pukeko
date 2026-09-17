#!/usr/bin/env node
// Gaunt Sloth AG-UI example integration test: boot the gaunt-sloth AG-UI server + the vue web
// client, then run the Playwright e2e against the live pair.
//
// Usage:  node it-gth-ag-ui.js [playwright args]
//         pnpm run it-gth-ag-ui -- [playwright args]
//
// Both spellings forward their arguments — `pnpm run … -- --grep "capture_image"` runs what it
// says. The leading `--` pnpm inserts is removed here, and the run says so when it does; see
// scripts/harness-argv.mjs for why that token cannot simply be passed on.
//
// GTH_LLM_PROVIDER selects which shipped configuration the server runs (see
// scripts/llm-config.mjs); unset means the documented fallback, which needs an OPENAI_API_KEY.
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveLocalBinOrExit, spawnLocalBin } from './scripts/local-bin.mjs';
import {
  AG_UI_EXAMPLE_DIR,
  PROVIDER_ENV_VAR,
  declaredLlmType,
  resolveLlmConfigOrExit,
} from './scripts/llm-config.mjs';
import {
  LOCAL_GPU_PROVIDERS,
  createOllamaLock,
  defaultLockPath,
  resolveOllamaHost,
} from './scripts/ollama-gpu-lock.mjs';
import { DEFAULT_REPORT_PATH, reportFirstAttemptRate } from './scripts/first-attempt-rate.mjs';
import { playwrightArgsFrom, separatorNotice } from './scripts/harness-argv.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve both binaries from this repo's own install, before anything is started.
// Playwright is not needed until the end of the run, but a missing dependency must
// abort while there is still nothing to tear down — failing after two detached
// process groups are up leaks them. Never a bare name: see scripts/local-bin.mjs.
const GTH_API_BIN = resolveLocalBinOrExit('@gaunt-sloth/agent', 'gaunt-sloth-api', __dirname);
const PLAYWRIGHT_BIN = resolveLocalBinOrExit('@playwright/test', 'playwright', __dirname);

// OPS-8: load the worktree-root `.env`. GTH_AGUI_PORT drives the gaunt-sloth AG-UI
// server + the web client's AGUI_URL target; WEB_PORT drives the vite dev server.
// Both are written per worktree by the allocator; the fallbacks below are the trunk
// defaults for a checkout with no `.env`. Inline env vars still win.
try { process.loadEnvFile(resolve(__dirname, '.env')); } catch { /* no .env: defaults */ }
const GTH_AGUI_PORT = process.env.GTH_AGUI_PORT || '3000';
const WEB_PORT = process.env.WEB_PORT || '5555';
const GTH_API_HEALTH_URL = `http://localhost:${GTH_AGUI_PORT}/health`;
const AGUI_URL = `http://localhost:${GTH_AGUI_PORT}/agents/default/run`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
// OPS-16: the browser origin playwright will actually load from, defaulted off the same
// WEB_PORT that gives it its baseURL. Without it a run at any allocated offset but the
// default is refused by the preflight, which is the parallel-isolation guarantee OPS-8 set
// out to give this harness.
const GTH_CORS_ORIGIN = process.env.GTH_CORS_ORIGIN || WEB_URL;
// QA-19: which provider's configuration this run exercises, read from GTH_LLM_PROVIDER with a
// documented fallback. Resolved before anything starts so an unknown provider ends the run while
// there is still nothing to tear down — the same reason the binaries are resolved above.
const EXAMPLE_DIR = resolve(__dirname, AG_UI_EXAMPLE_DIR);
const { provider: LLM_PROVIDER, configPath: LLM_CONFIG_PATH } = resolveLlmConfigOrExit(EXAMPLE_DIR);
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

function startGthAgUi() {
  const logPath = resolve(__dirname, 'it-gth-ag-ui.log');
  const bannerLines = [
    '  GAUNT SLOTH AG-UI — STARTING',
    `  LLM provider: ${LLM_PROVIDER} (${PROVIDER_ENV_VAR})`,
    '  Writing Server Logs to:',
    `  it-gth-ag-ui.log`,
  ];
  const width = Math.max(...bannerLines.map(l => l.length)) + 2;
  const bar = '═'.repeat(width);
  const pad = l => `║${l}${' '.repeat(width - l.length)}║`;
  console.log([`╔${bar}╗`, ...bannerLines.map(pad), `╚${bar}╝`].join('\n'));

  const logStream = createWriteStream(logPath, { flags: 'w' });
  const proc = spawnLocalBin(
    GTH_API_BIN,
    [
      'ag-ui',
      // All three flags take effect. The port precedence is `--port`, then
      // `commands.api.port` from the config, then 3000 — so the flag is what
      // makes an allocated GTH_AGUI_PORT reach the server, over the 3000 the
      // config states. `--cors-origin` is the same lever for the browser origin,
      // over the `cors.allowOrigin` the config pins, so a run on a shifted
      // WEB_PORT is not refused by the preflight. `--config` names the file
      // outright and refuses the run when it is missing rather than quietly
      // falling back to discovery. `cwd` below still matters: it is the project
      // root the guidelines and other project-relative artifacts are found from.
      '--port', GTH_AGUI_PORT,
      '--cors-origin', GTH_CORS_ORIGIN,
      '--config', LLM_CONFIG_PATH,
    ],
    {
      cwd: EXAMPLE_DIR,
      stdio: ['inherit', 'pipe', 'pipe'],
      detached: true,
    }
  );

  proc.stdout.on('data', d => logStream.write(d));
  proc.stderr.on('data', d => logStream.write(d));
  proc.on('error', err => console.error(`[Gaunt Sloth AG-UI] ${err.message}`));

  return proc;
}

function startWebClient() {
  console.log('Starting Web Client...');
  // Point the web client at the (possibly shifted) gaunt-sloth AG-UI URL. We spawn
  // the web-client dev directly with AGUI_URL in env (mirrors it-koog.js) rather
  // than the `web-ag-ui` script, whose inline `AGUI_URL=…:3000` would shadow it.
  const proc = spawn('pnpm', ['--filter', '@galvanized-pukeko/web-client', 'run', 'dev'], {
    cwd: __dirname,
    stdio: 'inherit',
    detached: true,
    env: { ...process.env, AGUI_URL },
  });
  proc.on('error', err => console.error(`[Web Client] ${err.message}`));
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

// OPS-118 — serialise this run against every other run driving the same Ollama daemon, including
// Gaunt Sloth's own integration harness in its own repository. The lock is a file keyed by the
// daemon address, so two separate implementations exclude each other; see
// scripts/ollama-gpu-lock.mjs for the contract they share and why it is not a shared import.
//
// Taken ONLY when the configuration about to be launched declares a local-GPU provider: a hosted
// provider has no card to contend for, and locking it would queue an OpenAI run behind an Ollama
// one for no reason. Taken BEFORE anything starts, so a waiting run has nothing running while it
// waits, and released from a single 'exit' hook, which covers the normal path, the abort path and
// both signal handlers below (each ends in process.exit).
if (LOCAL_GPU_PROVIDERS.includes(declaredLlmType(LLM_CONFIG_PATH))) {
  const lock = createOllamaLock({ lockPath: defaultLockPath(resolveOllamaHost()) });
  const release = await lock.acquire(); // blocks until acquired, or throws loud at the deadline
  process.on('exit', release);
  console.log(`==> ollama GPU lock acquired (${lock.lockPath})`);
}

const gthProc = startGthAgUi();
const webProc = startWebClient();

function cleanup() {
  console.log('\nStopping services...');
  killGroup(gthProc);
  killGroup(webProc);
}

process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

let exitCode = 1;
try {
  await Promise.all([
    waitForUrl(GTH_API_HEALTH_URL, 'Gaunt Sloth AG-UI'),
    waitForUrl(WEB_URL, 'Web Client'),
  ]);

  console.log('\nRunning integration tests...');
  exitCode = await new Promise(resolve => {
    const testProc = spawnLocalBin(
      PLAYWRIGHT_BIN,
      [
        'test',
        // Bespoke UI + the two CopilotKit modes (P2b: stock + headless), all
        // against the same live Gaunt Sloth AG-UI backend.
        'e2e/chat-gth.spec.ts',
        'e2e/chat-gth-stock.spec.ts',
        'e2e/chat-gth-headless.spec.ts',
        ...playwrightArgs,
      ],
      { cwd: __dirname, stdio: 'inherit' }
    );
    testProc.on('close', resolve);
    testProc.on('error', err => { console.error(`Playwright: ${err.message}`); resolve(1); });
  });

  // QA-30 — print the FIRST-ATTEMPT pass rate. `retries: 3` means this run can print a
  // confident `7 passed` and exit 0 over a suite where a live defect fired on the first attempt
  // and a retry absorbed it, which is how two defects stayed invisible across five green runs.
  // The exit code is deliberately left alone: the suite's verdict is the suite's to give, and
  // retries are legitimate for genuinely ambient flakiness. What was missing was not a stricter
  // gate but the number itself, so a regression can no longer hide behind a retry unread.
  try {
    const { lines } = reportFirstAttemptRate(resolve(__dirname, DEFAULT_REPORT_PATH));
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
