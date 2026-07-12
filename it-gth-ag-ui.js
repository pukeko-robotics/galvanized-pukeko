#!/usr/bin/env node
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// OPS-8: load the worktree-root `.env`. GTH_AGUI_PORT drives the gaunt-sloth AG-UI
// server + the web client's AGUI_URL target; WEB_PORT drives the vite dev server.
// NOTE: at time of writing galvanized's generated `.env` carries WEB_PORT but not
// GTH_AGUI_PORT (that var lives in gaunt-sloth's `.env`), so this falls back to
// 3000 today — flagged to the coordinator. Inline env vars still win.
try { process.loadEnvFile(resolve(__dirname, '.env')); } catch { /* no .env: defaults */ }
const GTH_AGUI_PORT = process.env.GTH_AGUI_PORT || '3000';
const WEB_PORT = process.env.WEB_PORT || '5555';
const GTH_API_HEALTH_URL = `http://localhost:${GTH_AGUI_PORT}/health`;
const AGUI_URL = `http://localhost:${GTH_AGUI_PORT}/agents/default/run`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

function startGthAgUi() {
  const logPath = resolve(__dirname, 'it-gth-ag-ui.log');
  const bannerLines = [
    '  GAUNT SLOTH AG-UI — STARTING',
    '  Writing Server Logs to:',
    `  it-gth-ag-ui.log`,
  ];
  const width = Math.max(...bannerLines.map(l => l.length)) + 2;
  const bar = '═'.repeat(width);
  const pad = l => `║${l}${' '.repeat(width - l.length)}║`;
  console.log([`╔${bar}╗`, ...bannerLines.map(pad), `╚${bar}╝`].join('\n'));

  const logStream = createWriteStream(logPath, { flags: 'w' });
  const proc = spawn(
    'npx',
    [
      'gaunt-sloth-api',
      'ag-ui',
      '--port', GTH_AGUI_PORT,
      '--config', resolve(__dirname, 'examples/pukeko-gaunt-sloth-ag-ui/.gsloth.config.json'),
    ],
    {
      cwd: resolve(__dirname, 'examples/pukeko-gaunt-sloth-ag-ui'),
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

const playwrightArgs = process.argv.slice(2);

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
    const testProc = spawn(
      'npx',
      [
        'playwright',
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
} catch (err) {
  console.error(`\nAborted: ${err.message}`);
} finally {
  cleanup();
}

process.exit(exitCode);
