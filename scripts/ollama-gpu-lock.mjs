// OPS-118 — machine-local mutual exclusion for real-LLM runs that drive a local Ollama daemon.
//
// THE PROBLEM. A local Ollama daemon is backed by one non-partitionable GPU: one card holds one
// model at a time. Two processes driving it at once thrash VRAM and time out in ways that look
// like model-capability failures rather than contention, which is how they eat an afternoon.
// Ports are allocated per worktree, so parallel lanes no longer collide there; the GPU is the
// last shared global on the box. Gaunt Sloth's integration harness already serialises its own
// ollama runs behind a lock. This repository's `it-gth-ag-ui.js` did not take part, so a run here
// and a run there could overlap invisibly and every timing-shaped measurement taken from this
// harness carried an unquantified caveat.
//
// WHY A SECOND IMPLEMENTATION AND NOT A SHARED MODULE.
//
// The mutual exclusion lives in the FILESYSTEM, not in shared code. Two independent
// implementations that compute the same path and speak the same on-disk protocol exclude each
// other exactly as well as two callers of one module would. So the contract between them is:
//
//   1. the lock PATH — see `defaultLockPath` and `resolveOllamaHost` below, and
//   2. the lockfile CONTENT — a JSON object with `pid` and `at` (epoch millis).
//
// Both are pinned by `check-ollama-gpu-lock.mjs`, which is the thing that actually keeps the two
// copies in step. Changing either one here without changing it in Gaunt Sloth's
// `packages/app/integration-tests/support/ollamaLock.mjs` silently stops the two serialising —
// they would take different files and both proceed. Nothing would fail; the runs would just
// collide again. That guard exists because a silent un-pairing is the failure mode of this design.
//
// The alternatives, and why they were rejected:
//
//   - IMPORT IT FROM GAUNT SLOTH. It is the obvious answer and it does not work. The helper lives
//     under `packages/app/integration-tests/support/`, is not exported from any published package,
//     and this repository consumes `@gaunt-sloth/agent` from the npm registry. There is nothing to
//     import until that helper is made a published export by its own repository and released —
//     neither of which is ours to do here. If that ever happens, this file should be deleted in
//     favour of the import; the contract above is what makes that swap safe rather than risky.
//   - REACH INTO A SIBLING CHECKOUT by relative path. This repository is standalone and public: it
//     is cloned on its own, and its CI has no Gaunt Sloth checkout anywhere. A relative path out of
//     the repository root would encode one developer's directory layout into a file everyone else
//     runs, and would fail for every one of them.
//   - VENDOR A COPY into `node_modules` or a git submodule. More machinery than a 60-line stdlib
//     lock, and it still needs the same path-and-format agreement to be worth anything — the copy
//     would not be the contract, the path would.
//   - DO NOTHING. Defensible only if the two could not overlap. They can: this harness boots a
//     real AG-UI server against a real daemon, and takes minutes.
//
// Plain ESM, Node stdlib only, no dependencies — the same constraint the other copy has, because
// the harnesses on both sides are run by bare `node`.
//
// WHAT THIS LOCK IS NOT FOR. It is sized for BOUNDED runs — a test harness that starts, drives the
// model and exits. `staleMs` reclaims a lock whose holder is still alive once the hold exceeds it,
// which is correct for a run that cannot legitimately last that long and wrong for anything open-
// ended. So the interactive launchers (`start-gth-ag-ui.js` and the example's `start.js`)
// deliberately do NOT take it: a developer's session lasts as long as they keep it open, so it
// would either be robbed mid-session or wedge every bounded run behind a human's lunch break.
// Serialising interactive sessions would need a heartbeat-refreshed lock, which is a different
// design and not one this needs.

import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The default daemon address, used when `OLLAMA_HOST` says nothing. */
export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';

/**
 * The `llm.type` values that contend for the local GPU.
 *
 * A run is locked when the Gaunt Sloth configuration it is about to launch declares one of these.
 * Anything else — a hosted provider reached over the network — has no GPU to contend for, and
 * locking it would serialise an OpenAI run behind an Ollama one for nothing.
 */
export const LOCAL_GPU_PROVIDERS = ['ollama'];

