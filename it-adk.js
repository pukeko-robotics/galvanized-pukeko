#!/usr/bin/env node
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { createWriteStream, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WEB_URL = 'http://localhost:5555';
const READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

// The ADK agent (packages/galvanized-pukeko-agent-adk) is a Java-21 Spring app (BE-1, target-21
// bytecode). The harness default `java`/JAVA_HOME is 17, and DoD #2 runs a bare `node it-adk.js`
// (no JAVA_HOME override), so a plain `process.env.JAVA_HOME || <21>` would keep the ambient 17 and
// the target-21 compile fails. Prefer the canonical JDK 21 path when it exists; otherwise honour the
// ambient JAVA_HOME (for environments where 21 lives elsewhere).
const JAVA_21 = '/usr/lib/jvm/java-21-openjdk';
const JAVA_HOME = existsSync(JAVA_21) ? JAVA_21 : (process.env.JAVA_HOME || JAVA_21);
// Cheap Google-AI-Studio model for the e2e. `gemini-flash-lite-latest` is the always-current
// cheapest flash alias — some AI-Studio keys 404 ("no longer available to new users") on pinned
// older flash ids, while the `-latest` alias always resolves to a live model. Override with
// PUKEKO_AI_MODEL. The demo's committed default (pukeko.ai.model=gemini-2.5-pro) is untouched.
const PUKEKO_AI_MODEL = process.env.PUKEKO_AI_MODEL || 'gemini-flash-lite-latest';

function startAdkAgent() {
  const logPath = resolve(__dirname, 'it-adk-java.log');
  const bannerLines = [
    '  ADK AGENT — STARTING',
    '  Writing ADK Server Logs to:',
    `  it-adk-java.log`,
  ];
  const width = Math.max(...bannerLines.map(l => l.length)) + 2;
  const bar = '═'.repeat(width);
  const pad = l => `║${l}${' '.repeat(width - l.length)}║`;
  console.log([`╔${bar}╗`, ...bannerLines.map(pad), `╚${bar}╝`].join('\n'));
  const logStream = createWriteStream(logPath, { flags: 'w' });
  const proc = spawn(
    './mvnw',
    ['clean', 'compile', 'exec:java', '-Dexec.classpathScope=compile',
     `-Dexec.args=--server.port=8080 --adk.agents.source-dir=target --pukeko.ai.model=${PUKEKO_AI_MODEL}`],
    {
      cwd: resolve(__dirname, 'packages/galvanized-pukeko-agent-adk'),
      stdio: ['inherit', 'pipe', 'pipe'],
      detached: true,
      env: {
        ...process.env,
        JAVA_HOME,
        // Route google-genai to the Gemini Developer API (AI Studio), never Vertex: with
        // GOOGLE_API_KEY set and USE_VERTEXAI falsey, the SDK uses AI Studio (no project/creds).
        GOOGLE_GENAI_USE_VERTEXAI: 'false',
      },
    }
  );

  let settled = false;
  const ready = new Promise((res, rej) => {
    function settle(fn, val) { if (!settled) { settled = true; fn(val); } }

    function onLine(line) {
      logStream.write(`${line}\n`);
      if (line.includes('Tomcat started on port')) settle(res, undefined);
      else if (line.includes('BUILD FAILURE')) settle(rej, new Error('ADK Agent: BUILD FAILURE'));
    }

    createInterface({ input: proc.stdout }).on('line', onLine);
    createInterface({ input: proc.stderr }).on('line', onLine);
    proc.on('error', err => settle(rej, new Error(`ADK Agent: ${err.message}`)));
    proc.on('close', code => settle(rej, new Error(`ADK Agent exited (code ${code}) before becoming ready`)));
  });

  return { proc, ready };
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

const { proc: adkProc, ready: adkReady } = startAdkAgent();

console.log('Starting Web Client...');
// pnpm, not npm: the web client is a pnpm-workspace package (its deps live in the workspace store,
// not a local node_modules `npm run` can resolve). Mirrors the start.js npm->pnpm fix (1e5db05).
const webProc = spawn('pnpm', ['--filter', '@galvanized-pukeko/web-client', 'run', 'dev'], {
  cwd: __dirname,
  stdio: 'inherit',
  detached: true,
});
webProc.on('error', err => console.error(`[Web Client] ${err.message}`));

function cleanup() {
  console.log('\nStopping services...');
  killGroup(adkProc);
  killGroup(webProc);
}

process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

let exitCode = 1;
try {
  await Promise.all([
    adkReady,
    waitForUrl(WEB_URL, 'Web Client'),
  ]);

  console.log('\nRunning integration tests...');
  exitCode = await new Promise(resolve => {
    const testProc = spawn('npx', ['playwright', 'test', 'e2e/chat.spec.ts', ...playwrightArgs], { cwd: __dirname, stdio: 'inherit' });
    testProc.on('close', resolve);
    testProc.on('error', err => { console.error(`Playwright: ${err.message}`); resolve(1); });
  });
} catch (err) {
  console.error(`\nAborted: ${err.message}`);
} finally {
  cleanup();
}

process.exit(exitCode);
