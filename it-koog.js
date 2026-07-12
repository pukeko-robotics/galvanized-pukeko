#!/usr/bin/env node
// Koog AG-UI example integration test: boot the Koog Ktor server + the vue web client, then run
// the Playwright e2e (examples/pukeko-koog-ag-ui) against the live pair. Mirrors it-adk.js.
//
// Usage:  LLM_PROVIDER=google JAVA_HOME=/usr/lib/jvm/java-21-openjdk node it-koog.js [-- playwright args]
// The LLM runs through Google AI Studio (GOOGLE_API_KEY, gemini-2.5-flash) by default.
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { createWriteStream, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const playwrightArgs = process.argv.slice(2);

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
    const testProc = spawn('npx', ['playwright', 'test', ...playwrightArgs], {
      cwd: KOOG_EXAMPLE_DIR,
      stdio: 'inherit',
    });
    testProc.on('close', res);
    testProc.on('error', err => { console.error(`Playwright: ${err.message}`); res(1); });
  });
} catch (err) {
  console.error(`\nAborted: ${err.message}`);
} finally {
  cleanup();
}

process.exit(exitCode);
