#!/usr/bin/env node
// Bump the single published package @galvanized-pukeko/vue-ui.
//
// Ported from gaunt-sloth's release/bump.mjs, trimmed to ONE package (galvanized
// publishes only @galvanized-pukeko/vue-ui; the web-client + agent-adk are private
// examples). There is no cross-package version sync here.
//
//   pnpm run release:bump                      — patch-increment vue-ui's version
//   pnpm run release:bump -- minor             — increment (patch|minor|major|pre*)
//   pnpm run release:bump -- prerelease alpha  — semver.inc with a preid
//   pnpm run release:bump -- 0.2.0-alpha.0     — set an explicit version
//   pnpm run release:bump-and-commit -- ...    — same, then refresh pnpm-lock.yaml + git-commit
//   ... --dry-run                              — compute + print only, write NOTHING
//
// packages/galvanized-pukeko-vue-ui/package.json is the source of truth for the version.
//
// publishConfig.tag (the `latest`-hijack guard) is derived from the new version:
// a prerelease (e.g. 0.2.0-alpha.0) gets its preid (alpha/beta/rc) as the tag; a
// stable version gets `latest`. So even a bare `npm publish` can't move `latest`
// onto a prerelease.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

// This script lives in <repo>/scripts/, so the repo ROOT is one level up.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_REL = 'packages/galvanized-pukeko-vue-ui/package.json';

const RELEASE_TYPES = [
  'patch',
  'minor',
  'major',
  'prepatch',
  'preminor',
  'premajor',
  'prerelease',
];
const PREIDS = ['alpha', 'beta', 'rc'];

// Drop our own flags and any bare `--` arg-separator. pnpm forwards the `--` from
// `pnpm run <script> -- <args>` literally into argv (npm strips it), so without this
// a `--` would be parsed as the version spec.
const rawArgs = process.argv.slice(2);
const args = rawArgs.filter((a) => a !== '--commit' && a !== '--dry-run' && a !== '--');
const commit = rawArgs.includes('--commit');
const dryRun = rawArgs.includes('--dry-run');

// Arg shapes:
//   (nothing)              -> patch
//   <releaseType> [preid]  -> semver.inc(current, releaseType, preid)
//   <explicit version>     -> set verbatim (e.g. 0.2.0-alpha.0)
const spec = args[0] ?? 'patch';
const preid = args[1];

const isReleaseType = RELEASE_TYPES.includes(spec);
const isExplicit = semver.valid(spec) !== null;

if (!isReleaseType && !isExplicit) {
  console.error(
    `Bad version: ${spec}. Expected one of [${RELEASE_TYPES.join(' | ')}] ` +
      `or an explicit MAJOR.MINOR.PATCH[-prerelease].`
  );
  process.exit(1);
}
if (preid !== undefined && !PREIDS.includes(preid)) {
  console.error(`Bad preid: ${preid}. Expected one of [${PREIDS.join(' | ')}].`);
  process.exit(1);
}
if (preid !== undefined && isExplicit) {
  console.error(`A preid (${preid}) is only valid with a release type, not an explicit version.`);
  process.exit(1);
}

function readPkg(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}
function writePkg(rel, obj) {
  writeFileSync(join(ROOT, rel), JSON.stringify(obj, null, 2) + '\n');
}

const currentVersion = readPkg(PKG_REL).version;
const target = isReleaseType ? semver.inc(currentVersion, spec, preid) : spec;
if (!target || semver.valid(target) === null) {
  console.error(
    `Could not compute a valid target version from "${spec}" (current: ${currentVersion}).`
  );
  process.exit(1);
}

// Derive the npm dist-tag / publishConfig.tag from the version's channel:
// a prerelease -> its preid (alpha/beta/rc); a stable version -> latest.
function deriveTag(version) {
  const pre = semver.prerelease(version);
  if (!pre) return 'latest';
  const id = pre.find((p) => typeof p === 'string');
  return id ?? 'latest';
}
const distTag = deriveTag(target);

console.log(
  `vue-ui  ${currentVersion} → ${target}  (publishConfig.tag = ${distTag})` +
    (dryRun ? '   [dry-run: nothing written]' : '')
);

if (dryRun) {
  // Compute-only: emit a machine-readable summary and exit without touching disk.
  console.log(JSON.stringify({ current: currentVersion, next: target, tag: distTag }));
  process.exit(0);
}

// Write publishConfig.tag, preserving any other publishConfig keys.
function setPublishTag(pkg) {
  const current = pkg.publishConfig ?? {};
  pkg.publishConfig = { ...current, tag: distTag };
}

const pkg = readPkg(PKG_REL);
pkg.version = target;
setPublishTag(pkg);
writePkg(PKG_REL, pkg);

if (commit) {
  // pnpm-lock.yaml records the workspace importers, so refresh it or a later
  // `pnpm install --frozen-lockfile` sees the lock and the package.json out of
  // sync. `--lockfile-only` updates the lock without touching node_modules and is
  // a no-op when nothing in the lock changed.
  console.log('Refreshing pnpm-lock.yaml');
  execFileSync('pnpm', ['install', '--lockfile-only'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const files = [PKG_REL, 'pnpm-lock.yaml'];
  const status = execFileSync('git', ['status', '--porcelain', '--', ...files], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  if (!status) {
    console.log('Everything already committed at this version — nothing to commit.');
  } else {
    execFileSync('git', ['add', '--', ...files], { cwd: ROOT, stdio: 'inherit' });
    // Post-bump (Model B): main now carries the NEXT version to publish, i.e. the
    // start of that version's dev cycle, NOT its release (the prior version's
    // release/tag/publish already happened). Word it so history doesn't read as if
    // `target` has shipped.
    execFileSync(
      'git',
      ['commit', '-m', `chore(release): start vue-ui ${target} development cycle`, '--', ...files],
      { cwd: ROOT, stdio: 'inherit' }
    );
  }
}
