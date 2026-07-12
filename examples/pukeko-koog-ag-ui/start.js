import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// examples/pukeko-koog-ag-ui -> repo root
const ROOT = resolve(__dirname, '..', '..');
const KOOG_DIR = resolve(__dirname, 'koog-agent');

const AGUI_PORT = 3000;
const WEB_PORT = 5555;
const AGUI_URL = `http://localhost:${AGUI_PORT}/agents/default/run`;
const READY_TIMEOUT_MS = 180_000; // first `gradlew run` compiles; be generous
const POLL_INTERVAL_MS = 2_000;

// JDK 21 is required to run the encoder (JVM-21 bytecode). Honour an override, else
// fall back to the Arch path used in the TAKAHE harness.
const JAVA_HOME = process.env.JAVA_HOME || '/usr/lib/jvm/java-21-openjdk';

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

// Start the Koog AG-UI server (Ktor CIO) via the Gradle application plugin.
console.log(`Starting Koog AG-UI server on port ${AGUI_PORT} (JAVA_HOME=${JAVA_HOME})...`);
const koogProc = spawn(
  './gradlew',
  ['run', '--no-daemon', '--console=plain', '-q'],
  {
    cwd: KOOG_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, JAVA_HOME, AGUI_PORT: String(AGUI_PORT) },
  }
);
procs.push(koogProc);

koogProc.stdout.on('data', (d) => process.stdout.write(`[koog] ${d}`));
koogProc.stderr.on('data', (d) => process.stderr.write(`[koog] ${d}`));
koogProc.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error(`Koog server exited with code ${code}`);
  }
});

await waitForReady(`http://localhost:${AGUI_PORT}/health`, 'Koog AG-UI server');

// Start the web client, pointed at the Koog server.
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

await waitForReady(`http://localhost:${WEB_PORT}`, 'Web client');

console.log('\n========================================');
console.log(`  Open http://localhost:${WEB_PORT} in your browser`);
console.log('  Press Ctrl+C to stop all services');
console.log('========================================\n');

await new Promise(() => {});
