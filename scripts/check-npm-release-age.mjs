#!/usr/bin/env node
// Guard: enforce this repository's 24-hour package-maturity window in the
// directories pnpm never sees.
//
// pnpm-workspace.yaml carries `minimumReleaseAge` and `minimumReleaseAgeStrict`,
// and its comment explains at length that a refusal is the guard working. Those
// are PNPM settings. A directory that is not a workspace member and installs with
// npm is not partially covered and not covered with a warning — it is structurally
// unreachable by them. Measured: a plain `npm install` in
// examples/adk-ui-agent-to-external-mcp/demo-mcp pulled eslint@10.11.0, published
// 21.5 hours earlier, with no refusal and no warning (OPS-144, from a sweep the
// OPS-107 lane ran over all 126 packages its change added or re-resolved, with an
// age resolved for every one and zero unknowns).
//
// A guard believed to be on is worse than one known to be absent, because nobody
// checks. So this script does three things, in this order:
//
//   1. ENUMERATE the npm-managed directories, by derivation rather than by hand:
//      every directory holding a package.json, minus the workspace root, minus the
//      git submodules, minus everything pnpm-workspace.yaml's `packages:` globs
//      claim. The set is then
//      reconciled against the table below, so a newly added npm-installed
//      directory turns this red instead of quietly joining the unguarded set. The
//      list nobody was keeping is the thing that let this hole open.
//   2. CHECK THE PNPM WINDOW ITSELF is still declared as the comment promises,
//      since every number below is read from it rather than repeated here.
//   3. SWEEP the npm lockfiles: resolve a publish date for every pinned version
//      and fail on anything inside the window — and, just as loudly, on any age it
//      could not resolve.
//
// WHY AN UNRESOLVED AGE IS A FAILURE AND NOT A SKIP. `npm view <name> time --json`
// under npm 12 wraps its result in a single-element array. The OPS-107 lane hit
// that and caught it only because it asserted that zero ages were unknown;
// otherwise the report comes back a clean-looking table of question marks that
// reads exactly like "nothing to see". This script fetches the registry packument
// directly rather than shelling out, so that particular shape cannot arise, and it
// unwraps a single-element array anyway in case anyone ever routes `npm view`
// output through here. An unknown age is the same shape of hazard as an unchecked
// one and is reported as a failure.
//
// WHAT THIS DOES NOT DO, so it is known rather than discovered:
//   - It does not stop an immature package being installed. It reads what is
//     already pinned. pnpm refuses at install time; there is no npm equivalent
//     that refuses (npm's own `min-release-age` resolves BACKWARD to an older
//     version instead of erroring, which would be a second promise this repository
//     does not keep), so the npm sites are guarded AT REST, by this check, and the
//     window is enforced when a lockfile change reaches CI rather than when a
//     developer types the install.
//   - It can only sweep a directory that HAS a lockfile. Two of the three npm sites
//     below pin nothing at all, so there is no artefact to check and a fresh
//     install there can resolve to a version published minutes ago. That is
//     recorded per-site in the table below, printed on every run, and stated in
//     pnpm-workspace.yaml's comment. It is a known open hole, not a covered one.
//   - It reads the lockfile, not node_modules. A directory installed before a
//     lockfile change, or installed with `--no-save`, is not what this measures.
//
// Run:
//   node scripts/check-npm-release-age.mjs --offline   enumerate + reconcile + config
//                                                      only; no network. Wired into
//                                                      "pnpm test".
//   node scripts/check-npm-release-age.mjs             the above plus the full age
//                                                      sweep. Needs the registry;
//                                                      runs in CI.
//   node scripts/check-npm-release-age.mjs --base <ref>     sweep only versions this
//                                                           lockfile adds or moves
//                                                           relative to <ref>.
//   node scripts/check-npm-release-age.mjs --lockfile <p>   sweep one lockfile by
//                                                           path, skipping the
//                                                           enumeration. For audits
//                                                           and for the controls that
//                                                           prove this can go red.
//   node scripts/check-npm-release-age.mjs --list      print the derived set and exit.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_FILE = 'pnpm-workspace.yaml';

