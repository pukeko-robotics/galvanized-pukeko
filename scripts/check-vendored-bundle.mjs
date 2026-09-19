#!/usr/bin/env node
// Guard: fail the build when the browser bundle vendored into the ADK package has
// drifted from the sources it is built from.
//
// packages/galvanized-pukeko-agent-adk/src/main/resources/browser/ is a checked-in
// build of the web client. Nothing in `pom.xml`, the root scripts or any workflow
// produced it, the root lint deliberately ignores it (minified output is not
// authored source), and the ADK package declares no `test` script — so every gate
// this repository has stepped around the one directory nobody can read. It rotted:
// a shipped `onTextMessageEndEvent` that never flushed the text buffer stayed in
// there long after `chatService.ts` beside it was fixed, and rendered a
// single-chunk reply as an empty bubble.
//
// WHY A RECORDED DIGEST AND NOT A REBUILD-AND-DIFF. The strong form of this check
// is CI re-running the vendoring and failing on any byte difference. Vite writes
// content-hashed filenames, so that comparison is only meaningful if the build is
// reproducible on the runner as well as on the machine that vendored. Two
// consecutive builds on one machine are byte-identical (measured), but that says
// nothing about a different OS image, a different Node patch release or a
// different CPU — and a byte-diff that is wrong about reproducibility is a gate
// that goes red on main for a reason no one can act on. So this records what the
// bundle was built FROM and fails when the repository has moved past it. It costs
// no build at all, which is also why it can run on every push.
//
// WHAT IT COMPARES, in both directions:
//   1. the SOURCE digest — every file that feeds the bundle (the vue-ui and
//      web-client `src/` trees, the web client's `index.html` and `vite.config.ts`,
//      and both packages' declared dependency sets). Red means somebody changed
//      an embedded source and did not re-vendor.
//   2. the BUNDLE digest — every file actually in the vendored directory. Red
//      means the directory itself was edited, truncated, or partly committed. That
//      second half is not decoration: the vendored tree is ~180 files landing under
//      a .gitignore that carries `dist`, `*.log` and `*.local`, and a chunk dropped
//      on its way into git is otherwise a runtime module-not-found inside the jar,
//      with every gate green above it.
//
// THE RESIDUAL HOLES, so they are known rather than discovered:
//   - Someone who edits a source and hand-edits this manifest gets a green with a
//     stale bundle. That is a deliberate act and is not engineered against.
//   - Test files (`*.spec.*`, `*.test.*`) are excluded from the source digest
//     because they are not reachable from the app entry and cannot change the
//     bundle; a spec edit that tripped this gate would teach people to re-vendor
//     reflexively, which is how a gate stops being read.
//   - The digest covers DECLARED dependencies, not `pnpm-lock.yaml`. A lockfile-only
//     move (a transitive bump inside an existing range) can change the bundle
//     without changing this digest. Hashing the lockfile instead would fire on
//     every unrelated dependency change in the workspace, which is the same
//     desensitising failure as the spec-file case above.
//
// Run: node scripts/check-vendored-bundle.mjs          (verify — wired into "pnpm test")
//      node scripts/check-vendored-bundle.mjs --write  (record — run by deploy-to-adk.sh)
// Re-vendor with: pnpm run vendor:adk

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BUNDLE_DIR = 'packages/galvanized-pukeko-agent-adk/src/main/resources/browser';
const MANIFEST = 'packages/galvanized-pukeko-agent-adk/browser-bundle.provenance.json';
const REMEDY = 'pnpm run vendor:adk';

// The source trees the bundle is built from. `vue-ui` is consumed as SOURCE by the
// web client's vite config (alias, not the published package), so its `src/` is a
// direct input to this build rather than a dependency version.
const SOURCE_DIRS = [
  'packages/galvanized-pukeko-vue-ui/src',
  'packages/galvanized-pukeko-web-client/src',
];
const SOURCE_FILES = [
  'packages/galvanized-pukeko-web-client/index.html',
  'packages/galvanized-pukeko-web-client/vite.config.ts',
];
// Dependency sets, read from these package.json files. The whole file is not hashed:
// a version bump of the package itself, or an edit to its scripts or description,
// cannot change what the bundler emits.
const DEPENDENCY_MANIFESTS = [
  'packages/galvanized-pukeko-vue-ui/package.json',
  'packages/galvanized-pukeko-web-client/package.json',
];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];

const TEST_FILE_RE = /\.(spec|test)\.[^.]+$/;

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function walk(absDir, entries, filter) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, entries, filter);
    } else if (entry.isFile()) {
      const rel = relative(ROOT, abs).split('\\').join('/');
      if (filter && !filter(rel)) continue;
      entries.push([rel, sha256(readFileSync(abs))]);
    }
  }
}

