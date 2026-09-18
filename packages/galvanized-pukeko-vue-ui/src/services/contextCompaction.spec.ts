import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  AGUI_CONTEXT_COMPACTED_EVENT,
  CONTEXT_FOLD_FALLBACK_TITLE,
  describeContextFold,
  readCustomEvent,
  type ContextFold,
} from './contextCompaction'

/**
 * RC-68 — the shared reading of an AG-UI `CUSTOM` event.
 *
 * The fixtures are the shape gaunt-sloth's `apiAgUiModule` actually writes
 * (`AgUiContextCompactedValue` = `{ cause, compaction, notice }`, with
 * `compaction` a `ConversationCompaction`), read off that source rather than
 * guessed — and confirmed end-to-end against `@ag-ui/client` 0.0.59, which
 * delivers `value` to `onCustomEvent` untouched.
 *
 * ## Why the absence cases assert own-property presence
 *
 * `expect(fold.lines).toBeUndefined()` passes both when the field is absent AND
 * when it was written as `lines: undefined`. Those are different objects: the
 * second one spreads, serialises and `Object.keys`-enumerates differently, and a
 * renderer keyed on `'lines' in fold` behaves differently for each. The property
 * this module promises is ABSENCE, so the assertion has to be able to see it —
 * `hasOwnProperty` plus `in`, each paired with a positive assertion so a rename
 * of the field cannot make the absence check pass by vacuum.
 */

const COMPACTION = {
  changed: true,
  removedCount: 12,
  keptCount: 4,
  keepRecent: 4,
  summaryText: 'Earlier conversation summarised.',
  before: { messages: 16, characters: 240000 },
  after: { messages: 5, characters: 18000 },
}

const NOTICE = {
  title: 'Context overflowed — conversation compacted',
  lines: [
    'The provider rejected this turn for size, so 12 older messages were folded into a summary.',
    'Nothing already on screen was undone.',
  ],
  tone: 'warn' as const,
}

const FULL_VALUE = { cause: 'context_overflow', compaction: COMPACTION, notice: NOTICE }

/** Both halves of "this property is not on the object", so neither can stand alone. */
function expectAbsentOwnProperty(fold: ContextFold, key: 'lines' | 'compaction'): void {
  expect(Object.prototype.hasOwnProperty.call(fold, key)).toBe(false)
  expect(key in fold).toBe(false)
}