// The npm-managed directories, with what this check can actually do at each. The
// DIRECTORIES are derived (see deriveNpmSites); this table is the DISPOSITION of
// each one, which is a judgement and cannot be derived. The two are reconciled on
// every run in both directions, so neither a new site nor a stale row survives.
const DECLARED_NPM_SITES = [
  {
    dir: 'examples/adk-ui-agent-to-external-mcp/demo-mcp',
    lockfile: 'package-lock.json',
    note:
      'Standalone external-MCP demo whose README deliberately tells a reader to run `npm install`, ' +
      'which is the situation a consumer of the demo is actually in. Its lockfile is tracked, so ' +
      'every version it pins is swept here.',
  },
  {
    dir: 'experiments/simple-vue-components-demo',
    lockfile: null,
    note:
      'No lockfile is tracked, so nothing pins a version and there is no artefact to sweep: a fresh ' +
      '`npm install` here can resolve to a package published minutes ago. UNGUARDED, deliberately ' +
      'recorded rather than implied covered.',
  },
  {
    dir: 'experiments/ui-mcp-server-js',
    lockfile: null,
    note:
      'No lockfile is tracked; same standing as the demo above. UNGUARDED, deliberately recorded ' +
      'rather than implied covered.',
  },
];

// Directories that are not ours to police, or that hold build output / installed
// trees. Mirrors scripts/check-no-bare-launchers.mjs — a package.json under any of
// these is somebody else's, not an npm site of ours.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-ssr',
  'dist-server',
  'build',
  'target',
  'coverage',
  'test-results',
  'playwright-report',
  '.idea',
  '.vscode',
  '.pnpm-store',
  '_scratchpad',
]);

const DEFAULT_CONCURRENCY = 8;
const FETCH_ATTEMPTS = 3;

function fail(lines) {
  console.error(`\n${lines.join('\n')}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- argv

function parseArgs(argv) {
  const args = {
    offline: false,
    list: false,
    base: null,
    lockfile: null,
    registry: null,
    now: null,
    windowMinutes: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) fail([`${arg} needs a value.`]);
      i += 1;
      return value;
    };
    if (arg === '--offline') args.offline = true;
    else if (arg === '--list') args.list = true;
    else if (arg === '--base') args.base = next();
    else if (arg === '--lockfile') args.lockfile = next();
    else if (arg === '--registry') args.registry = next();
    else if (arg === '--now') args.now = next();
    else if (arg === '--window-minutes') args.windowMinutes = Number(next());
    else fail([`Unknown argument "${arg}".`, 'Run with no arguments for the full check.']);
  }
  // A pinned clock or a hand-set window is how the controls prove this check can
  // go red, and it is also how someone would wave a red CI run through. Under CI
  // there is nothing to prove and the overrides are refused outright.
  if (process.env.CI && (args.now !== null || args.windowMinutes !== null)) {
    fail([
      'Refusing --now / --window-minutes under CI.',
      'They exist so a control run can pin the clock or the window while proving this check',
      'goes red. Accepting them here would let a red CI run be argued away.',
    ]);
  }
  return args;
}

// ---------------------------------------------------- pnpm workspace config

// Deliberately a line read rather than a YAML parse: this repository declares no
// YAML dependency at the root, and adding one to read two scalars out of a file we
// also own is a worse trade than a narrow reader that fails loudly. Both keys are
// top-level scalars; anything else here is a failure, not a fallback.
function readPnpmWindow() {
  const path = join(ROOT, WORKSPACE_FILE);
  if (!existsSync(path)) {
    fail([`${WORKSPACE_FILE} does not exist, so this repository's maturity window is undefined.`]);
  }
  const text = readFileSync(path, 'utf8');
  const ageMatch = text.match(/^minimumReleaseAge:[ \t]*(\d+)[ \t]*$/m);
  const strictMatch = text.match(/^minimumReleaseAgeStrict:[ \t]*(\S+)[ \t]*$/m);
  const problems = [];
  if (!ageMatch) {
    problems.push(
      `${WORKSPACE_FILE} has no top-level numeric "minimumReleaseAge". Every window this check ` +
        'enforces is read from there, so there is nothing to enforce and the comment beside it is ' +
        'describing a guard that is not configured.'
    );
  }
  if (!strictMatch || strictMatch[1] !== 'true') {
    problems.push(
      `${WORKSPACE_FILE} does not set "minimumReleaseAgeStrict: true". Without it pnpm warns ` +
        'instead of refusing, and the comment beside it promises a refusal.'
    );
  }
  if (problems.length > 0) fail(['Package-maturity configuration check failed:', ...problems.map((p) => `  - ${p}`)]);
  return Number(ageMatch[1]);
}

