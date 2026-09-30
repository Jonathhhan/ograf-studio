import { CANVAS_LAYOUT_HELP } from './propertyHelp';
import { WithWarning } from '../components/WarningBadge';
import { PropertyRow } from '../components/PropertyRow';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { WebcamPreviewControls } from '../components/WebcamPreviewControls';
import { useRef, useState } from 'react';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { colorPickerValue } from '../canvas/compositionBackground';
import { COMPOSITION_PRESETS, matchesCompositionPreset } from './compositionPresets';
import { FrameDurationControl } from './FrameDurationControl';
import {
  getPlayoutCompatibilityWarnings,
  type CanvasPresentationBackground,
} from '@ograf-editor/scene-model';
import { PropertiesFilter } from './PropertiesFilter';
import { usePropertiesFilter } from './propertiesFilterLogic';

const MAX_PRESENTATION_IMAGE_BYTES = 10 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read the selected image.'));
    reader.readAsDataURL(file);
  });
}

export function CompositionSettings({
  filter,
  onFilterChange,
}: {
  filter: string;
  onFilterChange: (value: string) => void;
}) {
  const inspectorRef = useRef<HTMLDivElement>(null);
  usePropertiesFilter(inspectorRef, filter);
  const presentationImageInputRef = useRef<HTMLInputElement>(null);
  const [presentationImageError, setPresentationImageError] = useState('');
  const composition = useActiveComposition();
  const project = useProjectStore((s) => s.project);
  const setProjectMeta = useProjectStore((s) => s.setProjectMeta);
  const update = useProjectStore((s) => s.updateCompositionSettings);
  const updateLayout = useProjectStore((s) => s.updateCompositionLayout);
  const addGuide = useProjectStore((s) => s.addCanvasGuide);
  const updateGuide = useProjectStore((s) => s.updateCanvasGuide);
  const removeGuide = useProjectStore((s) => s.removeCanvasGuide);

  const activePresetIndex = COMPOSITION_PRESETS.findIndex((preset) =>
    matchesCompositionPreset(preset, composition.width, composition.height, composition.frameRate),
  );
  const isTransparent = composition.backgroundColor === 'transparent';
  const pickerColor = colorPickerValue(composition.backgroundColor);
  const presentationImageSource = composition.layout.presentationBackgroundImageSource;
  const presentationImageIsEmbedded = presentationImageSource.startsWith('data:image/');
  const playoutWarnings = getPlayoutCompatibilityWarnings(project, composition);
  const nonRealtimeWarning = playoutWarnings.find(
    (warning) => warning.id === 'davinci-resolve-non-realtime',
  );
  const backgroundWarning = playoutWarnings.find(
    (warning) => warning.id === 'opaque-composition-background',
  );

  const importPresentationImage = async (file: File | undefined) => {
    if (!file) return;
    setPresentationImageError('');
    if (!file.type.startsWith('image/')) {
      setPresentationImageError('Choose a supported image file.');
      return;
    }
    if (file.size > MAX_PRESENTATION_IMAGE_BYTES) {
      setPresentationImageError('The presentation image must be 10 MB or smaller.');
      return;
    }
    try {
      updateLayout({
        presentationBackground: 'still-image',
        presentationBackgroundImageSource: await readFileAsDataUrl(file),
        presentationBackgroundImageName: file.name,
      });
    } catch (error) {
      setPresentationImageError(
        error instanceof Error ? error.message : 'Failed to read the selected image.',
      );
    }
  };

  return (
    <div className="inspector" ref={inspectorRef}>
      <PropertiesFilter value={filter} onChange={onFilterChange} />
      <p className="panel-placeholder">Nothing selected — editing composition settings.</p>

      <CollapsibleSection sectionId="properties.composition" title="Composition">
        <PropertyRow
          help={
            'Name of this composition in the project. This does not change text displayed by any layer.'
          }
          className="inspector-row"
        >
          <span>Name</span>
          <input
            type="text"
            value={composition.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </PropertyRow>

        <PropertyRow
          help={
            'Apply a standard canvas resolution and frame rate together. Choose Custom dimensions by editing Width, Height or Frame rate.'
          }
          className="inspector-row"
        >
          <span>Preset</span>
          <select
            value={activePresetIndex}
            onChange={(e) => {
              const preset = COMPOSITION_PRESETS[Number(e.target.value)];
              if (preset)
                update({ width: preset.width, height: preset.height, frameRate: preset.frameRate });
            }}
          >
            {activePresetIndex === -1 && <option value={-1}>Custom</option>}
            {COMPOSITION_PRESETS.map((preset, i) => (
              <option key={preset.label} value={i}>
                {preset.label}
              </option>
            ))}
          </select>
        </PropertyRow>

        <div className="inspector-grid">
          <PropertyRow
            help={
              'Width of the output canvas in pixels. Layer constraints determine how layers respond when the canvas size changes.'
            }
            className="inspector-row"
          >
            <span>Width</span>
            <input
              type="number"
              min={1}
              value={composition.width}
              onChange={(e) => update({ width: Number(e.target.value) })}
            />
          </PropertyRow>
          <PropertyRow
            help={
              'Height of the output canvas in pixels. Layer constraints determine how layers respond when the canvas size changes.'
            }
            className="inspector-row"
          >
            <span>Height</span>
            <input
              type="number"
              min={1}
              value={composition.height}
              onChange={(e) => update({ height: Number(e.target.value) })}
            />
          </PropertyRow>
        </div>

        <PropertyRow
          help={
            'Frames per second used by the timeline and exported graphic. This determines how frame durations convert to seconds.'
          }
          className="inspector-row"
        >
          <span>Frame rate</span>
          <input
            type="number"
            min={1}
            step="any"
            value={Number(composition.frameRate.toFixed(3))}
            onChange={(e) => update({ frameRate: Number(e.target.value) })}
          />
        </PropertyRow>
        <FrameDurationControl
          propertyColumns
          label="Data change fade"
          frames={composition.updateTransitionFrames}
          frameRate={composition.frameRate}
          minFrames={0}
          onChange={(updateTransitionFrames) => update({ updateTransitionFrames })}
        />
        <PropertyRow
          help="What happens when new data arrives while the previous change is still fading: finish that fade first, or jump straight to the newest data."
          className="inspector-row"
        >
          <span>Data arrives mid-fade</span>
          <select
            value={composition.updateInterruption ?? 'queue'}
            onChange={(event) =>
              update({ updateInterruption: event.target.value as 'queue' | 'replace' })
            }
          >
            <option value="queue">Finish current fade first</option>
            <option value="replace">Jump to newest data</option>
          </select>
        </PropertyRow>
      </CollapsibleSection>

      <CollapsibleSection sectionId="properties.render-modes" title="Render modes">
        <PropertyRow
          help={
            'Declare support for real-time playback, where the graphic advances using the playback clock.'
          }
          className="inspector-row inspector-checkbox-row"
        >
          <span>Real-time</span>
          <input
            type="checkbox"
            checked={project.supportsRealTime}
            onChange={(event) => setProjectMeta({ supportsRealTime: event.target.checked })}
          />
        </PropertyRow>
        <PropertyRow
          help={
            'Declare support for deterministic, time-addressed playback so a renderer can request an exact point in the animation.'
          }
          className="inspector-row inspector-checkbox-row"
        >
          <span>Non-real-time</span>
          <WithWarning message={nonRealtimeWarning?.message}>
            <input
              type="checkbox"
              checked={project.supportsNonRealTime}
              onChange={(event) => setProjectMeta({ supportsNonRealTime: event.target.checked })}
            />
          </WithWarning>
        </PropertyRow>
      </CollapsibleSection>

      <CollapsibleSection sectionId="properties.background" title="Background">
        <PropertyRow
          help={
            'Export the canvas background with transparency so the graphic can be placed over video. The checkerboard is only an editor preview.'
          }
          className="inspector-row"
        >
          <span>Transparent output</span>
          <WithWarning message={backgroundWarning?.message}>
            <input
              type="checkbox"
              checked={isTransparent}
              onChange={(e) =>
                update({ backgroundColor: e.target.checked ? 'transparent' : '#000000' })
              }
            />
          </WithWarning>
        </PropertyRow>
        <PropertyRow
          help={
            'Background color of the output canvas. Choosing a color switches the composition from transparent to opaque output.'
          }
          className="inspector-row inspector-background-color"
        >
          <span>Color</span>
          <input
            type="color"
            value={pickerColor}
            onInput={(e) => update({ backgroundColor: e.currentTarget.value })}
          />
        </PropertyRow>
        {isTransparent && (
          <p className="inspector-hint">
            The checkerboard is editor-only and will not be exported. Choosing a color switches to
            an opaque background.
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection sectionId="properties.canvas-layout" title="Canvas layout">
        {(
          [
            ['showRulers', 'Rulers'],
            ['showActionSafe', 'Action safe · EBU R 95 (3.5%)'],
            ['showTitleSafe', 'Title safe · EBU R 95 (5%)'],
            ['showCenterMarker', 'Center marker'],
            ['dimOutsideCanvas', 'Outside canvas · 20% gray'],
            ['snappingEnabled', 'Snapping'],
            ['snapToGrid', 'Snap to grid'],
            ['snapToGuides', 'Snap to guides'],
            ['snapToLayers', 'Snap to layers'],
          ] as const
        ).map(([key, label]) => (
          <PropertyRow
            help={CANVAS_LAYOUT_HELP[key]}
            className="inspector-row inspector-checkbox-row"
            key={key}
          >
            <span>{label}</span>
            <input
              type="checkbox"
              checked={composition.layout[key]}
              onChange={(event) => updateLayout({ [key]: event.target.checked })}
            />
          </PropertyRow>
        ))}
        <PropertyRow
          help={
            'Choose a video, still image, or local webcam behind the graphic. Presentation backgrounds are editor-only and are not exported.'
          }
          className="inspector-row"
        >
          <span>Presentation background</span>
          <select
            value={composition.layout.presentationBackground}
            onChange={(event) =>
              updateLayout({
                presentationBackground: event.target.value as CanvasPresentationBackground,
              })
            }
          >
            <option value="none">None</option>
            <option value="big-buck-bunny">Big Buck Bunny · looping video</option>
            <option value="still-image">Still image</option>
            <option value="webcam">Webcam · local preview</option>
          </select>
        </PropertyRow>
        {composition.layout.presentationBackground === 'webcam' ? (
          <div className="inspector-presentation-background-controls">
            <WebcamPreviewControls presentation />
            <p className="inspector-hint">
              Start the camera to preview your transparent graphic over live video. Only the
              background choice is saved; camera selection and frames are never exported.
            </p>
          </div>
        ) : null}
        {composition.layout.presentationBackground === 'big-buck-bunny' ? (
          <p className="inspector-hint">
            Editor-only video bed; use Transparent output to see it through the composition. Big
            Buck Bunny © 2008 Blender Foundation,{' '}
            <a href="https://peach.blender.org/about/" target="_blank" rel="noreferrer">
              CC BY 3.0
            </a>
            .
          </p>
        ) : null}
        {composition.layout.presentationBackground === 'still-image' ? (
          <div className="inspector-presentation-background-controls">
            <PropertyRow
              help={
                'URL of the still image used behind the canvas for preview. It is an editor-only presentation background, not a graphic layer.'
              }
              className="inspector-row inspector-row-stacked"
            >
              <span>Image URL</span>
              <input
                type="url"
                value={presentationImageIsEmbedded ? '' : presentationImageSource}
                placeholder="https://example.com/background.jpg"
                onChange={(event) => {
                  setPresentationImageError('');
                  updateLayout({
                    presentationBackgroundImageSource: event.target.value,
                    presentationBackgroundImageName: '',
                  });
                }}
              />
            </PropertyRow>
            <div className="inspector-button-row">
              <button type="button" onClick={() => presentationImageInputRef.current?.click()}>
                Choose local image…
              </button>
              {presentationImageSource ? (
                <button
                  type="button"
                  onClick={() => {
                    setPresentationImageError('');
                    updateLayout({
                      presentationBackgroundImageSource: '',
                      presentationBackgroundImageName: '',
                    });
                  }}
                >
                  Clear
                </button>
              ) : null}
              <input
                ref={presentationImageInputRef}
                className="inspector-file-input"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  void importPresentationImage(file);
                }}
              />
            </div>
            <p className="inspector-hint">
              {presentationImageIsEmbedded
                ? `${composition.layout.presentationBackgroundImageName || 'Local image'} is embedded in this .ogs project.`
                : presentationImageSource
                  ? 'Using the image URL above.'
                  : 'Enter an image URL or choose a local image up to 10 MB.'}{' '}
              This background is editor-only and is not exported.
            </p>
            {presentationImageError ? (
              <p className="inspector-error">{presentationImageError}</p>
            ) : null}
          </div>
        ) : null}
        <div className="inspector-grid">
          <PropertyRow
            help={
              'Grid spacing in composition pixels. Snap to grid uses this interval when snapping is enabled.'
            }
            className="inspector-row"
          >
            <span>Grid</span>
            <input
              type="number"
              min={1}
              value={composition.layout.gridSize}
              onChange={(event) => updateLayout({ gridSize: Number(event.target.value) })}
            />
          </PropertyRow>
          <PropertyRow
            help={
              'Maximum distance in composition pixels at which a nearby snapping target attracts a layer. Larger values make snapping easier to trigger.'
            }
            className="inspector-row"
          >
            <span>Threshold</span>
            <input
              type="number"
              min={0}
              value={composition.layout.snapThreshold}
              onChange={(event) => updateLayout({ snapThreshold: Number(event.target.value) })}
            />
          </PropertyRow>
        </div>
        <PropertyRow
          help={
            'Choose whether editing may move layers outside the canvas or should keep them contained within its bounds.'
          }
          className="inspector-row"
        >
          <span>Bounds</span>
          <select
            value={composition.layout.boundsMode}
            onChange={(event) =>
              updateLayout({ boundsMode: event.target.value as 'allow' | 'contain' })
            }
          >
            <option value="allow">Allow outside</option>
            <option value="contain">Contain in canvas</option>
          </select>
        </PropertyRow>
        <PropertyRow
          help={
            'Choose whether the editor shows objects outside the canvas or clips them at its edge. The exported output still uses the composition dimensions.'
          }
          className="inspector-row"
        >
          <span>Overflow preview</span>
          <select
            value={composition.layout.overflowPreview}
            onChange={(event) =>
              updateLayout({ overflowPreview: event.target.value as 'visible' | 'clip' })
            }
          >
            <option value="visible">Show pasteboard objects</option>
            <option value="clip">Clip to canvas</option>
          </select>
        </PropertyRow>
      </CollapsibleSection>

      <CollapsibleSection
        sectionId="properties.guides"
        title="Guides"
        actions={
          <>
            <button type="button" onClick={() => addGuide('vertical')}>
              + Vertical
            </button>
            <button type="button" onClick={() => addGuide('horizontal')}>
              + Horizontal
            </button>
          </>
        }
      >
        {composition.layout.guides.map((guide) => (
          <PropertyRow
            help={`Position of this ${guide.axis} guide in canvas pixels, measured from the ${guide.axis === 'vertical' ? 'left' : 'top'} edge. Guides are editor-only alignment and snapping aids.`}
            className="inspector-row"
            key={guide.id}
          >
            <span>{guide.axis === 'vertical' ? 'V' : 'H'}</span>
            <input
              type="number"
              value={guide.position}
              onChange={(event) => updateGuide(guide.id, Number(event.target.value))}
            />
            <button type="button" title="Remove guide" onClick={() => removeGuide(guide.id)}>
              ×
            </button>
          </PropertyRow>
        ))}
      </CollapsibleSection>
    </div>
  );
}
