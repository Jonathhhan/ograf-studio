import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  getResolvedLayerAnimationTracks,
  type AnimatableLayerProperty,
  type Layer,
} from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { animationGraphBounds, animationGraphPath, graphCoordinates } from './animationGraph';
import './AnimationGraphEditor.css';

const WIDTH = 720;
const HEIGHT = 180;
const PADDING = 16;

export function AnimationGraphEditor({
  layer,
  property,
  durationFrames,
}: {
  layer: Layer;
  property: AnimatableLayerProperty;
  durationFrames: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const keys = useMemo(
    () => getResolvedLayerAnimationTracks(layer)[property] ?? [],
    [layer, property],
  );
  const bounds = useMemo(() => animationGraphBounds(keys, durationFrames), [durationFrames, keys]);
  const path = useMemo(() => animationGraphPath(keys, bounds, WIDTH, HEIGHT), [bounds, keys]);
  const selected = useSelectionStore((state) => state.selectedLayerKeyframes);
  const selectKey = useSelectionStore((state) => state.selectLayerKeyframe);
  const selectKeys = useSelectionStore((state) => state.selectLayerKeyframes);
  const moveKey = useProjectStore((state) => state.moveLayerPropertyKeyframe);
  const updateValue = useProjectStore((state) => state.updateLayerPropertyKeyframeValue);

  if (keys.length === 0) return null;
  const updateFromPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(PADDING, Math.min(rect.width - PADDING, event.clientX - rect.left));
    const y = Math.max(PADDING, Math.min(rect.height - PADDING, event.clientY - rect.top));
    const frame = Math.round(
      bounds.minFrame +
        ((x - PADDING) / (rect.width - PADDING * 2)) * (bounds.maxFrame - bounds.minFrame),
    );
    const value =
      bounds.maxValue -
      ((y - PADDING) / (rect.height - PADDING * 2)) * (bounds.maxValue - bounds.minValue);
    moveKey(layer.id, property, dragging, frame);
    updateValue(layer.id, property, dragging, value);
  };

  return (
    <section className="animation-graph-editor" aria-label="Animation graph editor">
      <header>
        <strong>Graph · {property}</strong>
        <span>
          {bounds.minValue.toFixed(2)} – {bounds.maxValue.toFixed(2)}
        </span>
      </header>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onPointerMove={updateFromPointer}
        onPointerUp={(event) => {
          if (dragging) event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(null);
        }}
        onPointerCancel={() => setDragging(null)}
      >
        <rect x={PADDING} y={PADDING} width={WIDTH - PADDING * 2} height={HEIGHT - PADDING * 2} />
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={PADDING}
            x2={WIDTH - PADDING}
            y1={PADDING + ratio * (HEIGHT - PADDING * 2)}
            y2={PADDING + ratio * (HEIGHT - PADDING * 2)}
          />
        ))}
        <path d={path} />
        {keys.map((key) => {
          const point = graphCoordinates(key.frame, key.value, bounds, WIDTH, HEIGHT);
          const isSelected = selected.some(
            (candidate) =>
              candidate.layerId === layer.id &&
              candidate.property === property &&
              candidate.keyframeId === key.id,
          );
          return (
            <circle
              key={key.id}
              cx={point.x}
              cy={point.y}
              r={isSelected ? 6 : 4.5}
              className={isSelected ? 'selected' : undefined}
              tabIndex={0}
              aria-label={`${property} key at frame ${key.frame}, value ${key.value}`}
              onPointerDown={(event) => {
                event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                setDragging(key.id);
                if (event.ctrlKey || event.metaKey) {
                  const next = { layerId: layer.id, property, keyframeId: key.id };
                  selectKeys([...selected, next], next);
                } else selectKey(layer.id, key.id, property);
              }}
            />
          );
        })}
      </svg>
      <p>
        Drag keys horizontally for time and vertically for value. Edit the selected segment's Bézier
        handles below.
      </p>
    </section>
  );
}
