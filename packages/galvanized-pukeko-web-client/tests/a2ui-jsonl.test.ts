import { describe, it, expect } from 'vitest';
import { parseA2UIJsonl } from '@galvanized-pukeko/vue-ui';

// parseA2UIJsonl backs both the bespoke ChatInterface and the CopilotKit
// stock-UI A2UI bridge (P2b inc 2), so it must parse the concatenated-object
// `show_a2ui_surface` tool-result payload identically for both.
describe('parseA2UIJsonl', () => {
  it('parses a stream of concatenated top-level objects', () => {
    const payload =
      '{"beginRendering":{"surfaceId":"@default","root":"root"}}' +
      '{"surfaceUpdate":{"surfaceId":"@default","components":[]}}';
    const msgs = parseA2UIJsonl(payload);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].beginRendering?.surfaceId).toBe('@default');
    expect(msgs[1].surfaceUpdate?.surfaceId).toBe('@default');
  });

  it('handles nested braces without splitting mid-object', () => {
    const payload =
      '{"dataModelUpdate":{"surfaceId":"@default","contents":[{"key":"a","valueString":"x"}]}}';
    const msgs = parseA2UIJsonl(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].dataModelUpdate?.contents[0]).toEqual({ key: 'a', valueString: 'x' });
  });

  it('returns an empty array for an empty payload', () => {
    expect(parseA2UIJsonl('')).toEqual([]);
  });

  it('tolerates whitespace and newlines between objects', () => {
    const payload = '{"deleteSurface":{"surfaceId":"s1"}}\n  {"deleteSurface":{"surfaceId":"s2"}}';
    const msgs = parseA2UIJsonl(payload);
    expect(msgs.map((m) => m.deleteSurface?.surfaceId)).toEqual(['s1', 's2']);
  });
});
