import { describe, expect, it } from 'vitest';
import { mediaFitRect } from './mediaPaintRendering';

describe('media paint rendering geometry', () => {
  it('covers and honors the normalized focal position', () => {
    expect(
      mediaFitRect({ width: 100, height: 100 }, { width: 200, height: 100 }, 'cover', 0, 0.5),
    ).toEqual({
      x: 0,
      y: -50,
      width: 200,
      height: 200,
    });
    expect(
      mediaFitRect({ width: 100, height: 100 }, { width: 200, height: 100 }, 'cover', 1, 1),
    ).toEqual({
      x: 0,
      y: -100,
      width: 200,
      height: 200,
    });
  });

  it('contains or stretches without cropping', () => {
    expect(
      mediaFitRect({ width: 100, height: 100 }, { width: 200, height: 100 }, 'contain', 0.5, 0.5),
    ).toEqual({
      x: 50,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(
      mediaFitRect({ width: 100, height: 50 }, { width: 300, height: 200 }, 'fill', 0.5, 0.5),
    ).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
  });
});
