// Which Gaunt Sloth configuration the AG-UI launchers hand to `gaunt-sloth-api --config`.
//
// The example used to pin one file, and that file pinned an OpenAI model, so the whole
// documented flow needed an OPENAI_API_KEY before it would answer anything. The provider is
// now read from the environment: set GTH_LLM_PROVIDER to pick one of the configurations the
// example ships, or leave it unset and get the documented fallback.
//
// WHY SELECTION AND NOT INTERPOLATION. A Gaunt Sloth JSON config has no environment
// interpolation, so `"type": "${GTH_LLM_PROVIDER}"` is not a thing that resolves. The other
// option is a `.gsloth.config.js` module config whose `configure()` reads `process.env`.
//
// That route carried two silent failure modes up to and including `2.0.0-beta.7`, and they are
// history rather than a live reason to avoid it — CFG-71 fixed both in Gaunt Sloth, and the
// version pinned here carries the fix:
//
//   - A returned raw `{ type, model }` spec was never provider-routed, so it arrived as a plain
//     object with no `invoke`. The module branch now routes it the way the JSON branch does.
//   - A returned built instance was flattened into a plain object — prototype gone, `invoke`
//     gone — once the developer had a `~/.gsloth/.gsloth.config.json`, because the global layer
//     is deep-merged UNDER the project layer. The merge now recurses into plain objects only and
//     hands an instance over whole.
//
// This example still selects between declarative JSON files, for the two reasons that never
// depended on those defects: it needs no `@gaunt-sloth/core` dependency here, and it leaves two
// files a reviewer can read and diff. That is the reason — simplicity, not an inability to
// express it any other way.
//
// Adding a provider is dropping a `.gsloth.config.<provider>.json` next to the others — the
// resolution below is by convention, so nothing here needs editing. It does need that provider's
// LangChain package to be installed, because `@gaunt-sloth/core` imports it on demand and
// declares them all as peers; the repository ships the two it depends on.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The environment variable that names the provider. */
export const PROVIDER_ENV_VAR = 'GTH_LLM_PROVIDER';

/**
 * The provider used when GTH_LLM_PROVIDER is unset — the documented fallback, and the historical
 * behaviour of this example. It needs an OPENAI_API_KEY to answer a prompt; `ollama` is the
 * shipped provider that needs no key at all.
 */
export const DEFAULT_PROVIDER = 'openai';

/**
 * The provider whose configuration lives in the un-suffixed `.gsloth.config.json`.
 *
 * Deliberately a SEPARATE constant from {@link DEFAULT_PROVIDER}, though they name the same
 * provider today. One is "which provider do we fall back to", the other is "which provider owns
 * the file name `gth` discovers on its own". Deriving the file name from the fallback instead
 * couples them, and then changing the fallback silently renames both configurations: the new
 * fallback would be looked up in `.gsloth.config.json` (which holds the other provider's
 * settings) and the old one would become unreachable. Keeping them apart makes changing the
 * fallback the one-line edit it looks like.
 */
const UNSUFFIXED_PROVIDER = 'openai';

/** Example directory holding the configurations, relative to the repository root. */
export const AG_UI_EXAMPLE_DIR = 'examples/pukeko-gaunt-sloth-ag-ui';

/**
 * File name carrying a provider's configuration.
 *
 * The default provider keeps the plain `.gsloth.config.json` name rather than a suffixed one:
 * it is the file `gth` itself discovers in a directory, and the name every existing reference to
 * this example already uses.
 */
export function configFileNameFor(provider) {
  return provider === UNSUFFIXED_PROVIDER
    ? '.gsloth.config.json'
    : `.gsloth.config.${provider}.json`;
}

/**
 * Shape of a provider name, applied to BOTH the name read from the environment and the names
 * discovered on disk.
 *
 * The two must use one pattern. Discovering with a strict pattern while interpolating the
 * environment variable raw is the asymmetry that lets `GTH_LLM_PROVIDER=ollama/../../package`
 * resolve to a file outside the example directory: the listing would never show such a name, but
 * the resolution would happily reach it. This is the developer's own environment rather than a
 * security boundary, so the point is that the decision path and the display path agree.
 */
