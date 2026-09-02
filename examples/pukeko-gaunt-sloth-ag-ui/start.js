import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveLocalBinOrExit, spawnLocalBin } from '../../scripts/local-bin.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');

// This example directory has no package.json of its own; its dependencies are the
// repository's. Resolve from ROOT explicitly rather than leaning on the working
// directory, and do it before anything is started so a missing dependency aborts
// with nothing to tear down. Never a bare name: see scripts/local-bin.mjs.
const GTH_API_BIN = resolveLocalBinOrExit('@gaunt-sloth/agent', 'gaunt-sloth-api', ROOT);

const AGUI_PORT = 3000;
const WEB_PORT = 5555;
const AGUI_URL = `http://localhost:${AGUI_PORT}/agents/default/run`;
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

const procs = [];

function cleanup() {
  console.log('\nStopping services...');
  for (const proc of procs) {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      // already exited
    }
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

async function waitForReady(url, label) {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`  ${label} is ready`);
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`${label} did not become ready within ${READY_TIMEOUT_MS / 1000}s`);
}

// Start Gaunt Sloth AG-UI server
console.log(`Starting Gaunt Sloth AG-UI server on port ${AGUI_PORT}...`);
const gthProc = spawnLocalBin(
  GTH_API_BIN,
  [
    'ag-ui',
    // `gaunt-sloth-api` parses only argv[0] (the API type): at
    // @gaunt-sloth/agent 2.0.0-beta.5 both flags below are accepted and dropped
    // (measured — `ag-ui --port 3123` binds 3000, and an unreadable `--config`
    // path is ignored). What actually takes effect is `commands.api.port` and
    // the working directory the config is discovered from, both set below. The
    // flags stay so the day argv parsing lands they are already correct; until
    // then a non-default GTH_AGUI_PORT does NOT reach this server.
    '--port', String(AGUI_PORT),
    '--config', resolve(__dirname, '.gsloth.config.json'),
  ],
  {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  }
);
procs.push(gthProc);

gthProc.stdout.on('data', (d) => process.stdout.write(`[gth] ${d}`));
gthProc.stderr.on('data', (d) => process.stderr.write(`[gth] ${d}`));
gthProc.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error(`Gaunt Sloth exited with code ${code}`);
  }
});

// Wait for Gaunt Sloth to be ready
await waitForReady(`http://localhost:${AGUI_PORT}/health`, 'Gaunt Sloth');

// Start web client
console.log(`Starting web client on port ${WEB_PORT}...`);
const webProc = spawn(
  'pnpm',
  ['--filter', '@galvanized-pukeko/web-client', 'run', 'dev'],
  {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, AGUI_URL },
  }
);
procs.push(webProc);

webProc.stdout.on('data', (d) => process.stdout.write(`[web] ${d}`));
webProc.stderr.on('data', (d) => process.stderr.write(`[web] ${d}`));
webProc.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error(`Web client exited with code ${code}`);
  }
});

// Wait for web client to be ready
await waitForReady(`http://localhost:${WEB_PORT}`, 'Web client');

console.log('\n========================================');
console.log(`  Open http://localhost:${WEB_PORT} in your browser`);
console.log('  Press Ctrl+C to stop all services');
console.log('========================================\n');

// Keep running
await new Promise(() => {});
