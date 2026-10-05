import { describe, expect, it } from 'vitest';
import { createLayerPropertyKeyframe } from '@ograf-editor/scene-model';
import { animationGraphBounds, animationGraphPath, graphCoordinates } from './animationGraph';

describe('animation graph geometry', () => {
  it('maps frames and values into a padded graph and samples easing', () => {
    const keys = [
      createLayerPropertyKeyframe(0, 0),
      createLayerPropertyKeyframe(10, 100, { easing: 'quad-in' }),
    ];
    const bounds = animationGraphBounds(keys, 10);
    expect(graphCoordinates(0, 0, bounds, 200, 100).x).toBe(16);
    expect(graphCoordinates(10, 100, bounds, 200, 100).x).toBe(184);
    expect(animationGraphPath(keys, bounds, 200, 100)).toMatch(/^M /);
  });
});
