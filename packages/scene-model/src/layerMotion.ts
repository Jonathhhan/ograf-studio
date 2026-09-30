import { createLayerKeyframe, createLayerPropertyKeyframe } from './factory';
import { computeKeyframeFrames } from './keyframeTiming';
import {
  getLayerPropertyValueAtFrame,
  getLayerTransformAtFrame,
  getResolvedLayerAnimationTracks,
  isAnimatableLayerPropertyApplicable,
  sortLayerKeyframes,
  sortLayerPropertyKeyframes,
  TRANSFORM_ANIMATION_PROPERTIES,
} from './layerAnimation';
import type {
  Composition,
  EasingPreset,
  Layer,
  LayerMotionSpec,
  LayerPropertyKeyframe,
  LayerTransform,
} from './types';

/** Properties Animate In/Out writes. Width and height are left alone: they reflow text. */
export const LAYER_MOTION_PROPERTIES = ['x', 'y', 'opacity', 'blur'] as const;
type MotionProperty = (typeof LAYER_MOTION_PROPERTIES)[number];

export const LAYER_MOTION_DEFAULT_DISTANCE = 80;
const FOCUS_BLUR = 24;
const FLY_MARGIN = 40;

export type LayerMotionSide = 'in' | 'out';

/** Motion properties this layer can animate; blur needs the layer's built-in blur effect. */
export function layerMotionProperties(layer: Layer): MotionProperty[] {
  return LAYER_MOTION_PROPERTIES.filter((property) =>
    isAnimatableLayerPropertyApplicable(layer, property),
  );
}

/** Focus needs a blur to animate. */
export function layerMotionStyleAvailable(layer: Layer, style: LayerMotionSpec['style']): boolean {
  return style !== 'focus' || layerMotionProperties(layer).includes('blur');
}

/** The IN window runs from Start to the first Step; OUT from the last Step to End. */
export interface LayerMotionWindows {
  start: number;
  firstStep: number;
  lastStep: number;
  end: number;
  /** Longest motion that fits each window, in frames. */
  inFrames: number;
  outFrames: number;
}

export function layerMotionWindows(
  composition: Pick<Composition, 'keyframes' | 'transitions'>,
): LayerMotionWindows | null {
  const frames = new Map(
    computeKeyframeFrames(composition as Composition).map((entry) => [
      entry.keyframeId,
      entry.frame,
    ]),
  );
  const start = composition.keyframes.find((keyframe) => keyframe.role === 'start');
  const end = composition.keyframes.find((keyframe) => keyframe.role === 'end');
  const steps = composition.keyframes.filter((keyframe) => keyframe.role === 'step');
  if (!start || !end || steps.length === 0) return null;
  const at = (id: string) => frames.get(id) ?? 0;
  const firstStep = at(steps[0]!.id);
  const lastStep = at(steps.at(-1)!.id);
  return {
    start: at(start.id),
    firstStep,
    lastStep,
    end: at(end.id),
    inFrames: Math.max(0, firstStep - at(start.id)),
    outFrames: Math.max(0, at(end.id) - lastStep),
  };
}

export function defaultLayerMotionSpec(
  style: LayerMotionSpec['style'],
  windowFrames: number,
): LayerMotionSpec {
  return {
    style,
    ...(style === 'slide' || style === 'fly' ? { direction: 'left' as const } : {}),
    ...(style === 'slide' ? { distance: LAYER_MOTION_DEFAULT_DISTANCE } : {}),
    durationFrames: Math.max(1, Math.min(windowFrames, 12)),
  };
}

/** Values a layer holds off air, for the properties the style moves. */
function offAirValues(
  composition: Pick<Composition, 'width' | 'height'>,
  spec: LayerMotionSpec,
  onAir: Record<MotionProperty, number>,
  size: Pick<LayerTransform, 'width' | 'height'>,
): Partial<Record<MotionProperty, number>> {
  const direction = spec.direction ?? 'left';
  switch (spec.style) {
    case 'fade':
      return { opacity: 0 };
    case 'focus':
      return { opacity: 0, blur: onAir.blur + FOCUS_BLUR };
    case 'slide': {
      const distance = Math.max(0, spec.distance ?? LAYER_MOTION_DEFAULT_DISTANCE);
      const offset =
        direction === 'left'
          ? { x: onAir.x - distance }
          : direction === 'right'
            ? { x: onAir.x + distance }
            : direction === 'up'
              ? { y: onAir.y - distance }
              : { y: onAir.y + distance };
      return { opacity: 0, ...offset };
    }
    case 'fly':
      return direction === 'left'
        ? { x: -size.width - FLY_MARGIN }
        : direction === 'right'
          ? { x: composition.width + FLY_MARGIN }
          : direction === 'up'
            ? { y: -size.height - FLY_MARGIN }
            : { y: composition.height + FLY_MARGIN };
  }
}

function inWindow(windows: LayerMotionWindows, side: LayerMotionSide, frame: number): boolean {
  return side === 'in'
    ? frame >= windows.start && frame < windows.firstStep
    : frame > windows.lastStep && frame <= windows.end;
}

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/**
 * What a side currently does: the stored choice, `custom` when the window holds other motion
 * (hand-made keys or a recipe), or `null` when the layer simply holds still.
 */
