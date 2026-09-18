/**
 * RC-68 — the AG-UI `CUSTOM` event that says the conversation was folded.
 *
 * gaunt-sloth's AG-UI server (EXT-174) emits one `CUSTOM` event named
 * `context_compacted` at the moment it folds the older conversation into a
 * summary and asks the model again, because the provider rejected the turn for
 * size. Its `value` is `{ cause, compaction, notice }`.
 *
 * This module is the ONE place both client paths decide what a `CUSTOM` event
 * means. The two paths differ in how they hold a stream — the bespoke
 * `chatService` accumulates parts from events, the CopilotKit surface projects a
 * message log — so they cannot share a container; they share this reading of the
 * event and {@link PkContextFoldNotice} to draw it.
 *
 * ## Why the marker is drawn inline, not as a banner
 *
 * The event's POSITION is the information: it marks the point in the turn where
 * history was cut. Everything streamed before it was produced with the full
 * conversation behind it; everything after it was produced with a summary
 * standing in for the older messages. A banner over the conversation would state
 * the fact and destroy the only thing that lets a user read the turn correctly —
 * which is why gaunt-sloth's own Ink TUI draws it between the work that preceded
 * the fold and the answer that follows it.
 */

/** The `name` of the AG-UI `CUSTOM` event gaunt-sloth emits when it folds history. */
export const AGUI_CONTEXT_COMPACTED_EVENT = 'context_compacted'

/** A conversation's size, as gaunt-sloth measures it. */
export interface ConversationSize {
  messages: number
  characters: number
}

/**
 * What the fold did, in the numbers `/compact` reports.
 *
 * Field-for-field the `ConversationCompaction` gaunt-sloth puts on the wire; a
 * structural copy rather than an import, because `@gaunt-sloth/agent` is a
 * server dependency of the repo root and not a dependency of this browser
 * library at all.
 */
export interface ConversationCompaction {
  changed: boolean
  removedCount: number
  keptCount: number
  keepRecent: number
  summaryText: string
  before: ConversationSize
  after: ConversationSize
}

/** The rendered notice the terminal, TUI and editor surfaces already show. */
export interface ContextCompactedNotice {
  title: string
  lines: string[]
  tone?: 'info' | 'warn'
}

/** The `value` of an {@link AGUI_CONTEXT_COMPACTED_EVENT} event. */
export interface ContextCompactedValue {
  cause: string
  compaction: ConversationCompaction
  notice: ContextCompactedNotice
}

/**
 * The render model for one fold marker — what {@link PkContextFoldNotice} draws.
 *
 * `lines` and `compaction` are OMITTED, not set to `undefined`, when the event
 * did not carry a usable one. A consumer (and a test) can then tell an absent
 * field from one explicitly written as undefined with `hasOwnProperty`, which
 * `=== undefined` cannot do.
 */
export interface ContextFold {
  title: string
  tone: 'info' | 'warn'
  /** The notice's own words. Omitted when the event carried no usable notice. */
  lines?: string[]
  /** The numbers the fold reports. Omitted when the event carried none. */
  compaction?: ConversationCompaction
}

/**
 * The title used when the event carried no usable `notice.title`.
 *
 * Deliberately a LABEL and not a sentence. The node's rule is to prefer
 * `value.notice` over writing prose here, so that the four surfaces do not drift
 * into four different sentences about one event; when the notice is missing we
 * fall back to the fold's numbers, which cannot drift, rather than inventing a
 * sentence that would.
 */
export const CONTEXT_FOLD_FALLBACK_TITLE = 'Conversation compacted'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readSize(value: unknown): ConversationSize | null {
  if (!isRecord(value)) return null
  const { messages, characters } = value
  if (typeof messages !== 'number' || typeof characters !== 'number') return null
  return { messages, characters }
}

/**
 * Read the `compaction` half of the event value, or null when it is not the
 * shape we know. Only the fields this library renders are required — a server
 * that adds fields stays readable, one that sends something else entirely
 * degrades to a marker with no numbers rather than throwing mid-stream.
 */
