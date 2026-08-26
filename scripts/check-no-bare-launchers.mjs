#!/usr/bin/env node
// Guard: fail the build if a one-shot package runner reappears anywhere in this
// repository's sources, harnesses, docs or CI.
//
// The runners in question are the npm, bun, pnpm and yarn "fetch it and run it"
// commands. Given a name that does not resolve locally they download whatever the
// public registry serves under that name and execute it. Several of the names our
// harnesses used to pass are bin commands rather than package names, so the name
// we meant and the name we would get were never guaranteed to be the same thing.
//
// WHY A GUARD SCRIPT AND NOT A MACHINE-LEVEL DENY RULE. A shell deny rule can only
// inspect a command line. Every occurrence this ticket removed was a spawn() from
// inside a Node script, so the command a developer actually approved was
// "pnpm run e2e" and the runner was never visible to any matcher. Only something
// that reads the files can see these.
//
// The patterns below are assembled from character fragments on purpose, so that
// this file does not contain the very tokens it searches for and therefore does
// not need to exempt itself. Exempting the directory a guard lives in is how a
// future real occurrence gets silently waved through.
//
// Run: node scripts/check-no-bare-launchers.mjs   (wired into "pnpm test")

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NPM_RUNNER = 'n' + 'p' + 'x';
const BUN_RUNNER = 'b' + 'u' + 'n' + 'x';
const DLX = 'd' + 'l' + 'x';

const PATTERNS = [
  { label: `the npm one-shot runner (${NPM_RUNNER})`, re: new RegExp(`\\b${NPM_RUNNER}\\b`) },
  { label: `the bun one-shot runner (${BUN_RUNNER})`, re: new RegExp(`\\b${BUN_RUNNER}\\b`) },
  {
    label: `a pnpm/yarn one-shot runner (${DLX})`,
    re: new RegExp(`\\b(?:pnpm|yarn|npm)\\b[^\\n]{0,40}?\\b${DLX}\\b`),
  },
];

// Directories that are not ours to police, or that hold build output.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  'coverage',
  'test-results',
  'playwright-report',
  '.idea',
  '.vscode',
  '.pnpm-store',
]);

// Only text formats we actually author. Keeps the walk fast and avoids reading
// binaries as UTF-8.
const SCANNED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.vue',
  '.json',
  '.jsonc',
  '.md',
  '.yml',
  '.yaml',
  '.sh',
  '.bash',
  '.html',
  '.css',
  '.properties',
  '.java',
  '.kt',
  '.kts',
  '.txt',
]);

// Paths that legitimately contain one of these words, each with its reason.
// Keep every entry to an exact relative path, or a clearly-scoped directory
// written with a trailing slash, and give it a reason a reviewer can check — a
// broad exemption here is indistinguishable from no guard at all.
const ALLOWED = [
  // Archived prompts recording what was asked of an assistant at the time.
  // Rewriting them would falsify a historical record rather than fix anything
  // this repository executes.
  { path: 'briefs/ag-ui/', reason: 'archived historical prompts, not executable' },

  // The ADK library's stdio transport lets a USER name any command for their own
  // MCP server; these three places document that field's shape and give the
  // commonest value as an example. Nothing here is a command this repository
  // runs, and prescribing someone else's MCP server command is not ours to do.
  {
    path: 'packages/galvanized-pukeko-agent-adk/README.md',
    reason: 'documents a user-supplied MCP stdio command, not one we run',
  },
  {
    path: 'packages/galvanized-pukeko-agent-adk/src/main/java/io/github/galvanized_pukeko/config/McpConfiguration.java',
    reason: 'javadoc for a user-supplied MCP stdio command',
  },
  {
    path: 'packages/galvanized-pukeko-agent-adk/src/main/resources/pukeko-defaults.properties',
    reason: 'commented-out example of a user-supplied MCP stdio command',
  },
];

function isAllowed(rel) {
  return ALLOWED.some((entry) =>
    entry.path.endsWith('/') ? rel.startsWith(entry.path) : rel === entry.path
  );
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // A nested git repository (submodule) belongs to whoever owns it.
      if (existsSync(join(full, '.git'))) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

const findings = [];

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (isAllowed(rel)) continue;
  if (!SCANNED_EXTENSIONS.has(extname(file))) continue;
  if (statSync(file).size > 2_000_000) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const { label, re } of PATTERNS) {
      if (re.test(line)) {
        findings.push({ rel, line: index + 1, label, text: line.trim() });
      }
    }
  });
}

if (findings.length > 0) {
  console.error(
    `\nBare one-shot package runners found in ${findings.length} place(s).\n` +
      `These resolve a name against the public registry and execute the result, so\n` +
      `they must not appear in this repository. Resolve the installed binary instead:\n` +
      `see scripts/local-bin.mjs, and node_modules/.bin/<tool> for a shell command.\n`
  );
  for (const f of findings) {
    console.error(`  ${f.rel}:${f.line}  ${f.label}`);
    console.error(`      ${f.text}`);
  }
  console.error('');
  process.exit(1);
}

console.log(`No bare one-shot package runners found (${PATTERNS.length} patterns checked).`);