/** Digest of a set of (path, content-hash) pairs, order-independent and path-stable. */
function digestOf(entries) {
  const sorted = [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const hash = createHash('sha256');
  for (const [rel, fileHash] of sorted) hash.update(`${rel}\u0000${fileHash}\n`);
  return { digest: hash.digest('hex'), fileCount: sorted.length };
}

function sourceEntries() {
  const entries = [];
  for (const dir of SOURCE_DIRS) {
    const abs = resolve(ROOT, dir);
    if (!existsSync(abs)) throw new Error(`Source directory ${dir} is missing.`);
    walk(abs, entries, (rel) => !TEST_FILE_RE.test(rel));
  }
  for (const file of SOURCE_FILES) {
    const abs = resolve(ROOT, file);
    if (!existsSync(abs)) throw new Error(`Source file ${file} is missing.`);
    entries.push([file, sha256(readFileSync(abs))]);
  }
  for (const file of DEPENDENCY_MANIFESTS) {
    const abs = resolve(ROOT, file);
    if (!existsSync(abs)) throw new Error(`Package manifest ${file} is missing.`);
    const pkg = JSON.parse(readFileSync(abs, 'utf8'));
    const deps = {};
    for (const field of DEPENDENCY_FIELDS) {
      const set = pkg[field];
      if (!set) continue;
      deps[field] = Object.fromEntries(Object.keys(set).sort().map((k) => [k, set[k]]));
    }
    entries.push([`${file}#dependencies`, sha256(Buffer.from(JSON.stringify(deps), 'utf8'))]);
  }
  return entries;
}

function bundleEntries() {
  const abs = resolve(ROOT, BUNDLE_DIR);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`The vendored bundle directory ${BUNDLE_DIR} is missing.`);
  }
  const entries = [];
  walk(abs, entries, null);
  if (entries.length === 0) throw new Error(`The vendored bundle directory ${BUNDLE_DIR} is empty.`);
  return entries;
}

function measure() {
  const source = digestOf(sourceEntries());
  const bundle = digestOf(bundleEntries());
  return { source, bundle };
}

const write = process.argv.includes('--write');
const manifestPath = resolve(ROOT, MANIFEST);

let measured;
try {
  measured = measure();
} catch (error) {
  console.error(`\nVendored browser bundle check failed: ${error.message}\n`);
  process.exit(1);
}

if (write) {
  const record = {
    _: `Provenance of ${BUNDLE_DIR}. Generated by deploy-to-adk.sh; verified by scripts/check-vendored-bundle.mjs. Re-vendor with "${REMEDY}" rather than editing this file.`,
    sourceDigest: measured.source.digest,
    sourceFileCount: measured.source.fileCount,
    bundleDigest: measured.bundle.digest,
    bundleFileCount: measured.bundle.fileCount,
  };
  writeFileSync(manifestPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(
    `Recorded vendored bundle provenance in ${MANIFEST} ` +
      `(${record.bundleFileCount} bundled files from ${record.sourceFileCount} source inputs).`
  );
  process.exit(0);
}

if (!existsSync(manifestPath)) {
  console.error(
    `\nVendored browser bundle check failed:\n\n` +
      `  - ${MANIFEST} does not exist, so there is no record of what ${BUNDLE_DIR}\n` +
      `    was built from. Re-vendor with "${REMEDY}", which writes it.\n`
  );
  process.exit(1);
}

let recorded;
try {
  recorded = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`\nVendored browser bundle check failed: ${MANIFEST} is not readable JSON (${error.message}).\n`);
  process.exit(1);
}

const failures = [];
if (recorded.sourceDigest !== measured.source.digest) {
  failures.push(
    `The sources the bundle is built from have changed since it was vendored, so ` +
      `${BUNDLE_DIR}\n    is stale and the ADK package ships a UI that no longer matches this repository.\n` +
      `    Recorded source digest ${recorded.sourceDigest} over ${recorded.sourceFileCount} files, ` +
      `now ${measured.source.digest} over ${measured.source.fileCount}.\n` +
      `    Re-vendor with "${REMEDY}" and commit the result.`
  );
}
if (recorded.bundleDigest !== measured.bundle.digest) {
  failures.push(
    `${BUNDLE_DIR} is not the tree that was vendored — it has been edited, or some of\n` +
      `    it did not reach the commit (check .gitignore before assuming otherwise).\n` +
      `    Recorded bundle digest ${recorded.bundleDigest} over ${recorded.bundleFileCount} files, ` +
      `now ${measured.bundle.digest} over ${measured.bundle.fileCount}.\n` +
      `    Re-vendor with "${REMEDY}" and commit the result.`
  );
}

if (failures.length > 0) {
  console.error(`\nVendored browser bundle check failed (${failures.length}):\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}

console.log(
  `Vendored browser bundle OK (${measured.bundle.fileCount} files, ` +
    `built from ${measured.source.fileCount} source inputs at ${measured.source.digest.slice(0, 12)}).`
);
