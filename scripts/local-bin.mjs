// Resolve a dependency's own bin script and run it with the current Node.
//
// WHY THIS EXISTS (QA-19). The harnesses used to spawn a one-shot package runner
// with a bare tool name. When that name does not resolve in a local node_modules
// the runner falls through to the public registry and executes whatever comes
// back — unpinned, unreviewed, and with the full privileges of the developer who
// typed `pnpm run e2e`. The failure is silent and plausible: a gate that quietly
// tests a published release instead of your branch looks exactly like a gate that
// passed. So the fix is not to swap one bare name for another; it is to stop
// asking anything to look a name up.
//
// What we do instead: find the installed package directory, read its own `bin`
// field, and spawn `process.execPath` (this Node) with the resolved script path.
// That cannot reach the network, cannot be shadowed by PATH, and needs no shell —
// so it is also Windows-safe, where node_modules/.bin holds a .cmd/.ps1 shim that
// only a shell can launch.
//
// Note we do NOT use `require.resolve('<pkg>/package.json')`: a package whose
// `exports` map does not list "./package.json" throws ERR_PACKAGE_PATH_NOT_EXPORTED
// there. `@gaunt-sloth/agent` is exactly such a package. Reading the manifest off
// disk works for every layout, hoisted or pnpm-linked.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Find the directory of an installed package by walking node_modules upward.
 *
 * @param {string} pkg package name, e.g. "@playwright/test"
 * @param {string} fromDir directory to start the walk from (pass the repo root)
 * @returns {string | undefined} absolute package directory, or undefined
 */
function findInstalledPackageDir(pkg, fromDir) {
  let dir = resolve(fromDir);
  for (;;) {
    const candidate = join(dir, 'node_modules', ...pkg.split('/'));
    if (existsSync(join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function notInstalled(pkg, binName, fromDir) {
  return (
    `Cannot find the local "${binName}" executable provided by "${pkg}".\n` +
    `Looked for node_modules/${pkg} in ${resolve(fromDir)} and every parent directory.\n` +
    `Run "pnpm install" in the repository root first (and "pnpm run build" if the\n` +
    `binary comes from a workspace package that has not been built yet).\n` +
    `This harness deliberately does NOT fall back to a package runner that would\n` +
    `fetch "${binName}" from the public registry — a bare name that misses local\n` +
    `resolution executes whatever the registry hands back.`
  );
}

/**
 * Resolve the absolute path of a bin script owned by an installed dependency.
 * Throws — loudly, with an install-first message — when it is not there.
 *
 * @param {string} pkg package name that declares the bin, e.g. "@playwright/test"
 * @param {string} binName the bin command name, e.g. "playwright"
 * @param {string} fromDir directory to resolve from (pass the repo root)
 * @returns {string} absolute path to the bin's JavaScript entry point
 */
export function resolveLocalBin(pkg, binName, fromDir) {
  const pkgDir = findInstalledPackageDir(pkg, fromDir);
  if (!pkgDir) {
    throw new Error(notInstalled(pkg, binName, fromDir));
  }

  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const bin = manifest.bin;
  const relative =
    typeof bin === 'string' ? (manifest.name === binName ? bin : undefined) : bin?.[binName];
  if (!relative) {
    throw new Error(
      `"${pkg}" is installed at ${pkgDir} but declares no bin named "${binName}".\n` +
        `Declared bins: ${JSON.stringify(bin ?? null)}.\n` +
        `Either the dependency version changed its bin names or this call site has a typo.`
    );
  }

  const binPath = resolve(pkgDir, relative);
  if (!existsSync(binPath)) {
    throw new Error(
      `"${pkg}" declares bin "${binName}" at ${relative}, but ${binPath} does not exist.\n` +
        `The package is probably installed but not built. Run "pnpm install" and build it.`
    );
  }
  return binPath;
}

/**
 * As {@link resolveLocalBin}, but prints the message and exits 1 instead of
 * throwing a stack trace. Call this at the TOP of a harness, before any long
 * running service is started: a missing binary must abort while there is still
 * nothing to tear down.
 *
 * @returns {string} absolute path to the bin's JavaScript entry point
 */
export function resolveLocalBinOrExit(pkg, binName, fromDir) {
  try {
    return resolveLocalBin(pkg, binName, fromDir);
  } catch (err) {
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

/**
 * Spawn a resolved bin script with this Node. Options are passed straight to
 * child_process.spawn, so callers keep control of cwd — which still matters for
 * tools that discover their own config from the working directory.
 *
 * @param {string} binPath absolute path from {@link resolveLocalBin}
 * @param {string[]} args arguments for the tool itself
 * @param {import('node:child_process').SpawnOptions} [options]
 */
export function spawnLocalBin(binPath, args, options) {
  return spawn(process.execPath, [binPath, ...args], options);
}
