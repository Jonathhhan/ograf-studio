import { getTrackValueAtFrame, type LayerPropertyKeyframe } from '@ograf-editor/scene-model';

export interface AnimationGraphBounds {
  minFrame: number;
  maxFrame: number;
  minValue: number;
  maxValue: number;
}

export function animationGraphBounds(
  keys: LayerPropertyKeyframe[],
  durationFrames: number,
): AnimationGraphBounds {
  const values = keys.map((key) => key.value);
  let minValue = Math.min(...values),
    maxValue = Math.max(...values);
  if (!Number.isFinite(minValue)) minValue = 0;
  if (!Number.isFinite(maxValue)) maxValue = 1;
  if (minValue === maxValue) {
    const padding = Math.max(1, Math.abs(minValue) * 0.1);
    minValue -= padding;
    maxValue += padding;
  } else {
    const padding = (maxValue - minValue) * 0.1;
    minValue -= padding;
    maxValue += padding;
  }
  return {
    minFrame: 0,
    maxFrame: Math.max(1, durationFrames, ...keys.map((key) => key.frame)),
    minValue,
    maxValue,
  };
}

export function graphCoordinates(
  frame: number,
  value: number,
  bounds: AnimationGraphBounds,
  width: number,
  height: number,
  padding = 16,
) {
  return {
    x:
      padding +
      ((frame - bounds.minFrame) / (bounds.maxFrame - bounds.minFrame)) * (width - padding * 2),
    y:
      height -
      padding -
      ((value - bounds.minValue) / (bounds.maxValue - bounds.minValue)) * (height - padding * 2),
  };
}

export function animationGraphPath(
  keys: LayerPropertyKeyframe[],
  bounds: AnimationGraphBounds,
  width: number,
  height: number,
): string {
  if (keys.length === 0) return '';
  return Array.from(
    { length: Math.max(2, Math.ceil(bounds.maxFrame - bounds.minFrame) + 1) },
    (_, index) => {
      const frame =
        bounds.minFrame +
        ((bounds.maxFrame - bounds.minFrame) * index) /
          Math.max(1, Math.ceil(bounds.maxFrame - bounds.minFrame));
      const value = getTrackValueAtFrame(keys, frame, keys[0]!.value);
      const point = graphCoordinates(frame, value, bounds, width, height);
      return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    },
  ).join(' ');
}