function readWorkspaceGlobs() {
  const text = readFileSync(join(ROOT, WORKSPACE_FILE), 'utf8');
  const globs = [];
  let inPackages = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trimEnd();
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = line.match(/^\s+-\s*(.+?)\s*$/);
      if (item) {
        globs.push(item[1].replace(/^['"]|['"]$/g, ''));
        continue;
      }
      if (line.trim() !== '') inPackages = false;
    }
  }
  if (globs.length === 0) {
    fail([
      `${WORKSPACE_FILE} declares no "packages:" entries, so every directory in this repository`,
      'would be read as npm-managed. That is a parse failure, not a repository with no workspace.',
    ]);
  }
  return globs;
}

// pnpm's globs here are plain paths or `*` / `**` segments, optionally negated
// with a leading `!`. Anything more exotic would silently widen the pnpm-managed
// set and narrow what this check looks at, so an unsupported character fails.
function globToRegExp(glob) {
  if (/[?[\]{}()+@!]/.test(glob.replace(/^!/, ''))) {
    fail([
      `${WORKSPACE_FILE} uses a glob this check cannot read: "${glob}".`,
      'An unreadable glob would silently shrink the set of directories swept here.',
      'Teach globToRegExp() the syntax, or spell the entry out as a path.',
    ]);
  }
  const body = glob.replace(/^!/, '');
  const pattern = body
    .split('/')
    .map((segment) => {
      if (segment === '**') return '.*';
      return segment.replace(/[.^$+|\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    })
    .join('/')
    .replace(/\.\*\//g, '(?:.*/)?');
  return new RegExp(`^${pattern}$`);
}

function isWorkspaceMember(dir, globs) {
  let matched = false;
  for (const glob of globs) {
    const negated = glob.startsWith('!');
    if (globToRegExp(glob).test(dir)) matched = !negated;
  }
  return matched;
}

// ------------------------------------------------------------- enumeration

// Git submodules are other repositories that happen to be checked out inside this
// one, and a package.json in one of them is not a directory this repository
// installs. The paths are read from .gitmodules rather than skipped by directory
// name: the site submodule is mapped at `docs`, and skipping every directory named
// `docs` would be far wider than the thing being excluded. An uninitialised
// submodule is an empty directory and would pass either way — which is exactly why
// this cannot be left to be discovered later, by whoever first runs
// `git submodule update --init` and finds `pnpm test` red over a tree nobody here
// maintains.
function readSubmodulePaths() {
  const file = join(ROOT, '.gitmodules');
  if (!existsSync(file)) return new Set();
  const paths = new Set();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*path\s*=\s*(.+?)\s*$/);
    if (match) paths.add(match[1].replace(/\/+$/, ''));
  }
  return paths;
}

function walkForPackageDirs(absDir, found, excluded) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return found;
  }
  if (entries.some((entry) => entry.isFile() && entry.name === 'package.json')) {
    found.push(relative(ROOT, absDir).split('\\').join('/') || '.');
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const child = join(absDir, entry.name);
    if (excluded.has(relative(ROOT, child).split('\\').join('/'))) continue;
    walkForPackageDirs(child, found, excluded);
  }
  return found;
}