/**
 * The daemon address this run will contend for, as a lock KEY.
 *
 * This formula is copied verbatim from Gaunt Sloth's `it.js`, which computes the host it hands to
 * `defaultLockPath`. That is deliberate and it is the reason the two serialise: the key is a
 * rendezvous token, not a URL anyone dials, so what matters is that both sides derive the same
 * STRING from the same environment — not that the string is the most correct spelling of the
 * address.
 *
 * Which is why this does NOT normalise a bare `host:port` into a URL the way `@gaunt-sloth/core`'s
 * provider does when it builds the client. Normalising here would be the more principled-looking
 * choice and would BREAK the rendezvous for anyone whose `OLLAMA_HOST` is a bare `host:port`: this
 * side would key on `http://host:port` while `it.js` keyed on `host:port`, two different files,
 * two runs proceeding at once against one GPU. If that divergence is ever worth closing, it has to
 * be closed on both sides at once — it is a property of the pair, not of either copy.
 */
export function resolveOllamaHost(env = process.env) {
  return (env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST).replace(/\/+$/, '');
}

/**
 * The environment variable the Koog example's JVM server reads to find its Ollama daemon.
 *
 * It is NOT `OLLAMA_HOST`. `KoogAgent.kt` reads `OLLAMA_BASE_URL` and hands it straight to
 * `OllamaClient(baseUrl = …)`, so the two surfaces in this repository name the same daemon with
 * two different variables. That is why the resolution below reads both.
 */
export const KOOG_OLLAMA_URL_ENV_VAR = 'OLLAMA_BASE_URL';

/**
 * OPS-119 — the daemon address a Koog run will DIAL, which is also the string it keys its lock on.
 *
 * WHY THIS EXISTS SEPARATELY FROM `resolveOllamaHost`. The Koog server is a JVM process, and its
 * committed default daemon address is `http://localhost:11434` while every JavaScript participant
 * here defaults to `http://127.0.0.1:11434`. Those are one daemon and two strings, so they hash to
 * two lockfiles and would not exclude each other. They also read different variables, so pointing
 * one at another machine does not move the other.
 *
 * WHAT MAKES THE KEY CORRECT, AND IT IS NOT A NORMALISER. `it-koog.js` calls this ONCE, locks on
 * the result, and injects that same result into the JVM's environment as `OLLAMA_BASE_URL`. The
 * address that was locked and the address that is dialled are therefore the SAME STRING by
 * construction — one derivation, not two formulas that have to agree. A canonicaliser would be the
 * more principled-looking choice and would buy less: it would put a second hand-maintained
 * agreement (lowercasing, port defaulting, loopback collapsing, IPv6) in two repositories and
 * would still leave the JVM free to resolve its own address from its own variable.
 *
 * PRECEDENCE, and it is a behaviour statement rather than an implementation detail:
 *
 *   1. `OLLAMA_BASE_URL` — the variable the Koog example documents in its README, so a developer
 *      who set it meant the Koog server specifically.
 *   2. `OLLAMA_HOST` — the variable every JavaScript participant here and in Gaunt Sloth already
 *      keys on. Honouring it is what makes `OLLAMA_HOST=…` move this harness's daemon AND its lock
 *      to the same place as a `gth` run, instead of leaving Koog behind on loopback.
 *   3. {@link DEFAULT_OLLAMA_HOST} — deliberately the JavaScript default, NOT `KoogAgent.kt`'s
 *      `http://localhost:11434`. Defaulting to the Kotlin spelling would reinstate the split this
 *      function exists to close; injecting the JavaScript one is what puts an unconfigured Koog
 *      run on the same lockfile as an unconfigured `gth` run.
 *
 * Setting both variables to different daemons means the injected one wins and the Koog server
 * never sees `OLLAMA_HOST`. That is the documented knob taking precedence, not a lock defect.
 *
 * NO SCHEME IS SYNTHESISED, deliberately. A bare `host:port` in `OLLAMA_HOST` is passed through
 * exactly as given, for the reason spelled out on `resolveOllamaHost` above: prefixing `http://`
 * here would key this harness on a different string from Gaunt Sloth's `it.js`, and two runs would
 * proceed at once against one card. The cost is that Koog would be handed a base URL its HTTP
 * client may refuse — which fails loudly in the harness log, whereas a broken rendezvous fails
 * silently. Loud is the right side of that trade for a lock.
 *
 * Trailing slashes are stripped, matching `resolveOllamaHost`, so `…:11434` and `…:11434/` are one
 * lock rather than two.
 */
export function resolveKoogOllamaBaseUrl(env = process.env) {
  const configured = env[KOOG_OLLAMA_URL_ENV_VAR] || env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
  return configured.replace(/\/+$/, '');
}

/**
 * Does `provider` name a run that will drive the local GPU?
 *
 * Lowercased before the comparison because `KoogAgent.kt` routes on
 * `System.getenv("LLM_PROVIDER")?.lowercase()`. A raw `includes` would let `LLM_PROVIDER=Ollama`
 * start a real Ollama run that took no lock — the gate and the thing it gates must agree on case,
 * or the gate is open for exactly the spellings nobody tests.
 */