function readCompaction(value: unknown): ConversationCompaction | null {
  if (!isRecord(value)) return null
  const before = readSize(value.before)
  const after = readSize(value.after)
  if (!before || !after) return null
  if (typeof value.removedCount !== 'number' || typeof value.keptCount !== 'number') return null
  return {
    changed: typeof value.changed === 'boolean' ? value.changed : true,
    removedCount: value.removedCount,
    keptCount: value.keptCount,
    keepRecent: typeof value.keepRecent === 'number' ? value.keepRecent : value.keptCount,
    summaryText: typeof value.summaryText === 'string' ? value.summaryText : '',
    before,
    after,
  }
}

function readLines(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const lines = value.filter((line): line is string => typeof line === 'string' && line.length > 0)
  return lines.length > 0 ? lines : null
}

/**
 * Turn the `value` of a `context_compacted` event into a fold marker.
 *
 * Total by construction: a marker is ALWAYS produced, whatever the value holds.
 * `value` is `z.any()` on the AG-UI wire, so nothing guarantees its shape — and
 * the one fact this node exists to deliver is that a fold happened. A malformed
 * value must cost the detail, never the marker.
 */
export function describeContextFold(value: unknown): ContextFold {
  const record = isRecord(value) ? value : {}
  const notice = isRecord(record.notice) ? record.notice : {}
  const title =
    typeof notice.title === 'string' && notice.title.length > 0
      ? notice.title
      : CONTEXT_FOLD_FALLBACK_TITLE
  const tone = notice.tone === 'info' || notice.tone === 'warn' ? notice.tone : 'warn'

  const fold: ContextFold = { title, tone }

  // Assigned only when present, so an absent line set is an ABSENT property
  // rather than one written as undefined. See ContextFold.
  const lines = readLines(notice.lines)
  if (lines) fold.lines = lines

  const compaction = readCompaction(record.compaction)
  if (compaction) fold.compaction = compaction

  return fold
}

/**
 * Whether an unknown `CUSTOM` name has already been reported on this surface.
 * A `Set` per subscriber/component, never module-global, so one surface's log
 * cannot silence another's.
 */
export type SeenCustomNames = Set<string>

/**
 * Decide what a `CUSTOM` event means: a fold marker to render, or nothing.
 *
 * ## The decision this records: an unknown CUSTOM event is LOGGED, once per name
 *
 * AG-UI's `CUSTOM` is an open extension point — a server may send names this
 * client has never heard of, and the protocol's contract is that ignoring one
 * still renders a correct turn. So ignoring is right; ignoring *without a trace*
 * is not. RC-47 is the argument: reasoning parts were dropped by a renderer that
 * handled the roles it knew and silently discarded the rest, and it took five
 * weeks to find, because the events were plainly on the wire and nothing on the
 * client ever said it had thrown one away. This node is the same bug a second
 * time, for the same reason. One line in the console turns the next occurrence
 * from an archaeology problem into a reading.
 *
 * `console.info`, not `console.debug`: Chrome hides `debug` at its default log
 * level, so a debug line is the silent drop again wearing a different name.
 * `console.warn` overstates it — an unhandled extension event is the protocol
 * working as designed, not a fault.
 *
 * Deduped per name so a server that streams a custom event per token cannot
 * flood the console. The dedupe guards ONLY the unknown-name path: a known name
 * never passes through it, so no dedupe can ever swallow a real fold.
 */
export function readCustomEvent(
  event: { name?: string; value?: unknown } | undefined,
  options: { surface: string; seen: SeenCustomNames },
): ContextFold | null {
  const name = event?.name
  if (name === AGUI_CONTEXT_COMPACTED_EVENT) {
    return describeContextFold(event?.value)
  }
  const key = typeof name === 'string' ? name : String(name)
  if (!options.seen.has(key)) {
    options.seen.add(key)
    console.info(
      `[${options.surface}] Ignoring unhandled AG-UI CUSTOM event:`,
      key,
      '(further events of this name are not reported)',
    )
  }
  return null
}
