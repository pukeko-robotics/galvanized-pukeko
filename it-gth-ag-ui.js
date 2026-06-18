#!/usr/bin/env node
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const GTH_API_HEALTH_URL = 'http://localhost:3000/health';
const WEB_URL = 'http://localhost:5555';
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
      '--port', '3000',
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
  const proc = spawn('npm', ['run', 'web-ag-ui'], {
    cwd: __dirname,
    stdio: 'inherit',
    detached: true,
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
