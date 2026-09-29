import { describe, expect, it } from 'vitest';
import { formatJsonResource, parseFrozenJsonResource, parseJsonResource } from './jsonResources';

describe('JSON script resources', () => {
  it('formats without rewriting supported number lexemes or duplicate keys', () => {
    expect(formatJsonResource('{"negative":-0,"exponent":1e2,"key":1,"key":2}')).toBe(
      '{\n  "negative": -0,\n  "exponent": 1e2,\n  "key": 1,\n  "key": 2\n}',
    );
  });

  it('accepts a BOM and rejects values JavaScript cannot preserve safely', () => {
    expect(parseJsonResource('\uFEFF{"ok":true}')).toEqual({ ok: true });
    expect(() => parseJsonResource('{"id":9007199254740993}')).toThrow('safe integer');
    expect(() => parseJsonResource('{"value":1e999}')).toThrow('finite');
  });

  it('bounds nesting and freezes iteratively', () => {
    expect(() => parseJsonResource('['.repeat(102) + '0' + ']'.repeat(102))).toThrow('nesting');
    const resource = parseFrozenJsonResource('{"items":[{"value":1}]}') as {
      items: Array<{ value: number }>;
    };
    expect(Object.isFrozen(resource)).toBe(true);
    expect(Object.isFrozen(resource.items)).toBe(true);
    expect(Object.isFrozen(resource.items[0])).toBe(true);
  });
});