function expectPresentOwnProperty(fold: ContextFold, key: 'lines' | 'compaction'): void {
  expect(Object.prototype.hasOwnProperty.call(fold, key)).toBe(true)
  expect(key in fold).toBe(true)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('describeContextFold — the server’s own words, preferred over ours', () => {
  it('takes title, lines and tone from value.notice when the server sent one', () => {
    const fold = describeContextFold(FULL_VALUE)

    expect(fold.title).toBe('Context overflowed — conversation compacted')
    expect(fold.lines).toEqual(NOTICE.lines)
    expect(fold.tone).toBe('warn')
    // And the numbers ride along, so a surface can show either.
    expect(fold.compaction).toEqual(COMPACTION)
  })

  it('carries the compaction numbers field-for-field, not a reshaped summary of them', () => {
    const fold = describeContextFold(FULL_VALUE)

    expect(fold.compaction).toMatchObject({
      removedCount: 12,
      keptCount: 4,
      keepRecent: 4,
      before: { messages: 16, characters: 240000 },
      after: { messages: 5, characters: 18000 },
    })
  })

  it('OMITS lines — rather than writing undefined — when the notice is missing', () => {
    const fold = describeContextFold({ cause: 'context_overflow', compaction: COMPACTION })

    // Positive half: the marker is still a usable marker.
    expect(fold.title).toBe(CONTEXT_FOLD_FALLBACK_TITLE)
    expect(fold.compaction).toEqual(COMPACTION)
    expectPresentOwnProperty(fold, 'compaction')
    // Absence half: `lines` is not a property of this object at all.
    expectAbsentOwnProperty(fold, 'lines')
  })

  it('OMITS compaction — rather than writing undefined — when the numbers are missing', () => {
    const fold = describeContextFold({ cause: 'context_overflow', notice: NOTICE })

    expect(fold.title).toBe(NOTICE.title)
    expect(fold.lines).toEqual(NOTICE.lines)
    expectPresentOwnProperty(fold, 'lines')
    expectAbsentOwnProperty(fold, 'compaction')
  })

  it('OMITS compaction when the numbers are present but not the shape we render', () => {
    // `before`/`after` are the fields the marker prints; without them the
    // numbers cannot be shown, and half a compaction must not be invented.
    const fold = describeContextFold({
      compaction: { removedCount: 3, keptCount: 1, changed: true },
    })

    expect(fold.title).toBe(CONTEXT_FOLD_FALLBACK_TITLE)
    expectAbsentOwnProperty(fold, 'compaction')
  })

  it('OMITS lines when the notice carried none that can be printed', () => {
    const fold = describeContextFold({
      compaction: COMPACTION,
      notice: { title: 'Folded', lines: ['', 42, null] },
    })

    expect(fold.title).toBe('Folded')
    expectAbsentOwnProperty(fold, 'lines')
    expectPresentOwnProperty(fold, 'compaction')
  })

  it.each([
    ['null', null],
    ['a string', 'context was compacted'],
    ['a number', 7],
    ['undefined', undefined],
  ])('still produces a marker when value is %s — the fold is the headline', (_label, value) => {
    const fold = describeContextFold(value)

    expect(fold.title).toBe(CONTEXT_FOLD_FALLBACK_TITLE)
    expect(fold.tone).toBe('warn')
    expectAbsentOwnProperty(fold, 'lines')
    expectAbsentOwnProperty(fold, 'compaction')
  })

  it('honours an info tone and rejects a tone it does not know', () => {
    expect(describeContextFold({ notice: { title: 'x', tone: 'info' } }).tone).toBe('info')
    expect(describeContextFold({ notice: { title: 'x', tone: 'chartreuse' } }).tone).toBe('warn')
  })
})

describe('readCustomEvent — the known name, and the decision about every other one', () => {
  it('reads a context_compacted event into a fold and says nothing on the console', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    const fold = readCustomEvent(
      { name: AGUI_CONTEXT_COMPACTED_EVENT, value: FULL_VALUE },
      { surface: 'TestSurface', seen: new Set() },
    )

    expect(fold?.title).toBe(NOTICE.title)
    expect(fold?.lines).toEqual(NOTICE.lines)
    expect(info).not.toHaveBeenCalled()
  })

  it('pins the event name — a rename on either side must not pass silently', () => {
    expect(AGUI_CONTEXT_COMPACTED_EVENT).toBe('context_compacted')
    // The literal, not the constant: a spec that only compares the constant to
    // itself cannot see the rename it exists to catch.
    const fold = readCustomEvent(
      { name: 'context_compacted', value: FULL_VALUE },
      { surface: 'TestSurface', seen: new Set() },
    )
    expect(fold).not.toBeNull()
  })

  it('ignores an unknown name, returns no fold, and LOGS it once', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const seen = new Set<string>()

    expect(readCustomEvent({ name: 'some_future_event', value: { a: 1 } }, { surface: 'S', seen }))
      .toBeNull()
    expect(readCustomEvent({ name: 'some_future_event', value: { a: 2 } }, { surface: 'S', seen }))
      .toBeNull()
    expect(readCustomEvent({ name: 'some_future_event' }, { surface: 'S', seen })).toBeNull()

    // Once, not three times — a server streaming a custom event per token must
    // not flood the console — but ONCE, not never: a renderer that drops an
    // event without a trace is what made RC-47 take five weeks.
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      '[S] Ignoring unhandled AG-UI CUSTOM event:',
      'some_future_event',
      expect.stringContaining('not reported'),
    )
  })

  it('reports each distinct unknown name separately', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const seen = new Set<string>()

    readCustomEvent({ name: 'alpha' }, { surface: 'S', seen })
    readCustomEvent({ name: 'beta' }, { surface: 'S', seen })
    readCustomEvent({ name: 'alpha' }, { surface: 'S', seen })

    expect(info).toHaveBeenCalledTimes(2)
  })

  it('never lets the unknown-name dedupe swallow a real fold', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const seen = new Set<string>()

    readCustomEvent({ name: 'noise' }, { surface: 'S', seen })
    const first = readCustomEvent(
      { name: AGUI_CONTEXT_COMPACTED_EVENT, value: FULL_VALUE },
      { surface: 'S', seen },
    )
    readCustomEvent({ name: 'noise' }, { surface: 'S', seen })
    const second = readCustomEvent(
      { name: AGUI_CONTEXT_COMPACTED_EVENT, value: FULL_VALUE },
      { surface: 'S', seen },
    )

    // The known name passes the dedupe untouched, every time.
    expect(first?.title).toBe(NOTICE.title)
    expect(second?.title).toBe(NOTICE.title)
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('handles a nameless or absent event without throwing', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const seen = new Set<string>()

    expect(readCustomEvent(undefined, { surface: 'S', seen })).toBeNull()
    expect(readCustomEvent({ value: 1 }, { surface: 'S', seen })).toBeNull()

    expect(info).toHaveBeenCalledTimes(1)
  })
})