const PROVIDER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Providers this example ships a configuration for, sorted, derived from what is on disk. */
export function listAvailableProviders(configDir) {
  const providers = new Set();
  for (const entry of readdirSync(configDir)) {
    if (entry === '.gsloth.config.json') {
      providers.add(UNSUFFIXED_PROVIDER);
      continue;
    }
    const match = /^\.gsloth\.config\.([A-Za-z0-9][A-Za-z0-9_-]*)\.json$/.exec(entry);
    if (match && PROVIDER_NAME_RE.test(match[1])) providers.add(match[1]);
  }
  return [...providers].sort();
}

/**
 * Resolve the configuration file for the provider named in `env`.
 *
 * Returns `{ provider, configPath, fromEnv, error }`. `error` is a ready-to-print string when the
 * named provider has no configuration file; the caller decides whether that ends the run. A
 * provider that was asked for and is not there is never silently replaced by the default — that
 * would boot a server against a model the caller did not choose and say nothing about it, which
 * is the same failure `--config` exists to prevent.
 */
export function resolveLlmConfig(configDir, env = process.env) {
  const requested = (env[PROVIDER_ENV_VAR] ?? '').trim();
  const fromEnv = requested.length > 0;
  const provider = fromEnv ? requested : DEFAULT_PROVIDER;

  if (!PROVIDER_NAME_RE.test(provider)) {
    return {
      provider,
      configPath: undefined,
      fromEnv,
      error:
        `${PROVIDER_ENV_VAR}="${provider}" is not a valid provider name.\n` +
        `Expected letters, digits, "_" or "-", starting with a letter or digit.\n` +
        `Available: ${listAvailableProviders(configDir).join(', ') || '(none)'}.`,
    };
  }

  const configPath = resolve(configDir, configFileNameFor(provider));

  if (!existsSync(configPath)) {
    const available = listAvailableProviders(configDir);
    return {
      provider,
      configPath,
      fromEnv,
      error:
        `${PROVIDER_ENV_VAR}="${provider}" names a provider this example has no configuration ` +
        `for.\nExpected ${configFileNameFor(provider)} in ${configDir}.\n` +
        `Available: ${available.join(', ') || '(none)'}.`,
    };
  }

  return { provider, configPath, fromEnv, error: undefined };
}

/**
 * Resolve as above, or print the reason and exit 1.
 *
 * Used by the launchers, which resolve this before starting anything: an unusable provider must
 * end the run while there is still nothing to tear down.
 */
export function resolveLlmConfigOrExit(configDir, env = process.env) {
  const resolved = resolveLlmConfig(configDir, env);
  if (resolved.error) {
    console.error(`\n${resolved.error}\n`);
    process.exit(1);
  }
  return resolved;
}

/**
 * The provider a resolved configuration file actually declares — its `llm.type`.
 *
 * OPS-118 needs this to decide whether a run is about to contend for the local GPU, and it asks
 * the FILE rather than trusting the file's name. `llm.type` is the field `gth` itself routes on,
 * so a run locks exactly when the model it is about to construct is a local one. The two agree
 * for everything this example ships — `check-llm-config.mjs` fails the build when a shipped
 * configuration's `llm.type` disagrees with the provider its name promises — but agreeing by
 * guard is a reason to prefer the authoritative field, not a reason to treat them as
 * interchangeable: a file dropped in by a developer is selectable the moment it exists, whereas
 * the guard only speaks when someone runs the test.
 *
 * Returns `undefined` for a file that cannot be read or parsed, or that declares no type. That
 * means no lock, which is the right way to fail here: such a config cannot start a server at all,
 * so there is no run to serialise, and refusing to launch over it would replace a clear error from
 * `gth` with a confusing one from a lock.
 */
export function declaredLlmType(configPath) {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'))?.llm?.type;
  } catch {
    return undefined;
  }
}