// The derivation, in one place so it can be re-run rather than trusted:
// every directory holding a package.json, minus the workspace root itself, minus
// the git submodules, minus everything pnpm-workspace.yaml's `packages:` globs
// claim. What is left installs with npm, because nothing else installs it.
function deriveNpmSites() {
  const globs = readWorkspaceGlobs();
  return walkForPackageDirs(ROOT, [], readSubmodulePaths())
    .filter((dir) => dir !== '.')
    .filter((dir) => !isWorkspaceMember(dir, globs))
    .sort();
}

function reconcileSites(derived) {
  const declared = new Map(DECLARED_NPM_SITES.map((site) => [site.dir, site]));
  const problems = [];
  for (const dir of derived) {
    if (!declared.has(dir)) {
      problems.push(
        `${dir} installs with npm and is not in DECLARED_NPM_SITES in this script.\n` +
          '    pnpm-workspace.yaml cannot reach it, so nothing stops it resolving a package published\n' +
          '    minutes ago. Add it to the table with a lockfile to sweep, or with `lockfile: null` and\n' +
          '    a note saying plainly that it is unguarded.'
      );
    }
  }
  for (const site of DECLARED_NPM_SITES) {
    if (!derived.includes(site.dir)) {
      problems.push(
        `${site.dir} is declared in DECLARED_NPM_SITES but is no longer an npm-managed directory\n` +
          '    (it is gone, or it joined the pnpm workspace). Remove the row so the table keeps\n' +
          '    describing this repository.'
      );
      continue;
    }
    const lockPath = join(ROOT, site.dir, 'package-lock.json');
    if (site.lockfile && !existsSync(lockPath)) {
      problems.push(
        `${site.dir} is declared with a lockfile to sweep, but ${site.dir}/package-lock.json does\n` +
          '    not exist. Either it was deleted — in which case that site is now unguarded and the row\n' +
          '    must say so — or this is a partial checkout.'
      );
    }
    if (!site.lockfile && existsSync(lockPath)) {
      problems.push(
        `${site.dir} is declared as pinning nothing, but ${site.dir}/package-lock.json now exists.\n` +
          '    It can be swept, so it must be: set `lockfile: "package-lock.json"` on that row.'
      );
    }
  }
  return problems;
}

// ------------------------------------------------------------- lock reading

function packageNameFromLockKey(key, entry) {
  if (entry && typeof entry.name === 'string' && entry.name !== '') return entry.name;
  const marker = 'node_modules/';
  const index = key.lastIndexOf(marker);
  if (index === -1) return null;
  return key.slice(index + marker.length);
}

function readLock(absPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absPath, 'utf8'));
  } catch (error) {
    fail([`${relative(ROOT, absPath)} is not readable JSON (${error.message}).`]);
  }
  if (!parsed || typeof parsed.packages !== 'object' || parsed.packages === null) {
    fail([
      `${relative(ROOT, absPath)} has no "packages" object.`,
      'lockfileVersion 1 is not supported: it records no resolved URLs, so nothing here could tell',
      'a registry tarball from a git dependency. Re-install with a current npm to upgrade it.',
    ]);
  }
  return parsed;
}

// Splits a lockfile into what can be age-checked and what cannot, and never into a
// silent third pile. `self` is the lockfile's own project entry; `unpinnable` is
// anything whose resolution is not a registry tarball at the registry we are
// asking — a git or file dependency, a workspace link, or a tarball from another
// host, none of which this check measures.
function classifyLockEntries(lock, lockLabel, registryHost) {
  const pinned = [];
  const unpinnable = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === '') continue;
    if (!entry || typeof entry !== 'object') {
      unpinnable.push({ key, why: 'the entry is not an object' });
      continue;
    }
    if (entry.link === true) {
      unpinnable.push({ key, why: `a local link to ${entry.resolved ?? 'an unstated path'}` });
      continue;
    }
    const name = packageNameFromLockKey(key, entry);
    if (!name) {
      unpinnable.push({ key, why: 'no package name could be read from the entry or its path' });
      continue;
    }
    if (typeof entry.version !== 'string' || entry.version === '') {
      unpinnable.push({ key, why: 'the entry pins no version' });
      continue;
    }
    if (typeof entry.resolved !== 'string' || entry.resolved === '') {
      unpinnable.push({ key, why: 'the entry records no resolved URL' });
      continue;
    }
    let host;
    try {
      host = new URL(entry.resolved).host;
    } catch {
      unpinnable.push({ key, why: `resolved is not a URL (${entry.resolved})` });
      continue;
    }
    if (host !== registryHost) {
      unpinnable.push({
        key,
        why: `resolved from ${host}, but ages are being read from ${registryHost}`,
      });
      continue;
    }
    pinned.push({ key, name, version: entry.version, lockLabel });
  }
  return { pinned, unpinnable };
}