export function layerMotionState(
  composition: Pick<Composition, 'keyframes' | 'transitions'>,
  layer: Layer,
  side: LayerMotionSide,
): LayerMotionSpec | 'custom' | null {
  const stored = layer.motion?.[side];
  if (stored) return stored;
  const windows = layerMotionWindows(composition);
  if (!windows) return null;
  const anchor = side === 'in' ? windows.firstStep : windows.lastStep;
  const tracks = getResolvedLayerAnimationTracks(layer);
  for (const property of layerMotionProperties(layer)) {
    const onAir = getLayerPropertyValueAtFrame(layer, property, anchor);
    if (
      (tracks[property] ?? []).some(
        (key) => inWindow(windows, side, key.frame) && !sameValue(key.value, onAir),
      )
    )
      return 'custom';
  }
  return null;
}

/**
 * Bakes an entrance or exit into the layer's x, y, opacity and blur tracks, replacing whatever
 * those tracks held inside that side's window. `null` makes the layer hold its on-air values
 * through the window. The layer's pose at the first Step (in) or last Step (out) is kept.
 */
export function applyLayerMotion(
  composition: Composition,
  layer: Layer,
  side: LayerMotionSide,
  spec: LayerMotionSpec | null,
): void {
  const windows = layerMotionWindows(composition);
  if (!windows)
    throw new Error('Animate In/Out needs a Start, at least one Step, and an End keyframe.');
  const anchor = side === 'in' ? windows.firstStep : windows.lastStep;
  const properties = layerMotionProperties(layer);
  const onAir = Object.fromEntries(
    LAYER_MOTION_PROPERTIES.map((property) => [
      property,
      properties.includes(property) ? getLayerPropertyValueAtFrame(layer, property, anchor) : 0,
    ]),
  ) as Record<MotionProperty, number>;
  const size = getLayerTransformAtFrame(layer, anchor);

  layer.animationTracks = Object.fromEntries(
    Object.entries(getResolvedLayerAnimationTracks(layer)).map(([property, keys]) => [
      property,
      keys?.map((key) => ({ ...key, ...(key.curve ? { curve: { ...key.curve } } : {}) })) ?? [],
    ]),
  );

  const available = side === 'in' ? windows.inFrames : windows.outFrames;
  const duration = spec ? Math.max(1, Math.min(available, Math.round(spec.durationFrames))) : 0;
  const off = spec && available > 0 ? offAirValues(composition, spec, onAir, size) : {};
  const easing: EasingPreset = spec?.easing ?? (side === 'in' ? 'cubic-out' : 'cubic-in');

  for (const property of properties) {
    const track = (layer.animationTracks[property] ?? []).filter(
      (key) => !inWindow(windows, side, key.frame),
    );
    const put = (frame: number, value: number, keyEasing?: EasingPreset) => {
      const existing = track.find((key) => key.frame === frame);
      if (existing) {
        existing.value = value;
        if (keyEasing) {
          existing.easing = keyEasing;
          delete existing.curve;
        }
      } else
        track.push(
          createLayerPropertyKeyframe(frame, value, {
            easing: keyEasing ?? 'linear',
          }) as LayerPropertyKeyframe,
        );
    };
    const offValue = off[property];
    if (side === 'in') {
      if (offValue === undefined) {
        put(windows.start, onAir[property]);
      } else {
        put(windows.start, offValue);
        const motionStart = windows.firstStep - duration;
        if (motionStart > windows.start) put(motionStart, offValue);
        put(windows.firstStep, onAir[property], easing);
      }
    } else if (offValue === undefined) {
      put(windows.end, onAir[property]);
    } else {
      if (!track.some((key) => key.frame === windows.lastStep))
        put(windows.lastStep, onAir[property]);
      const motionStart = windows.end - duration;
      if (motionStart > windows.lastStep) put(motionStart, onAir[property]);
      put(windows.end, offValue, easing);
    }
    layer.animationTracks[property] = sortLayerPropertyKeyframes(track);
  }

  // Keep the aggregate pose keys (the timeline's per-layer diamonds) in step with the tracks.
  const lifecycleFrames = new Set([
    windows.start,
    windows.firstStep,
    windows.lastStep,
    windows.end,
  ]);
  const transformFrames = new Set<number>(lifecycleFrames);
  for (const property of TRANSFORM_ANIMATION_PROPERTIES)
    for (const key of layer.animationTracks[property] ?? []) transformFrames.add(key.frame);
  const easingAt = (frame: number) =>
    LAYER_MOTION_PROPERTIES.flatMap((property) => layer.animationTracks[property] ?? []).find(
      (key) => key.frame === frame && key.easing !== 'linear',
    )?.easing ?? 'linear';
  layer.keyframes = sortLayerKeyframes([
    ...layer.keyframes.filter((key) => transformFrames.has(key.frame)),
    ...[...transformFrames]
      .filter((frame) => !layer.keyframes.some((key) => key.frame === frame))
      .map((frame) => createLayerKeyframe(frame, getLayerTransformAtFrame(layer, frame))),
  ]);
  for (const key of layer.keyframes) {
    key.transform = getLayerTransformAtFrame(layer, key.frame);
    if (inWindow(windows, side, key.frame) || key.frame === anchor || key.frame === windows.end)
      key.easing = easingAt(key.frame);
  }

  layer.motion = {
    in: layer.motion?.in ?? null,
    out: layer.motion?.out ?? null,
    [side]: spec ? { ...spec, durationFrames: duration } : null,
  };
}
