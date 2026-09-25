import { PropertyRow } from '../components/PropertyRow';
import { useRef, useState } from 'react';
import {
  createMediaPaint,
  createDefaultGradient,
  createShaderPaint,
  isGradientPaint,
  isMediaPaint,
  isShaderPaint,
  type GradientPaint,
  type MediaPaint,
  type Paint,
  type ShaderParameterValue,
} from '@ograf-editor/scene-model';
import { ShaderSourceEditor } from './ShaderSourceEditor';
import { shaderPaintWithPatch } from '../state/shaderResources';
import { SHADER_RESOURCE_MIME, shaderPaintFromResourceDrag } from '../state/shaderDrag';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import './PaintEditor.css';

interface PaintEditorProps {
  value: Paint | undefined;
  onChange: (value: Paint | undefined) => void;
  /** Media keeps its original pixels until a shader fill is chosen. */
  media?: boolean;
  allowShader?: boolean;
  allowGradient?: boolean;
  allowMedia?: boolean;
  label?: string;
  disabled?: boolean;
  onShaderParameterChange?: (name: string, value: ShaderParameterValue) => void;
  onShaderParameterPreview?: (name: string, value: ShaderParameterValue) => void;
  shaderAnimationActive?: boolean;
}

const asColor = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000');

export function PaintEditor({
  value,
  onChange,
  media = false,
  allowShader = true,
  allowGradient = true,
  allowMedia = true,
  label = 'Fill',
  disabled = false,
  onShaderParameterChange,
  onShaderParameterPreview,
  shaderAnimationActive = false,
}: PaintEditorProps) {
  const [dragOver, setDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const kind = value === undefined ? 'original' : typeof value === 'string' ? 'solid' : value.type;
  const gradient = isGradientPaint(value) ? value : null;
  const updateGradient = (patch: Partial<GradientPaint>) => {
    if (gradient) onChange({ ...gradient, ...patch });
  };

  return (
    <div className="paint-editor">
      <div
        className={`paint-shader-drop${dragOver ? ' is-drag-over' : ''}`}
        data-shader-drop-slot={allowShader ? label.toLowerCase() : undefined}
        onDragEnter={(event) => {
          if (!allowShader || !event.dataTransfer.types.includes(SHADER_RESOURCE_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
          setDragOver(!disabled);
        }}
        onDragOver={(event) => {
          if (!allowShader || !event.dataTransfer.types.includes(SHADER_RESOURCE_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
          setDragOver(!disabled);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={(event) => {
          if (!allowShader || !event.dataTransfer.types.includes(SHADER_RESOURCE_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          setDragOver(false);
          if (disabled) return;
          try {
            const paint = shaderPaintFromResourceDrag(
              useProjectStore.getState().project,
              event.dataTransfer.getData(SHADER_RESOURCE_MIME),
            );
            onChange(paint);
            setDropError(null);
          } catch (cause) {
            setDropError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <PropertyRow
          help={
            label === 'Outline'
              ? 'Choose the text outline paint. Its shader follows editable characters and uses the Stroke Width below. Drop a shader from Resources onto this row to replace it.'
              : isMediaPaint(value)
                ? 'Media is this object’s fill. Choosing or dropping a shader here replaces Media; drop the shader onto Effects stack to process the video instead.'
                : 'Choose the object fill. Drop a shader from Resources onto this row to apply it. Shader controls are declared with #pragma ograf.'
          }
          className="inspector-row"
        >
          <span>{label}</span>
          <select
            value={kind}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value;
              onChange(
                next === 'original'
                  ? undefined
                  : next === 'media'
                    ? createMediaPaint()
                    : next === 'shader'
                      ? createShaderPaint()
                      : next === 'solid'
                        ? '#3b3f4a'
                        : createDefaultGradient(next as GradientPaint['type']),
              );
            }}
          >
            {media && <option value="original">Original pixels</option>}
            {!media && (
              <>
                <option value="solid">Solid</option>
                {allowGradient && (
                  <>
                    <option value="linear">Linear gradient</option>
                    <option value="radial">Radial gradient</option>
                    <option value="conic">Conic gradient</option>
                  </>
                )}
              </>
            )}
            {allowShader && <option value="shader">Shader</option>}
            {allowMedia && <option value="media">Media</option>}
          </select>
        </PropertyRow>
      </div>
      {dropError && (
        <p className="shader-source-error" role="alert">
          {dropError}
        </p>
      )}
      {isMediaPaint(value) ? (
        <MediaPaintControls value={value} disabled={disabled} onChange={onChange} />
      ) : isShaderPaint(value) ? (
        <>
          {shaderAnimationActive && (
            <p className="inspector-hint">
              Keyframed controls follow Timeline. Use Auto-keyframe for playhead edits, or edit
              repeating values in the loop editor.
            </p>
          )}
          <ShaderSourceEditor
            element={value}
            labelPrefix={label === 'Fill' ? 'Shader' : `${label} shader`}
            onChange={(patch) => onChange(shaderPaintWithPatch(value, patch))}
            onParameterChange={onShaderParameterChange}
            onParameterPreview={onShaderParameterPreview}
          />
        </>
      ) : typeof value === 'string' ? (
        <PropertyRow
          help={
            'Solid fill color inside the shape. For multiple colors or moving highlights, switch the fill type to a gradient.'
          }
          className="inspector-row"
        >
          <span>Color</span>
          <input
            type="color"
            value={asColor(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        </PropertyRow>
      ) : isGradientPaint(value) ? (
        <>
          {value.type !== 'radial' && (
            <PropertyRow
              help={
                'Gradient direction or rotation in degrees. Changing the angle moves the color transition around the shape without changing its outline.'
              }
              className="inspector-row"
            >
              <span>Angle</span>
              <input
                type="number"
                value={value.angle}
                onChange={(event) => updateGradient({ angle: Number(event.target.value) })}
              />
            </PropertyRow>
          )}
          <div className="paint-stops">
            {value.stops.map((stop, index) => (
              <div className="paint-stop" key={index}>
                <input
                  aria-label={`Stop ${index + 1} color`}
                  type="color"
                  value={asColor(stop.color)}
                  onChange={(event) =>
                    updateGradient({
                      stops: value.stops.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, color: event.target.value } : item,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`Stop ${index + 1} offset`}
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(stop.offset * 100)}
                  onChange={(event) =>
                    updateGradient({
                      stops: value.stops.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              offset: Math.max(0, Math.min(1, Number(event.target.value) / 100)),
                            }
                          : item,
                      ),
                    })
                  }
                />
                <span>%</span>
                <input
                  aria-label={`Stop ${index + 1} opacity`}
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(stop.opacity * 100)}
                  onChange={(event) =>
                    updateGradient({
                      stops: value.stops.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              opacity: Math.max(0, Math.min(1, Number(event.target.value) / 100)),
                            }
                          : item,
                      ),
                    })
                  }
                />
                <span>% alpha</span>
                <button
                  type="button"
                  disabled={value.stops.length <= 2}
                  onClick={() =>
                    updateGradient({
                      stops: value.stops.filter((_, itemIndex) => itemIndex !== index),
                    })
                  }
                >
                  Delete
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                updateGradient({
                  stops: [...value.stops, { offset: 0.5, color: '#ffffff', opacity: 1 }].sort(
                    (a, b) => a.offset - b.offset,
                  ),
                })
              }
            >
              + Stop
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MediaPaintControls({
  value,
  disabled,
  onChange,
}: {
  value: MediaPaint;
  disabled: boolean;
  onChange: (value: Paint) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composition = useActiveComposition();
  const importAsset = useProjectStore((state) => state.importAsset);
  const supportsNonRealTime = useProjectStore((state) => state.project.supportsNonRealTime);
  const mediaAssets = composition.assets.filter((asset) => asset.kind === 'media');
  const imageAssets = composition.assets.filter((asset) => asset.kind === 'image');
  const patch = (next: Partial<MediaPaint>) => onChange(createMediaPaint({ ...value, ...next }));

  return (
    <div className="media-paint-controls">
      <PropertyRow
        help="Choose a packaged or URL video clip, or a renderer-owned live source tag. Media paint is always muted."
        className="inspector-row"
      >
        <span>Source type</span>
        <select
          value={value.source.kind}
          disabled={disabled}
          onChange={(event) =>
            patch({
              source:
                event.target.value === 'live'
                  ? { kind: 'live', tag: 'programme' }
                  : { kind: 'clip', src: '' },
            })
          }
        >
          <option value="clip">Clip</option>
          <option value="live">Live</option>
        </select>
      </PropertyRow>
      {value.source.kind === 'clip' ? (
        <>
          <PropertyRow help="Packaged clip or custom video URL." className="inspector-row">
            <span>Clip</span>
            <select
              value={value.source.src.startsWith('asset:') ? value.source.src : '__custom'}
              disabled={disabled}
              onChange={(event) =>
                patch({
                  source: {
                    kind: 'clip',
                    src: event.target.value === '__custom' ? '' : event.target.value,
                  },
                })
              }
            >
              <option value="__custom">URL / reference</option>
              {mediaAssets.map((asset) => (
                <option key={asset.id} value={`asset:${asset.id}`}>
                  {asset.name}
                </option>
              ))}
            </select>
          </PropertyRow>
          {!value.source.src.startsWith('asset:') ? (
            <PropertyRow help="Absolute video URL or asset reference." className="inspector-row">
              <span>Source</span>
              <input
                type="text"
                value={value.source.src}
                disabled={disabled}
                placeholder="https://example.com/clip.mp4"
                onChange={(event) => patch({ source: { kind: 'clip', src: event.target.value } })}
              />
            </PropertyRow>
          ) : null}
          <div className="inspector-button-row media-paint-import">
            <button type="button" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
              Import clip…
            </button>
            <input
              ref={fileInputRef}
              className="inspector-file-input"
              type="file"
              accept="video/mp4,video/webm,.mp4,.webm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                void importAsset(file).then((assetId) =>
                  patch({ source: { kind: 'clip', src: `asset:${assetId}` } }),
                );
              }}
            />
          </div>
        </>
      ) : (
        <>
          <PropertyRow
            help="Renderer-owned identifier exposed through the zd-ograf-media custom element."
            className="inspector-row"
          >
            <span>Live tag</span>
            <input
              type="text"
              value={value.source.tag}
              disabled={disabled}
              placeholder="camera.program"
              onChange={(event) =>
                patch({
                  source: {
                    kind: 'live',
                    tag: event.target.value,
                    ...(value.source.kind === 'live' && value.source.fallback
                      ? { fallback: value.source.fallback }
                      : {}),
                  },
                })
              }
            />
          </PropertyRow>
          <PropertyRow
            help="Portable image shown when live media is unavailable."
            className="inspector-row"
          >
            <span>Fallback</span>
            <select
              value={value.source.fallback ?? ''}
              disabled={disabled}
              onChange={(event) =>
                patch({
                  source: {
                    kind: 'live',
                    tag: value.source.kind === 'live' ? value.source.tag : '',
                    ...(event.target.value ? { fallback: event.target.value } : {}),
                  },
                })
              }
            >
              <option value="">Transparent</option>
              {imageAssets.map((asset) => (
                <option key={asset.id} value={`asset:${asset.id}`}>
                  {asset.name}
                </option>
              ))}
            </select>
          </PropertyRow>
        </>
      )}
      <PropertyRow
        help="How the moving image fits inside the painted object."
        className="inspector-row"
      >
        <span>Fit</span>
        <select
          value={value.fit}
          disabled={disabled}
          onChange={(event) => patch({ fit: event.target.value as MediaPaint['fit'] })}
        >
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
          <option value="fill">Stretch</option>
        </select>
      </PropertyRow>
      <div className="inspector-grid">
        <PropertyRow help="Horizontal focal position." className="inspector-row">
          <span>Position X</span>
          <input
            type="number"
            min={0}
            max={100}
            value={Math.round(value.positionX * 100)}
            disabled={disabled}
            onChange={(event) => patch({ positionX: Number(event.target.value) / 100 })}
          />
        </PropertyRow>
        <PropertyRow help="Vertical focal position." className="inspector-row">
          <span>Position Y</span>
          <input
            type="number"
            min={0}
            max={100}
            value={Math.round(value.positionY * 100)}
            disabled={disabled}
            onChange={(event) => patch({ positionY: Number(event.target.value) / 100 })}
          />
        </PropertyRow>
      </div>
      {value.source.kind === 'clip' ? (
        <>
          <PropertyRow
            help="Loop the clip continuously while the graphic is active."
            className="inspector-row inspector-checkbox-row"
          >
            <span>Loop</span>
            <input
              type="checkbox"
              checked={value.loop}
              disabled={disabled}
              onChange={(event) => patch({ loop: event.target.checked })}
            />
          </PropertyRow>
          <div className="inspector-grid">
            <PropertyRow help="Muted playback speed multiplier." className="inspector-row">
              <span>Speed</span>
              <input
                type="number"
                min={0.1}
                max={16}
                step={0.1}
                value={value.speed}
                disabled={disabled}
                onChange={(event) => patch({ speed: Number(event.target.value) })}
              />
            </PropertyRow>
            <PropertyRow
              help="Initial offset into the clip in milliseconds."
              className="inspector-row"
            >
              <span>Offset ms</span>
              <input
                type="number"
                min={0}
                step={1}
                value={value.offsetMs}
                disabled={disabled}
                onChange={(event) => patch({ offsetMs: Number(event.target.value) })}
              />
            </PropertyRow>
          </div>
        </>
      ) : null}
      <p className="inspector-hint">Media paint is visual-only and always muted.</p>
      {supportsNonRealTime ? (
        <p className="inspector-playout-warning" role="status">
          ⚠ The initial Media paint runtime is real-time-only. Disable Non-real-time before
          certification or export.
        </p>
      ) : null}
    </div>
  );
}