// The lock diff: the versions <ref>'s copy of this lockfile did not already have.
// A missing base is a hard failure rather than a quiet fall-back to sweeping
// everything, because the two answer different questions and only one was asked.
function readBaseLock(baseRef, lockRelPath) {
  let text;
  try {
    text = execFileSync('git', ['show', `${baseRef}:${lockRelPath}`], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    fail([
      `Could not read ${lockRelPath} at ${baseRef} (${String(error.message).trim()}).`,
      'Fetch that ref, name another with --base, or drop --base to sweep every pinned version.',
    ]);
  }
  const parsed = JSON.parse(text);
  const seen = new Set();
  for (const [key, entry] of Object.entries(parsed.packages ?? {})) {
    if (key === '' || !entry) continue;
    const name = packageNameFromLockKey(key, entry);
    if (name && entry.version) seen.add(`${name}@${entry.version}`);
  }
  return seen;
}

// ------------------------------------------------------------ age resolution

function resolveRegistry(explicit) {
  const fromFlag = explicit ?? process.env.npm_config_registry ?? null;
  let url = fromFlag;
  let source = fromFlag ? (explicit ? '--registry' : 'npm_config_registry') : null;
  if (!url) {
    try {
      url = execFileSync('npm', ['config', 'get', 'registry'], { cwd: ROOT, encoding: 'utf8' }).trim();
      source = '`npm config get registry`';
    } catch (error) {
      fail([
        `Could not read the npm registry (${String(error.message).trim()}).`,
        'Ages must be read from the registry these lockfiles actually resolve against; guessing at',
        'registry.npmjs.org would measure a different registry than the one that served the tarballs.',
        'Pass --registry <url>, or set npm_config_registry.',
      ]);
    }
  }
  if (!url || url === 'undefined' || url === 'null') {
    fail(['The npm registry resolved to an empty value. Pass --registry <url>.']);
  }
  return { url: url.endsWith('/') ? url : `${url}/`, source };
}

async function fetchPackument(registry, name) {
  const url = `${registry}${name.replace(/\//g, '%2F')}`;
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    let response;
    try {
      // The FULL packument: the abbreviated one (application/vnd.npm.install-v1+json)
      // and the per-version document both omit `time` entirely, so neither can be
      // used here and a fall-back to either would return "unknown" for everything.
      response = await fetch(url, { headers: { accept: 'application/json' } });
    } catch (error) {
      lastError = `network error: ${error.message}`;
      if (attempt < FETCH_ATTEMPTS) await new Promise((r) => setTimeout(r, 250 * attempt));
      continue;
    }
    if (response.status === 404) return { ok: false, why: `the registry has no package "${name}" (404)` };
    if (!response.ok) {
      lastError = `the registry answered ${response.status} ${response.statusText}`;
      if (attempt < FETCH_ATTEMPTS) await new Promise((r) => setTimeout(r, 250 * attempt));
      continue;
    }
    let body;
    try {
      body = await response.json();
    } catch (error) {
      return { ok: false, why: `the registry's answer was not JSON (${error.message})` };
    }
    // npm 12 wraps `npm view <name> time --json` in a single-element array. Nothing
    // here produces that shape, but unwrapping it costs one line and the failure it
    // prevents is an age table of question marks that reads like a clean run.
    if (Array.isArray(body)) body = body.length === 1 ? body[0] : null;
    if (!body || typeof body !== 'object') {
      return { ok: false, why: 'the registry returned no usable document' };
    }
    return { ok: true, doc: body };
  }
  return { ok: false, why: lastError ?? 'the registry could not be reached' };
}

