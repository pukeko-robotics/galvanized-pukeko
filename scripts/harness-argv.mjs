// How the `it-*.js` harnesses read the arguments they forward to Playwright — and why they care
// about a leading `--`.
//
// THE DEFECT (QA-34). `pnpm run it-gth-ag-ui -- --list` used to run the entire suite and report
// success. Three hops, each individually reasonable:
//
//   1. pnpm forwards the `--` itself into the script. Measured on pnpm 11.3.0: a script printing
//      its own argv for `pnpm run probe -- --grep x` prints ["--","--grep","x"], where npm would
//      have printed ["--grep","x"]. The separator is not consumed by the package manager here.
//   2. The harness appends its argv to the Playwright invocation, so Playwright is spawned as
//      `test <specs> -- --list`.
//   3. Playwright treats `--` as end-of-options and DISCARDS everything after it. Measured:
//      `test --list <the three specs> --grep capture_image` lists 1 test; the same command with a
//      `--` before the `--grep` lists all 7, with no error, no warning and exit 0.
//
// So the caller's arguments were consumed by a convention two layers from where they were typed.
// What makes it worth a guard is not that the flags were ignored — it is that the WRONG THING RAN
// AND REPORTED SUCCESS. The first sweep that hit this ran the whole suite for several minutes
// believing it was running one instrumented cell, and every number it produced described a run
// nobody asked for.
//
// THE DECISION: STRIP, NOT REJECT. The node this comes from left the choice open between
// rejecting a stray `--` outright and stripping it. This is the strip side, for three reasons a
// later reader should be able to weigh rather than re-derive:
//
//   - `pnpm run <script> -- <args>` is THE documented convention for forwarding arguments, and npm
//     itself consumes the separator. A caller typing it is following the instructions, not making
//     a mistake; the quirk belongs to one package manager, and compensating for it here is cheaper
//     than teaching every caller which manager ate which token.
//   - Nothing that works today breaks. A repository-wide search found no invocation of any of
//     these harnesses that passes `--`, so there is no caller relying on the old "runs everything"
//     behaviour — the behaviour change is confined to invocations that were already broken.
//   - It makes a sentence we already ship true rather than forcing us to reverse it: `it-koog.js`
//     documented `node it-koog.js [-- playwright args]` while that exact spelling discarded the
//     arguments. Reject would have meant editing the usage line to forbid what it recommended.
//
// The cost of strip, stated plainly: an invocation that passed `--` and appeared to work now runs
// something narrower. That IS the intent, and it is still a behaviour change, which is why it is
// announced rather than done quietly — see below.
//
// WHY ONLY ONE, AND ONLY LEADING. Exactly one leading `--` is removed, because exactly one is what
// the package manager inserts. A second one can only have come from the caller, so
// `pnpm run it-koog -- -- --foo` still hands Playwright a real `--`: a caller who genuinely wants
// end-of-options semantics keeps a way to ask for them. A `--` anywhere but the front is left
// alone for the same reason.
//
// WHY IT IS ANNOUNCED. The defect here was silence, so the fix must not be silent either. A
// harness that quietly rewrote its own arguments would be a smaller version of the same problem —
// the next person comparing two runs would have no way to see that one of them had been adjusted.
// One line on stdout naming what was dropped and what is being forwarded costs nothing and leaves
// the evidence in the log.

/** The end-of-options token: what pnpm forwards and what Playwright stops reading at. */
export const ARG_SEPARATOR = '--';

/**
 * The arguments a harness should hand to Playwright, given its own `process.argv.slice(2)`.
 *
 * @param {string[]} argv the harness's own arguments, in order
 * @returns {{ args: string[], separatorStripped: boolean }} `args` to forward, and whether a
 *   leading separator was removed to get them — the caller prints {@link separatorNotice} when it
 *   was.
 */
export function playwrightArgsFrom(argv) {
  const separatorStripped = argv[0] === ARG_SEPARATOR;
  return { args: separatorStripped ? argv.slice(1) : argv, separatorStripped };
}

/**
 * The line a harness prints when it removed a separator, naming both halves of what happened.
 *
 * @param {string[]} args the arguments actually being forwarded, after the strip
 * @returns {string}
 */
export function separatorNotice(args) {
  return (
    `note: dropped a leading "${ARG_SEPARATOR}" from this run's arguments. pnpm forwards that ` +
    `token into the script, and Playwright would read it as end-of-options and silently discard ` +
    `everything after it. Forwarding to Playwright: ` +
    `${args.length > 0 ? args.join(' ') : '(nothing)'}`
  );
}
