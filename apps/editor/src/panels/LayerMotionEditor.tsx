import {
  defaultLayerMotionSpec,
  layerMotionState,
  layerMotionStyleAvailable,
  layerMotionWindows,
  LAYER_MOTION_DEFAULT_DISTANCE,
  type Composition,
  type EasingPreset,
  type Layer,
  type LayerMotionDirection,
  type LayerMotionSide,
  type LayerMotionSpec,
  type LayerMotionStyle,
} from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { useTimelineStore } from '../state/timelineStore';
import './LayerMotionEditor.css';

const STYLES: Array<[LayerMotionStyle, string]> = [
  ['fade', 'Fade'],
  ['slide', 'Slide'],
  ['fly', 'Fly'],
  ['focus', 'Focus'],
];

const DIRECTIONS: Array<[LayerMotionDirection, string, string]> = [
  ['left', '←', 'left'],
  ['right', '→', 'right'],
  ['up', '↑', 'top'],
  ['down', '↓', 'bottom'],
];

/** Friendly easing names; the incoming (in) and outgoing (out) curve of each feel. */
const FEELS: Array<{ label: string; in: EasingPreset; out: EasingPreset }> = [
  { label: 'Smooth', in: 'cubic-out', out: 'cubic-in' },
  { label: 'Gentle', in: 'sine-out', out: 'sine-in' },
  { label: 'Snappy', in: 'expo-out', out: 'expo-in' },
  { label: 'Overshoot', in: 'back-out', out: 'back-in' },
  { label: 'Linear', in: 'linear', out: 'linear' },
];

interface LayerMotionEditorProps {
  composition: Composition;
  layer: Layer;
  /** Every selected layer; the choice applies to all unlocked ones. */
  layerIds: string[];
}

function MotionSide({
  composition,
  layer,
  layerIds,
  side,
}: LayerMotionEditorProps & { side: LayerMotionSide }) {
  const setLayerMotion = useProjectStore((state) => state.setLayerMotion);
  const windows = layerMotionWindows(composition);
  const state = layerMotionState(composition, layer, side);
  const spec = state && state !== 'custom' ? state : null;
  const windowFrames = windows ? (side === 'in' ? windows.inFrames : windows.outFrames) : 0;
  const disabled = layer.isLocked || !windows || windowFrames < 1;
  const apply = (next: LayerMotionSpec | null) => setLayerMotion(layerIds, side, next);
  const update = (patch: Partial<LayerMotionSpec>) => spec && apply({ ...spec, ...patch });
  const feel =
    FEELS.find((candidate) => candidate[side] === (spec?.easing ?? FEELS[0]![side])) ?? FEELS[0]!;
  const label = side === 'in' ? 'In' : 'Out';
  const seconds = spec ? spec.durationFrames / composition.frameRate : 0;

  const preview = () => {
    const controller = useTimelineStore.getState().controller;
    if (!controller || !windows) return;
    controller.seek(side === 'in' ? windows.start : windows.lastStep);
    controller.play();
  };

  return (
    <div className="layer-motion-side" data-side={side}>
      <div className="layer-motion-row">
        <span className="layer-motion-label">{label}</span>
        <select
          aria-label={`Animate ${label} style`}
          value={state === 'custom' ? 'custom' : (spec?.style ?? 'none')}
          disabled={disabled}
          onChange={(event) => {
            const style = event.target.value;
            if (style === 'custom') return;
            if (style === 'none') return apply(null);
            const next = defaultLayerMotionSpec(style as LayerMotionStyle, windowFrames);
            apply(
              spec
                ? {
                    ...next,
                    durationFrames: spec.durationFrames,
                    ...(spec.easing ? { easing: spec.easing } : {}),
                    ...(next.direction && spec.direction ? { direction: spec.direction } : {}),
                  }
                : next,
            );
          }}
        >
          <option value="none">None (cut)</option>
          {STYLES.map(([style, name]) => (
            <option
              key={style}
              value={style}
              disabled={!layerMotionStyleAvailable(layer, style)}
              title={
                layerMotionStyleAvailable(layer, style)
                  ? undefined
                  : 'Needs the layer’s built-in blur effect'
              }
            >
              {name}
            </option>
          ))}
          {state === 'custom' ? (
            <option value="custom" disabled>
              Custom keys
            </option>
          ) : null}
        </select>
        {spec?.direction ? (
          <div
            className="layer-motion-directions"
            role="radiogroup"
            aria-label={`${label} direction`}
          >
            {DIRECTIONS.map(([direction, arrow, name]) => (
              <button
                key={direction}
                type="button"
                role="radio"
                aria-checked={spec.direction === direction}
                aria-label={`${side === 'in' ? 'From' : 'To'} ${name}`}
                title={`${side === 'in' ? 'From' : 'To'} ${name}`}
                className={spec.direction === direction ? 'active' : ''}
                disabled={disabled}
                onClick={() => update({ direction })}
              >
                {arrow}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="layer-motion-preview"
          aria-label={`Preview ${label}`}
          title={`Play the ${side === 'in' ? 'entrance' : 'exit'} on the canvas`}
          disabled={!windows}
          onClick={preview}
        >
          ▶
        </button>
      </div>
      {spec ? (
        <div className="layer-motion-row layer-motion-details">
          <label title={`At most ${windowFrames} frames fit; change the timing on the timeline`}>
            <input
              aria-label={`${label} duration in frames`}
              type="number"
              min={1}
              max={windowFrames}
              value={spec.durationFrames}
              disabled={disabled}
              onChange={(event) => {
                const frames = Math.round(Number(event.target.value));
                if (Number.isFinite(frames) && frames >= 1) update({ durationFrames: frames });
              }}
            />
            fr <small>{seconds.toFixed(2)} s</small>
          </label>
          {spec.style === 'slide' ? (
            <label title="How far it travels, in pixels">
              <input
                aria-label={`${label} distance in pixels`}
                type="number"
                min={0}
                value={spec.distance ?? LAYER_MOTION_DEFAULT_DISTANCE}
                disabled={disabled}
                onChange={(event) => {
                  const distance = Number(event.target.value);
                  if (Number.isFinite(distance) && distance >= 0) update({ distance });
                }}
              />
              px
            </label>
          ) : null}
          <select
            aria-label={`${label} feel`}
            value={feel.label}
            disabled={disabled}
            onChange={(event) => {
              const next = FEELS.find((candidate) => candidate.label === event.target.value);
              if (next) update({ easing: next[side] });
            }}
          >
            {FEELS.map((candidate) => (
              <option key={candidate.label} value={candidate.label}>
                {candidate.label}
              </option>
            ))}
          </select>
        </div>
      ) : state === 'custom' ? (
        <p className="layer-motion-hint">
          This layer has its own keys here. Choosing a style replaces them.
        </p>
      ) : null}
    </div>
  );
}

/**
 * One-click entrance and exit. Choices bake into ordinary keys between Start and the first Step
 * (In) and between the last Step and End (Out), so the timeline stays the source of truth.
 */
export function LayerMotionEditor(props: LayerMotionEditorProps) {
  const windows = layerMotionWindows(props.composition);
  return (
    <div className="layer-motion-editor">
      {windows ? (
        <>
          <MotionSide {...props} side="in" />
          <MotionSide {...props} side="out" />
        </>
      ) : (
        <p className="layer-motion-hint">Add a Step on the timeline to animate in and out.</p>
      )}
    </div>
  );
}
