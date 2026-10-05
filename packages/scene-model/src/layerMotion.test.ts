import { describe, expect, it } from 'vitest';
import {
  computeKeyframeFrames,
  createComposition,
  createLayerKeyframe,
  createLayerOfKind,
  defaultTransformForRole,
  getLayerPropertyValueAtFrame,
  type Layer,
} from './index';
import {
  applyLayerMotion,
  defaultLayerMotionSpec,
  layerMotionState,
  layerMotionWindows,
} from './layerMotion';

function setup(kind: 'rectangle' | 'text' = 'rectangle') {
  const composition = createComposition();
  const layer: Layer = createLayerOfKind(kind);
  const frames = computeKeyframeFrames(composition);
  layer.keyframes = composition.keyframes.map((keyframe, index) =>
    createLayerKeyframe(frames[index]!.frame, {
      ...defaultTransformForRole(layer.element.type, keyframe.role),
      x: 200,
      y: 300,
      width: 400,
      height: 100,
      opacity: 1,
    }),
  );
  layer.animationTracks = {};
  composition.layers.push(layer);
  return { composition, layer, windows: layerMotionWindows(composition)! };
}

const at = (layer: Layer, property: 'x' | 'y' | 'opacity' | 'blur', frame: number) =>
  getLayerPropertyValueAtFrame(layer, property, frame);

describe('Animate In/Out', () => {
  it('uses Start to first Step for in and last Step to End for out', () => {
    const { windows } = setup();
    expect(windows).toMatchObject({ start: 0, firstStep: 12, lastStep: 12, end: 24 });
    expect(windows.inFrames).toBe(12);
    expect(windows.outFrames).toBe(12);
  });

  it('slides and fades in, then holds its on-air pose', () => {
    const { composition, layer } = setup();
    applyLayerMotion(composition, layer, 'in', {
      style: 'slide',
      direction: 'left',
      distance: 80,
      durationFrames: 8,
    });
    expect(at(layer, 'x', 0)).toBe(120);
    expect(at(layer, 'x', 4)).toBe(120);
    expect(at(layer, 'opacity', 4)).toBe(0);
    expect(at(layer, 'x', 8)).toBeGreaterThan(120);
    expect(at(layer, 'x', 12)).toBe(200);
    expect(at(layer, 'opacity', 12)).toBe(1);
    expect(at(layer, 'x', 20)).toBe(200);
    expect(layerMotionState(composition, layer, 'in')).toMatchObject({ style: 'slide' });
    expect(layer.keyframes.map((key) => key.frame)).toEqual([0, 4, 12, 24]);
  });

  it('flies out past the canvas edge and clamps to the window', () => {
    const { composition, layer } = setup();
    applyLayerMotion(composition, layer, 'out', {
      style: 'fly',
      direction: 'right',
      durationFrames: 50,
    });
    expect(at(layer, 'x', 12)).toBe(200);
    expect(at(layer, 'x', 24)).toBe(composition.width + 40);
    expect(layer.motion?.out?.durationFrames).toBe(12);
  });

  it('replaces an earlier choice and can go back to none', () => {
    const { composition, layer } = setup();
    applyLayerMotion(composition, layer, 'in', defaultLayerMotionSpec('slide', 12));
    applyLayerMotion(composition, layer, 'in', { style: 'fade', durationFrames: 6 });
    expect(at(layer, 'x', 0)).toBe(200);
    expect(at(layer, 'opacity', 3)).toBe(0);
    applyLayerMotion(composition, layer, 'in', null);
    expect(at(layer, 'opacity', 0)).toBe(1);
    expect(at(layer, 'x', 0)).toBe(200);
    expect(layerMotionState(composition, layer, 'in')).toBeNull();
    expect(layer.keyframes.map((key) => key.frame)).toEqual([0, 12, 24]);
  });

  it('un-blurs with Focus when the layer has a blur to animate', () => {
    const { composition, layer } = setup('text');
    applyLayerMotion(composition, layer, 'in', { style: 'focus', durationFrames: 12 });
    expect(at(layer, 'blur', 0)).toBe(24);
    expect(at(layer, 'blur', 12)).toBe(0);
    expect(at(layer, 'opacity', 0)).toBe(0);
  });

  it('reports hand-made motion as custom until a choice replaces it', () => {
    const { composition, layer } = setup();
    layer.keyframes[0]!.transform.y = 900;
    expect(layerMotionState(composition, layer, 'in')).toBe('custom');
    expect(layerMotionState(composition, layer, 'out')).toBeNull();
  });
});
