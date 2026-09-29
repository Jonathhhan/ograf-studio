import { expect, it } from 'vitest';
import { documentEqual } from './documentEqual';

it('skips shared asset subtrees while detecting edited geometry', () => {
  const assets = {
    get dataUri(): string {
      throw Error('shared assets must not be traversed');
    },
  };
  expect(documentEqual({ assets, x: 1 }, { assets, x: 1 })).toBe(true);
  expect(documentEqual({ assets, x: 1 }, { assets, x: 2 })).toBe(false);
});
it('compares JSON documents structurally, preserving array order and missing properties', () => {
  expect(documentEqual({ a: 1, b: [null, 'x'] }, { b: [null, 'x'], a: 1 })).toBe(true);
  expect(documentEqual([1, 2], [2, 1])).toBe(false);
  expect(documentEqual({ a: undefined }, {})).toBe(false);
  expect(documentEqual([], {})).toBe(false);
});
