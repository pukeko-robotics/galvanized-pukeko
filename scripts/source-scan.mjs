// Shared primitives for the guards that check what a source file DOES rather than what a module
// exports.
//
// Two guards here scan launcher sources, and for the same reason: what matters is not reachable by
// importing the module under test. A launcher that stopped calling the config resolver, or stopped
// taking the GPU lock, leaves every module-level check green while restoring the exact bug the
// check exists to prevent. Only reading the file notices.
//
// A THIRD KIND OF SCAN LIVES HERE NOW, and it needs something the first two did not. Searching for
// a token only needs the prose removed; reading a file's STRUCTURE — how deeply a key is nested,
// where a statement ends — needs the string literals removed too, and needs the result to line up
// with the original so a match can be read back out of it. `blankCommentsAndStrings` is that, and
// `stripComments` stays exactly as it was for the two callers that only want the prose gone.

/**
 * Blank out comments so a scan reads code, not prose.
 *
 * These launchers explain in their comments which file pins what, and those sentences quote module
 * names and function names the way ordinary prose does. Scanning raw source therefore reports a
 * launcher that is wired correctly — and, worse in the other direction, reports one that is NOT
 * wired as though it were, because a comment mentioning the call satisfies a search for the call.
 * A guard that cries wolf on correct code gets its finding suppressed rather than read; a guard
 * satisfied by a comment is no guard at all.
 *
 * Tracks string and template literals so a `//` inside one is not mistaken for a comment.
 */
export function stripComments(source) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      if (c === '\\') {
        out += c + (next ?? '');
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * A copy of `source` in which every comment, and the BODY of every string and template literal,
 * has been replaced by spaces — newlines and total length preserved, so an index into the result
 * is the same index into the original.
 *
 * WHY LENGTH-PRESERVING, which is the only thing that makes this different from `stripComments`
 * above. A structural scan asks questions an index answers: how deeply is this key nested, where
 * does this statement end, what is the title argument of this call. Doing that on a shortened
 * copy means every answer has to be mapped back, and a mapping that is one character out is wrong
 * in a way no run reports. Here the blanked text is used to FIND things and the original is sliced
 * to READ them, with no translation in between.
 *
 * WHY STRINGS AND NOT ONLY COMMENTS. A string body can hold the very thing a scan is looking for.
 * These specs send prose to a model, so a prompt may quote an assertion; a config may carry a brace
 * inside a note. Read as code, the first budgets for text nothing runs and the second ends its
 * enclosing object early, putting every key after it at the wrong depth. Both are pinned by fixture
 * in `scripts/check-first-attempt-rate.mjs` — said that way because neither is hypothetical there
 * and neither is present in this repository's own sources today, which is exactly the state in
 * which a precaution quietly stops working. The quote characters themselves are KEPT, so a scan can
 * still see that an argument is a string literal and slice the original for its contents.
 *
 * The whole interpolation, `${` and `}` included, is blanked rather than treated as code. Nothing
 * this scans looks for anything inside one, and blanking it is what keeps the braces balanced.
 *
 * KNOWN LIMIT, shared with `stripComments` and stated rather than implied: a regular-expression
 * literal is not lexed. A quote or a `//` inside one — `/it's/`, `/a\/\/b/` — is read as the start
 * of a string or a comment and everything after it on that line is blanked. No source in this
 * repository contains one, and a caller that starts scanning files which might should fix this
 * rather than work around it.
 */
export function blankCommentsAndStrings(source) {
  const out = Array.from(source);
  const n = source.length;

  function blankAt(k) {
    if (k < n && out[k] !== '\n') out[k] = ' ';
  }

  /** Blank from just after `${` up to and including the matching `}`; returns the index after it. */
  function blankInterpolation(start) {
    let depth = 1;
    let i = start;
    while (i < n) {
      const c = source[i];
      if (c === "'" || c === '"' || c === '`') {
        const end = blankString(i);
        for (let k = i; k < end; k += 1) blankAt(k);
        i = end;
        continue;
      }
      if (c === '{') depth += 1;
      blankAt(i);
      i += 1;
      if (c === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return i;
  }

  /** Blank the body of the literal opening at `start`; returns the index after its closing quote. */
  function blankString(start) {
    const quote = source[start];
    let i = start + 1;
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        blankAt(i);
        blankAt(i + 1);
        i += 2;
        continue;
      }
      if (c === quote) return i + 1;
      if (quote === '`' && c === '$' && source[i + 1] === '{') {
        blankAt(i);
        blankAt(i + 1);
        i = blankInterpolation(i + 2);
        continue;
      }
      blankAt(i);
      i += 1;
    }
    return i;
  }

  let i = 0;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        blankAt(i);
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      blankAt(i);
      blankAt(i + 1);
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        blankAt(i);
        i += 1;
      }
      blankAt(i);
      blankAt(i + 1);
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i = blankString(i);
      continue;
    }
    i += 1;
  }

  return out.join('');
}
