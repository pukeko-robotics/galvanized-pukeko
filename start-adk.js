#!/usr/bin/env node
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { createWriteStream } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// OPS-8: load the worktree-root `.env` (web + ADK ports + ADK CORS). Inline wins.
try { process.loadEnvFile(resolve(__dirname, '.env')); } catch { /* no .env: defaults */ }
const WEB_PORT = process.env.WEB_PORT || '5555';
const WEB_URL = `http://localhost:${WEB_PORT}`;
const ADK_PORT = process.env.ADK_PORT || '8080';
const ADK_CORS_ORIGINS = process.env.ADK_CORS_ORIGINS || 'http://localhost:5555,https://localhost:5555';
const READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

function startAdkAgent() {
  const logPath = resolve(__dirname, 'start-adk-java.log');
  const bannerLines = [
    '  GALVANIZED PUKEKO ADK — STARTING',
    '  Writing ADK Server Logs to:',
    '  start-adk-java.log',
  ];
  const width = Math.max(...bannerLines.map(l => l.length)) + 2;
  const bar = '═'.repeat(width);
  const pad = l => `║${l}${' '.repeat(width - l.length)}║`;
  console.log([`╔${bar}╗`, ...bannerLines.map(pad), `╚${bar}╝`].join('\n'));

  const logStream = createWriteStream(logPath, { flags: 'w' });
  const proc = spawn(
    './mvnw',
    ['clean', 'compile', 'exec:java', '-Dexec.classpathScope=compile', `-Dexec.args=--server.port=${ADK_PORT} --adk.web.cors.origins=${ADK_CORS_ORIGINS} --adk.agents.source-dir=target`],
    { cwd: resolve(__dirname, 'packages/galvanized-pukeko-agent-adk'), stdio: ['inherit', 'pipe', 'pipe'], detached: true }
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

const { proc: adkProc, ready: adkReady } = startAdkAgent();

console.log('Starting Web Client...');
const webProc = spawn('npm', ['run', 'dev'], {
  cwd: resolve(__dirname, 'packages/galvanized-pukeko-web-client'),
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

try {
  await Promise.all([
    adkReady,
    waitForUrl(WEB_URL, 'Web Client'),
  ]);
  console.log('\nAll services ready.');
  console.log(`  ADK Agent : http://localhost:${ADK_PORT}`);
  console.log(`  Web Client: ${WEB_URL}`);
  console.log('\nPress Ctrl+C to stop.\n');
} catch (err) {
  console.error(`\nAborted: ${err.message}`);
  cleanup();
  process.exit(1);
}