async function resolvePublishTimes(registry, pinned, concurrency) {
  const byName = new Map();
  for (const item of pinned) {
    if (!byName.has(item.name)) byName.set(item.name, []);
    byName.get(item.name).push(item);
  }
  const names = [...byName.keys()];
  const results = new Map();
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= names.length) return;
      const name = names[index];
      results.set(name, await fetchPackument(registry, name));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, worker));

  const resolved = [];
  const unresolved = [];
  for (const [name, items] of byName) {
    const result = results.get(name);
    for (const item of items) {
      if (!result.ok) {
        unresolved.push({ ...item, why: result.why });
        continue;
      }
      const times = result.doc.time;
      if (!times || typeof times !== 'object') {
        unresolved.push({ ...item, why: `the packument for "${name}" carries no "time" map` });
        continue;
      }
      const stamp = times[item.version];
      if (typeof stamp !== 'string') {
        unresolved.push({
          ...item,
          why: `the packument for "${name}" has no publish time for version ${item.version}`,
        });
        continue;
      }
      const published = Date.parse(stamp);
      if (Number.isNaN(published)) {
        unresolved.push({ ...item, why: `publish time "${stamp}" is not a date` });
        continue;
      }
      resolved.push({ ...item, published, stamp });
    }
  }
  return { resolved, unresolved };
}

// ------------------------------------------------------------------- main

const args = parseArgs(process.argv.slice(2));
const windowMinutes = args.windowMinutes ?? readPnpmWindow();
if (!Number.isFinite(windowMinutes) || windowMinutes < 0) {
  fail([`--window-minutes must be a non-negative number (got "${args.windowMinutes}").`]);
}
const now = args.now === null ? Date.now() : Date.parse(args.now);
if (Number.isNaN(now)) fail([`--now must be a parsable date (got "${args.now}").`]);
if (args.now !== null || args.windowMinutes !== null) {
  console.log(
    'OVERRIDE IN EFFECT — this run is not the guard: ' +
      `clock ${args.now === null ? 'real' : new Date(now).toISOString()}, ` +
      `window ${windowMinutes} minutes.`
  );
}
const windowMs = windowMinutes * 60 * 1000;
const failures = [];

// Phase 1 + 2, unless a single lockfile was named for an audit or a control run.
let sweepTargets = [];
if (args.lockfile) {
  const absolute = resolve(process.cwd(), args.lockfile);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    fail([`--lockfile ${args.lockfile} is not a file.`]);
  }
  console.log(`Sweeping one lockfile by path: ${absolute}`);
  console.log('The enumeration and the pnpm-window check are skipped in this mode.\n');
  sweepTargets = [{ label: args.lockfile, absolute, relForGit: null }];
} else {
  const derived = deriveNpmSites();
  const declared = new Map(DECLARED_NPM_SITES.map((site) => [site.dir, site]));
  console.log(
    `npm-managed directories (${derived.length}) — derived as: every directory holding a ` +
      'package.json,\nminus the workspace root, minus the git submodules, minus everything ' +
      "pnpm-workspace.yaml's `packages:` globs claim.\n"
  );
  for (const dir of derived) {
    const site = declared.get(dir);
    const coverage = site
      ? site.lockfile
        ? `swept here (${site.lockfile})`
        : 'UNGUARDED — pins nothing, nothing to sweep'
      : 'UNDECLARED';
    console.log(`  ${dir}\n      ${coverage}`);
  }
  console.log('');
  failures.push(...reconcileSites(derived).map((problem) => ({ label: 'SITE', detail: problem })));

  sweepTargets = DECLARED_NPM_SITES.filter((site) => site.lockfile && derived.includes(site.dir)).map((site) => ({
    label: `${site.dir}/${site.lockfile}`,
    absolute: join(ROOT, site.dir, site.lockfile),
    relForGit: `${site.dir}/${site.lockfile}`,
  }));

  if (args.list) {
    process.exit(failures.length > 0 ? 1 : 0);
  }
}

