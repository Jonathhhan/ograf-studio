import { describe, expect, it } from 'vitest';
import {
  clampCornerRadii,
  cornerRadiiToCss,
  createCornerRadii,
  roundedRectangleSvgPath,
} from './cornerRadii';

describe('corner radii', () => {
  it('preserves four independent values in CSS corner order', () => {
    expect(cornerRadiiToCss({ topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 })).toBe(
      '4px 8px 12px 16px',
    );
  });

  it('expands a uniform shorthand and proportionally clamps oversized corners', () => {
    expect(createCornerRadii(6)).toEqual({
      topLeft: 6,
      topRight: 6,
      bottomRight: 6,
      bottomLeft: 6,
    });
    expect(
      clampCornerRadii({ topLeft: 80, topRight: 40, bottomRight: 0, bottomLeft: 0 }, 60, 100),
    ).toEqual({ topLeft: 40, topRight: 20, bottomRight: 0, bottomLeft: 0 });
  });

  it('builds an asymmetric SVG path', () => {
    const path = roundedRectangleSvgPath(100, 80, {
      topLeft: 4,
      topRight: 8,
      bottomRight: 12,
      bottomLeft: 16,
    });
    expect(path).toContain('M 4 0');
    expect(path).toContain('H 92');
    expect(path).toContain('A 12 12 0 0 1 88 80');
    expect(path).toContain('H 16');
  });
});

it('uses exact quarter circles for a fully rounded square, including oversized radii', () => {
  const circle =
    'M 30 0 H 30 A 30 30 0 0 1 60 30 V 30 A 30 30 0 0 1 30 60 H 30 A 30 30 0 0 1 0 30 V 30 A 30 30 0 0 1 30 0 Z';
  expect(roundedRectangleSvgPath(60, 60, 30)).toBe(circle);
  expect(roundedRectangleSvgPath(60, 60, 100)).toBe(circle);
});

it('keeps square corners and mixed radii finite', () => {
  // SVG zero-radius arcs are straight segments, preserving sharp corners.
  expect(roundedRectangleSvgPath(100, 60, { topRight: 30 })).toBe(
    'M 0 0 H 70 A 30 30 0 0 1 100 30 V 60 A 0 0 0 0 1 100 60 H 0 A 0 0 0 0 1 0 60 V 0 A 0 0 0 0 1 0 0 Z',
  );
});