export function isLocalGpuProvider(provider) {
  return LOCAL_GPU_PROVIDERS.includes(String(provider ?? '').toLowerCase());
}

/**
 * Path of the lockfile for a given daemon address.
 *
 * Keyed by host so two genuinely different daemons do not block each other, while everything
 * hitting the same one serialises. The digest is only a filename-safe encoding of the host — not a
 * security property — and it must stay byte-identical to the other implementation's, digest and
 * truncation and prefix alike. `check-ollama-gpu-lock.mjs` pins the results for known hosts.
 */
export function defaultLockPath(ollamaHost) {
  const key = createHash('sha1').update(String(ollamaHost)).digest('hex').slice(0, 12);
  return join(tmpdir(), `gth-it-ollama-${key}.lock`);
}

/**
 * Is the process recorded in a lockfile still running?
 *
 * `process.kill(pid, 0)` sends no signal; it probes for the process and reports through errno. A
 * holder that provably no longer exists is stale NOW, whatever its age — without this, a crashed
 * or SIGTERMed run wedges every subsequent run for the whole of `staleMs`.
 *
 * Every uncertain case answers "alive", so the time-based rule stays the backstop and a LIVE
 * holder is never stolen on this path:
 *   - EPERM (the process exists but is not ours) → alive.
 *   - a missing, malformed or non-integer pid → we know nothing → treat as held.
 *   - pid reuse (an unrelated process now owns the number) → alive → falls back to `staleMs`.
 */
export function isHolderAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
}

/**
 * Create a lock handle for `lockPath`.
 *
 * `staleMs` and `waitMs` are large on purpose, and they are two halves of one rule: a legitimate
 * run holds the lock for its whole duration — booting a server, loading a model and driving a
 * browser through it, which is minutes. `staleMs` must EXCEED the longest legitimate hold, or a
 * live holder gets robbed; `waitMs` must let a waiter outlast one, or a second run dies rather
 * than queueing. Both match the other implementation's defaults, which keeps the two copies'
 * judgements about "how long is too long" the same — a shorter `staleMs` on this side would let
 * this run steal a Gaunt Sloth run's lock out from under it.
 *
 * There is no heartbeat refresh. See the note at the top of this file on why this lock is for
 * bounded runs only.
 */
export function createOllamaLock({
  lockPath,
  staleMs = 30 * 60_000,
  waitMs = 30 * 60_000,
  log = console.log,
} = {}) {
  async function acquire() {
    const deadline = Date.now() + waitMs;
    let lastNotice = 0;
    for (;;) {
      try {
        // `wx` is the whole mutual exclusion: an exclusive create either wins or raises EEXIST,
        // with no window between the check and the write. The CONTENT is the other half of the
        // contract with the other implementation — it reads these two fields back.
        writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }), {
          flag: 'wx',
        });
        let released = false;
        return () => {
          // The release function MUST be synchronous: it is called from an 'exit' hook, where
          // nothing asynchronous can still run.
          if (released) return;
          released = true;
          try {
            unlinkSync(lockPath);
          } catch {
            /* already gone */
          }
        };
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        // Held by someone. Steal only from a holder that is clearly finished — provably gone, or
        // past the time-based backstop.
        try {
          const info = JSON.parse(readFileSync(lockPath, 'utf8'));
          if (!isHolderAlive(info.pid)) {
            log(`==> reclaiming ollama GPU lock from dead pid ${info.pid} (lock ${lockPath})`);
            unlinkSync(lockPath);
            continue;
          }
          if (Date.now() - info.at > staleMs) {
            log(`==> reclaiming ollama GPU lock from stale holder pid ${info.pid} (${lockPath})`);
            unlinkSync(lockPath);
            continue;
          }
          if (Date.now() - lastNotice > 30_000) {
            log(
              `==> waiting for ollama GPU lock held by pid ${info.pid} (${Math.round(
                (Date.now() - info.at) / 1000
              )}s); lock ${lockPath}`
            );
            lastNotice = Date.now();
          }
        } catch {
          /* mid-write or malformed — we cannot tell, so treat it as held and wait */
        }
        if (Date.now() > deadline) {
          throw new Error(
            `ollama GPU lock still held after ${Math.round(waitMs / 1000)}s (lock ${lockPath}); ` +
              `another run is driving the same daemon — retry shortly, or delete a stale lock file.`,
            { cause: e }
          );
        }
        // Jittered, so two waiters that arrived together do not retry in lockstep forever.
        await sleep(200 + Math.floor(Math.random() * 200));
      }
    }
  }
  return { acquire, lockPath };
}