if (args.offline) {
  if (failures.length > 0) {
    console.error(`\nnpm package-maturity check failed (${failures.length}):\n`);
    for (const item of failures) console.error(`  - ${item.label}: ${item.detail}\n`);
    process.exit(1);
  }
  console.log(
    `Offline check OK: the npm-managed set matches this script's table and ${WORKSPACE_FILE} still ` +
      `declares a ${windowMinutes}-minute strict window.\nNo publish age was read — run without ` +
      '--offline to sweep the lockfiles against the registry.'
  );
  process.exit(0);
}

// Which source decided the registry is part of the measurement: an age read from
// one registry says nothing about a tarball served by another, and the mismatch is
// reported per entry below.
const { url: registry, source: registrySource } = resolveRegistry(args.registry);
const registryHost = new URL(registry).host;
console.log(`Resolving publish times from ${registry} (registry taken from ${registrySource})`);

let pinnedTotal = 0;
const allPinned = [];
for (const target of sweepTargets) {
  const lock = readLock(target.absolute);
  const { pinned, unpinnable } = classifyLockEntries(lock, target.label, registryHost);
  let selected = pinned;
  if (args.base) {
    if (!target.relForGit) {
      fail(['--base needs a lockfile tracked in this repository; it cannot be combined with --lockfile.']);
    }
    const before = readBaseLock(args.base, target.relForGit);
    selected = pinned.filter((item) => !before.has(`${item.name}@${item.version}`));
    console.log(
      `  ${target.label}: ${pinned.length} pinned, ${selected.length} added or moved since ${args.base}`
    );
  } else {
    console.log(`  ${target.label}: ${pinned.length} pinned versions`);
  }
  for (const entry of unpinnable) {
    failures.push({
      label: 'NON-REGISTRY',
      detail:
        `${target.label} entry "${entry.key}" cannot be age-checked: ${entry.why}.\n` +
        '    No publish date exists for it here, so it is reported rather than skipped.',
    });
  }
  pinnedTotal += selected.length;
  allPinned.push(...selected);
}

const { resolved, unresolved } = await resolvePublishTimes(registry, allPinned, DEFAULT_CONCURRENCY);

for (const item of unresolved) {
  failures.push({
    label: 'UNRESOLVED',
    detail:
      `${item.name}@${item.version} (${item.lockLabel}): ${item.why}.\n` +
      '    An age that could not be resolved is the same shape of hazard as one that was never\n' +
      '    checked, so it fails here rather than being counted as fine.',
  });
}

const immature = resolved
  .filter((item) => now - item.published < windowMs)
  .sort((a, b) => a.published - b.published);
for (const item of immature) {
  const ageHours = ((now - item.published) / 3600000).toFixed(1);
  failures.push({
    label: 'IMMATURE',
    detail:
      `${item.name}@${item.version} (${item.lockLabel}) was published ${item.stamp}, ` +
      `${ageHours} hours ago —\n    inside this repository's ${windowMinutes}-minute maturity window.\n` +
      '    Remedies, in order of preference: wait out the window and install again; pin the older\n' +
      '    mature version deliberately. It is never "make the build go green".',
  });
}

// The assertion that catches the failure mode this check exists to avoid: a sweep
// that resolved nothing reads exactly like a sweep that found nothing wrong.
console.log(
  `\nAges resolved: ${resolved.length} of ${pinnedTotal} pinned versions; unresolved: ${unresolved.length}.`
);

if (failures.length > 0) {
  const counts = failures.reduce((acc, item) => acc.set(item.label, (acc.get(item.label) ?? 0) + 1), new Map());
  console.error(
    `\nnpm package-maturity check FAILED (${failures.length}: ` +
      `${[...counts].map(([label, count]) => `${count} ${label}`).join(', ')}):\n`
  );
  for (const item of failures) console.error(`  - ${item.label}: ${item.detail}\n`);
  process.exit(1);
}

console.log(
  `npm package-maturity check OK: every pinned version at the npm-managed sites is older than the ` +
    `${windowMinutes}-minute window, with no unresolved ages.`
);
