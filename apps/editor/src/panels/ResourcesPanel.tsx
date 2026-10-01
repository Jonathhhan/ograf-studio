import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  findAssetConsumers,
  findMissingAssetReferences,
  isSafePackagePath,
  type Asset,
  type Composition,
  type MediaCue,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useSoundEventSelectionStore } from '../state/soundEventSelectionStore';
import { isSoundEventCue, soundEventSource } from '../state/soundEvents';
import { ResourceTreeBranch, ResourceTreeItem } from './ResourceTreeComponents';
import { Panel } from './Panel';
import { PatternResources } from './PatternResources';
import { MediaCueEditor } from './MediaCueEditor';
import { SoundEventEditor } from './SoundEventEditor';
import { ShaderResources } from './ShaderResources';
import { partitionResourceAssets } from './resourceTree';
import './ResourcesPanel.css';
import { useImagePlacement } from '../state/useImagePlacement';
import {
  AUDIO_FILE_ACCEPT,
  MEDIA_FILE_ACCEPT,
  audioFileBatchImportError,
  mediaFileBatchImportError,
  type MediaImportStatus,
} from './mediaFileImport';

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function mediaCueTriggerLabel(cue: MediaCue, composition: Composition) {
  const trigger = cue.trigger;
  if (trigger.type === 'lifecycle') {
    const keyframe = composition.keyframes.find((candidate) => candidate.id === trigger.keyframeId);
    return `Keyframe: ${keyframe?.name ?? 'Missing'}`;
  }
  if (trigger.type === 'timeline') return `Frame ${trigger.startFrame}`;
  if (trigger.type === 'customAction') return `Action: ${trigger.actionId}`;
  return 'Manual';
}

export function ResourcesPanel() {
  const imagePlacement = useImagePlacement();
  const composition = useActiveComposition();
  const importAsset = useProjectStore((s) => s.importAsset);
  const importSvgBundle = useProjectStore((s) => s.importSvgBundle);
  const updateAsset = useProjectStore((s) => s.updateAsset);
  const removeAsset = useProjectStore((s) => s.removeAsset);
  const addMediaCueFromAsset = useProjectStore((s) => s.addMediaCueFromAsset);
  const addSoundEventFromAsset = useProjectStore((s) => s.addSoundEventFromAsset);
  const addLiveMediaCue = useProjectStore((s) => s.addLiveMediaCue);
  const createComponent = useProjectStore((s) => s.createComponent);
  const instantiateComponent = useProjectStore((s) => s.instantiateComponent);
  const updateComponentFromLayers = useProjectStore((s) => s.updateComponentFromLayers);
  const refreshLinkedComponentInstances = useProjectStore((s) => s.refreshLinkedComponentInstances);
  const renameComponent = useProjectStore((s) => s.renameComponent);
  const removeComponent = useProjectStore((s) => s.removeComponent);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const selectSoundEvent = useSoundEventSelectionStore((s) => s.selectSoundEvent);
  const [svgImportStatus, setSvgImportStatus] = useState<string | null>(null);
  const [mediaImportStatus, setMediaImportStatus] = useState<MediaImportStatus | null>(null);
  const [audioImportStatus, setAudioImportStatus] = useState<MediaImportStatus | null>(null);
  const [previewingAudioAssetId, setPreviewingAudioAssetId] = useState<string | null>(null);
  const [audioPreviewError, setAudioPreviewError] = useState<string | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const missingReferences = useMemo(() => findMissingAssetReferences(composition), [composition]);
  const assetsByKind = useMemo(
    () => partitionResourceAssets(composition.assets),
    [composition.assets],
  );
  const imageAssets = assetsByKind.images;
  const mediaAssets = assetsByKind.media;
  const audioAssets = assetsByKind.audio;
  const fontAssets = assetsByKind.fonts;
  const sourceAssets = assetsByKind.sources;
  const soundEvents = (composition.mediaCues ?? []).filter(isSoundEventCue);
  const mediaCues = (composition.mediaCues ?? []).filter((cue) => !isSoundEventCue(cue));

  const stopAudioPreview = () => {
    const audio = audioPreviewRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
      audioPreviewRef.current = null;
    }
    setPreviewingAudioAssetId(null);
  };

  const toggleAudioPreview = (asset: Asset) => {
    if (previewingAudioAssetId === asset.id) {
      stopAudioPreview();
      return;
    }
    stopAudioPreview();
    setAudioPreviewError(null);
    const audio = new Audio(asset.dataUri);
    audio.preload = 'auto';
    audio.onended = () => {
      audioPreviewRef.current = null;
      setPreviewingAudioAssetId(null);
    };
    audio.onerror = () => {
      audioPreviewRef.current = null;
      setPreviewingAudioAssetId(null);
      setAudioPreviewError(`Could not preview ${asset.name}.`);
    };
    audioPreviewRef.current = audio;
    setPreviewingAudioAssetId(asset.id);
    void audio.play().catch((cause: unknown) => {
      if (audioPreviewRef.current !== audio) return;
      audioPreviewRef.current = null;
      setPreviewingAudioAssetId(null);
      setAudioPreviewError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  useEffect(
    () => () => {
      const audio = audioPreviewRef.current;
      if (!audio) return;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    },
    [],
  );

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length === 0) return;
    if (files.some((file) => file.name.toLowerCase().endsWith('.svg'))) {
      setSvgImportStatus('Importing portable SVG bundle…');
      void importSvgBundle(files)
        .then(({ warnings }) => {
          setSvgImportStatus(
            warnings.length === 0
              ? 'SVG bundle imported with all selected resources embedded.'
              : `SVG imported with ${warnings.length} unresolved companion resource${warnings.length === 1 ? '' : 's'}: ${warnings.join(' ')}`,
          );
        })
        .catch((error: unknown) => {
          setSvgImportStatus(error instanceof Error ? error.message : String(error));
        });
    } else {
      for (const file of files) {
        void importAsset(file);
      }
      setSvgImportStatus(
        `${files.length} resource${files.length === 1 ? '' : 's'} imported; identical payloads reuse one registry entry.`,
      );
    }
  };

  const handleMediaFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    const problem = mediaFileBatchImportError(files);
    if (problem) {
      setMediaImportStatus({ kind: 'error', message: problem });
      return;
    }
    setMediaImportStatus({ kind: 'info', message: 'Importing video clips…' });
    void Promise.all(files.map((file) => importAsset(file)))
      .then(() =>
        setMediaImportStatus({
          kind: 'info',
          message: `${files.length} media clip${files.length === 1 ? '' : 's'} imported.`,
        }),
      )
      .catch((cause: unknown) =>
        setMediaImportStatus({
          kind: 'error',
          message:
            cause instanceof Error ? cause.message : 'The media clips could not be imported.',
        }),
      );
  };

  const handleAudioFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    const problem = audioFileBatchImportError(files);
    if (problem) {
      setAudioImportStatus({ kind: 'error', message: problem });
      return;
    }
    setAudioImportStatus({ kind: 'info', message: 'Importing audio clips…' });
    void Promise.all(files.map((file) => importAsset(file)))
      .then(() =>
        setAudioImportStatus({
          kind: 'info',
          message: `${files.length} audio clip${files.length === 1 ? '' : 's'} imported.`,
        }),
      )
      .catch((cause: unknown) =>
        setAudioImportStatus({
          kind: 'error',
          message:
            cause instanceof Error ? cause.message : 'The audio clips could not be imported.',
        }),
      );
  };

  const usageCount = (asset: Asset) => {
    const consumers = findAssetConsumers(composition, asset);
    return (
      consumers.layerIds.length +
      consumers.fieldIds.length +
      consumers.fontLayerIds.length +
      consumers.mediaCueIds.length
    );
  };
  const linkedInstanceCount = (componentId: string) =>
    new Set(
      composition.layers
        .filter((layer) => layer.componentLink?.componentId === componentId)
        .map((layer) => layer.componentLink!.instanceId),
    ).size;

  return (
    <Panel title="Resources">
      <div className="resources-panel">
        <div className="resources-tree" role="tree" aria-label="Project resources">
          <ShaderResources />
          <PatternResources />

          <ResourceTreeBranch label="Components" count={composition.components.length}>
            <div className="resources-tree-toolbar">
              <span>Reusable layer snapshots</span>
              <button
                type="button"
                disabled={selectedLayerIds.length === 0}
                onClick={() => createComponent(selectedLayerIds)}
              >
                + Save Selection
              </button>
            </div>
            {composition.components.length === 0 ? (
              <p className="panel-placeholder">No saved components.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {composition.components.map((component) => {
                  const linked = linkedInstanceCount(component.id);
                  return (
                    <ResourceTreeItem
                      key={component.id}
                      label={component.name}
                      meta={`${component.layers.length} layers · ${linked} linked`}
                      preview={<span className="resources-tree-item-icon">C</span>}
                    >
                      <input
                        aria-label="Component name"
                        value={component.name}
                        onChange={(event) => renameComponent(component.id, event.target.value)}
                      />
                      <div className="resources-tree-actions wrap">
                        <button
                          type="button"
                          onClick={() => selectMany(instantiateComponent(component.id))}
                        >
                          Insert
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            selectMany(instantiateComponent(component.id, undefined, true))
                          }
                        >
                          Link
                        </button>
                        <button
                          type="button"
                          disabled={selectedLayerIds.length === 0}
                          onClick={() => updateComponentFromLayers(component.id, selectedLayerIds)}
                        >
                          Update
                        </button>
                        <button
                          type="button"
                          disabled={linked === 0}
                          onClick={() => selectMany(refreshLinkedComponentInstances(component.id))}
                        >
                          Refresh {linked || ''}
                        </button>
                        <button
                          type="button"
                          className="data-table-delete"
                          onClick={() => removeComponent(component.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </ResourceTreeItem>
                  );
                })}
              </div>
            )}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Images" count={imageAssets.length}>
            <div className="resources-tree-toolbar">
              <span>Images and SVG bundles</span>
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                + Import
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.css,.ttf,.otf,.woff,.woff2"
                multiple
                className="resources-file-input"
                onChange={handleFileChange}
              />
            </div>
            {imageAssets.length === 0 ? (
              <p className="panel-placeholder">No images imported.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {imageAssets.map((asset) => {
                  const uses = usageCount(asset);
                  return (
                    <ResourceTreeItem
                      key={asset.id}
                      label={asset.name}
                      meta={`${formatBytes(asset.byteSize)} · ${uses} uses`}
                      preview={<img src={asset.dataUri} alt="" className="resources-asset-thumb" />}
                    >
                      <div className="resources-asset-fields">
                        <input
                          aria-label="Resource name"
                          value={asset.name}
                          onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                        />
                        <span className="resources-asset-meta">
                          {asset.originalFileName || asset.name} · {asset.mimeType}
                        </span>
                        <input
                          aria-label="Package path"
                          className={
                            !asset.packagePath || isSafePackagePath(asset.packagePath)
                              ? ''
                              : 'invalid'
                          }
                          placeholder={`assets/${asset.id}`}
                          value={asset.packagePath ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, { packagePath: event.target.value || undefined })
                          }
                        />
                        <div className="resources-tree-actions">
                          <span>{uses} use(s)</span>
                          <button
                            type="button"
                            disabled={imagePlacement.busy}
                            onClick={() => void imagePlacement.place({ assetId: asset.id })}
                          >
                            Add to canvas
                          </button>
                          <button
                            type="button"
                            className="data-table-delete"
                            disabled={uses > 0}
                            onClick={() => removeAsset(asset.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </ResourceTreeItem>
                  );
                })}
              </div>
            )}
            <p className="inspector-hint">Select SVG companion files together when importing.</p>
            {imagePlacement.error && (
              <p className="image-placement-error" role="alert">
                {imagePlacement.error}
              </p>
            )}
            {svgImportStatus && <p className="inspector-hint">{svgImportStatus}</p>}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Media" count={mediaAssets.length}>
            <div className="resources-tree-toolbar">
              <span>
                Playable sources · {mediaCues.length} playback cue
                {mediaCues.length === 1 ? '' : 's'}
              </span>
              <button type="button" onClick={() => mediaInputRef.current?.click()}>
                + Video
              </button>
              <button
                type="button"
                onClick={() => {
                  addLiveMediaCue();
                  useSelectionStore.getState().select(null);
                }}
              >
                + Live Cue
              </button>
              <input
                ref={mediaInputRef}
                type="file"
                accept={MEDIA_FILE_ACCEPT}
                multiple
                className="resources-file-input"
                onChange={handleMediaFileChange}
              />
            </div>
            {mediaImportStatus ? (
              <p
                className={
                  mediaImportStatus.kind === 'error' ? 'inspector-error' : 'inspector-hint'
                }
                role={mediaImportStatus.kind === 'error' ? 'alert' : 'status'}
              >
                {mediaImportStatus.message}
              </p>
            ) : null}
            {mediaCues.length > 0 ? (
              <div className="resources-media-cues" role="group" aria-label="Playback cues">
                <span className="resources-media-cues-heading">Playback cues</span>
                {mediaCues.map((cue) => {
                  const activeSource = cue.sources.find(
                    (source) => source.id === cue.activeSourceId,
                  );
                  return (
                    <ResourceTreeItem
                      key={cue.id}
                      label={cue.name}
                      meta={`${activeSource?.name ?? 'No source'} · ${mediaCueTriggerLabel(cue, composition)}`}
                      preview={
                        <span className="resources-tree-item-icon">
                          {activeSource?.kind === 'clip' && activeSource.mediaType === 'audio'
                            ? '♪'
                            : '▶'}
                        </span>
                      }
                    >
                      <MediaCueEditor cue={cue} />
                    </ResourceTreeItem>
                  );
                })}
              </div>
            ) : null}
            {mediaAssets.length === 0 ? (
              <p className="panel-placeholder">No video media imported.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {mediaAssets.map((asset) => {
                  const uses = usageCount(asset);
                  return (
                    <ResourceTreeItem
                      key={asset.id}
                      label={asset.name}
                      meta={`${formatBytes(asset.byteSize)} · ${uses} uses`}
                      preview={
                        <video
                          src={asset.dataUri}
                          className="resources-asset-thumb resources-media-thumb"
                          muted
                          playsInline
                          preload="metadata"
                        />
                      }
                    >
                      <div className="resources-asset-fields">
                        <input
                          aria-label="Media resource name"
                          value={asset.name}
                          onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                        />
                        <span className="resources-asset-meta">
                          {asset.originalFileName || asset.name} · {asset.mimeType}
                        </span>
                        <input
                          aria-label="Media package path"
                          className={
                            !asset.packagePath || isSafePackagePath(asset.packagePath)
                              ? ''
                              : 'invalid'
                          }
                          placeholder={`assets/${asset.id}`}
                          value={asset.packagePath ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, { packagePath: event.target.value || undefined })
                          }
                        />
                        <div className="resources-tree-actions">
                          <span>{uses} use(s)</span>
                          <button
                            type="button"
                            onClick={() => {
                              addMediaCueFromAsset(asset.id);
                              useSelectionStore.getState().select(null);
                            }}
                          >
                            Create Cue at Keyframe
                          </button>
                          <button
                            type="button"
                            className="data-table-delete"
                            disabled={uses > 0}
                            onClick={() => removeAsset(asset.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </ResourceTreeItem>
                  );
                })}
              </div>
            )}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Audio" count={audioAssets.length}>
            <div className="resources-tree-toolbar">
              <span>
                Sound effects · {soundEvents.length} event{soundEvents.length === 1 ? '' : 's'}
              </span>
              <button type="button" onClick={() => audioInputRef.current?.click()}>
                + Audio
              </button>
              <input
                ref={audioInputRef}
                type="file"
                accept={AUDIO_FILE_ACCEPT}
                multiple
                className="resources-file-input"
                onChange={handleAudioFileChange}
              />
            </div>
            <p className="inspector-hint">
              Drag an audio file onto the Timeline ruler, or add it at the playhead.
            </p>
            {audioPreviewError ? (
              <p className="inspector-error" role="alert">
                {audioPreviewError}
              </p>
            ) : null}
            {audioImportStatus ? (
              <p
                className={
                  audioImportStatus.kind === 'error' ? 'inspector-error' : 'inspector-hint'
                }
                role={audioImportStatus.kind === 'error' ? 'alert' : 'status'}
              >
                {audioImportStatus.message}
              </p>
            ) : null}
            {soundEvents.length > 0 ? (
              <div className="resources-media-cues" role="group" aria-label="Sound Events">
                <span className="resources-media-cues-heading">Sound Events</span>
                {soundEvents.map((cue) => {
                  const source = soundEventSource(cue);
                  const frame = cue.trigger.type === 'timeline' ? cue.trigger.startFrame : 0;
                  return (
                    <ResourceTreeItem
                      key={cue.id}
                      label={cue.name}
                      meta={`${source?.name ?? 'No audio'} · Frame ${frame}`}
                      preview={<span className="resources-tree-item-icon">🔊</span>}
                    >
                      <SoundEventEditor cue={cue} />
                    </ResourceTreeItem>
                  );
                })}
              </div>
            ) : null}
            {audioAssets.length === 0 ? (
              <p className="panel-placeholder">No audio imported.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {audioAssets.map((asset) => {
                  const uses = usageCount(asset);
                  return (
                    <div
                      className="resources-audio-drag-source"
                      draggable
                      key={asset.id}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'copy';
                        event.dataTransfer.setData('application/x-ograf-audio-asset-id', asset.id);
                      }}
                    >
                      <ResourceTreeItem
                        label={asset.name}
                        meta={`${formatBytes(asset.byteSize)} · ${uses} uses`}
                        preview={<span className="resources-tree-item-icon">♪</span>}
                      >
                        <div className="resources-asset-fields">
                          <input
                            aria-label="Audio resource name"
                            value={asset.name}
                            onChange={(event) =>
                              updateAsset(asset.id, { name: event.target.value })
                            }
                          />
                          <span className="resources-asset-meta">
                            {asset.originalFileName || asset.name} · {asset.mimeType}
                          </span>
                          <div className="resources-tree-actions wrap">
                            <span>{uses} use(s)</span>
                            <button
                              type="button"
                              draggable={false}
                              aria-label={`${previewingAudioAssetId === asset.id ? 'Stop' : 'Play'} preview of ${asset.name}`}
                              onClick={() => toggleAudioPreview(asset)}
                            >
                              {previewingAudioAssetId === asset.id ? '■ Stop' : '▶ Play'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const cueId = addSoundEventFromAsset(asset.id);
                                selectSoundEvent(cueId);
                                useSelectionStore.getState().select(null);
                              }}
                            >
                              Add at Playhead
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                addMediaCueFromAsset(asset.id);
                                useSelectionStore.getState().select(null);
                              }}
                            >
                              Create Playback Cue
                            </button>
                            <button
                              type="button"
                              className="data-table-delete"
                              disabled={uses > 0}
                              onClick={() => removeAsset(asset.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </ResourceTreeItem>
                    </div>
                  );
                })}
              </div>
            )}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Fonts" count={fontAssets.length}>
            <div className="resources-tree-toolbar">
              <span>Packaged font faces</span>
              <button type="button" onClick={() => fontInputRef.current?.click()}>
                + Import
              </button>
              <input
                ref={fontInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                className="resources-file-input"
                onChange={handleFileChange}
              />
            </div>
            {fontAssets.length === 0 ? (
              <p className="panel-placeholder">No fonts imported.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {fontAssets.map((asset) => {
                  const uses = usageCount(asset);
                  return (
                    <ResourceTreeItem
                      key={asset.id}
                      label={asset.name}
                      meta={`${asset.fontFamily || 'Unassigned family'} · ${uses} uses`}
                      preview={
                        <span
                          className="resources-tree-font-preview"
                          title={`Template font: ${asset.fontFamily || asset.name}`}
                        >
                          Aa
                        </span>
                      }
                    >
                      <div className="resources-asset-fields">
                        <input
                          aria-label="Resource name"
                          value={asset.name}
                          onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                        />
                        <span className="resources-asset-meta">
                          {asset.originalFileName || asset.name} · {formatBytes(asset.byteSize)}
                        </span>
                        <input
                          aria-label="Font family"
                          placeholder="Font family"
                          value={asset.fontFamily ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, { fontFamily: event.target.value })
                          }
                        />
                        <div className="resources-asset-inline">
                          <input
                            aria-label="Font weight"
                            placeholder="100 900"
                            value={asset.fontWeight ?? ''}
                            onChange={(event) =>
                              updateAsset(asset.id, { fontWeight: event.target.value })
                            }
                          />
                          <select
                            aria-label="Font style"
                            value={asset.fontStyle ?? 'normal'}
                            onChange={(event) =>
                              updateAsset(asset.id, {
                                fontStyle: event.target.value as Asset['fontStyle'],
                              })
                            }
                          >
                            <option value="normal">Normal</option>
                            <option value="italic">Italic</option>
                            <option value="oblique">Oblique</option>
                          </select>
                        </div>
                        <input
                          aria-label="Package path"
                          className={
                            !asset.packagePath || isSafePackagePath(asset.packagePath)
                              ? ''
                              : 'invalid'
                          }
                          placeholder={`assets/${asset.id}`}
                          value={asset.packagePath ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, { packagePath: event.target.value || undefined })
                          }
                        />
                        <input
                          aria-label="Font license name"
                          placeholder="License name, e.g. OFL-1.1"
                          value={asset.licenseName ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, { licenseName: event.target.value })
                          }
                        />
                        <input
                          aria-label="Font license URL"
                          placeholder="License URL"
                          value={asset.licenseUrl ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, { licenseUrl: event.target.value })
                          }
                        />
                        <textarea
                          aria-label="Font license text"
                          rows={2}
                          placeholder="Optional license text packaged under licenses/"
                          value={asset.licenseText ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, { licenseText: event.target.value })
                          }
                        />
                        <div className="resources-tree-actions">
                          <span>{uses} use(s)</span>
                          <button
                            type="button"
                            className="data-table-delete"
                            disabled={uses > 0}
                            onClick={() => removeAsset(asset.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </ResourceTreeItem>
                  );
                })}
              </div>
            )}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Source attachments" count={sourceAssets.length}>
            <div className="resources-tree-toolbar">
              <span>CSS, JSON and source references</span>
              <button type="button" onClick={() => sourceInputRef.current?.click()}>
                + Attach
              </button>
              <input
                ref={sourceInputRef}
                type="file"
                accept=".css,.json,.txt,.md,.xml,.license,text/*,application/json"
                multiple
                className="resources-file-input"
                onChange={handleFileChange}
              />
            </div>
            {sourceAssets.length === 0 ? (
              <p className="panel-placeholder">No source documents attached.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {sourceAssets.map((asset) => (
                  <ResourceTreeItem
                    key={asset.id}
                    label={asset.name}
                    meta={`${asset.mimeType} · ${formatBytes(asset.byteSize)}`}
                    preview={<span className="resources-tree-item-icon">S</span>}
                  >
                    <div className="resources-asset-fields">
                      <input
                        aria-label="Resource name"
                        value={asset.name}
                        onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                      />
                      <span className="resources-asset-meta">
                        {asset.originalFileName || asset.name} · {asset.mimeType}
                      </span>
                      <input
                        aria-label="Package path"
                        className={
                          !asset.packagePath || isSafePackagePath(asset.packagePath)
                            ? ''
                            : 'invalid'
                        }
                        placeholder={`assets/${asset.id}`}
                        value={asset.packagePath ?? ''}
                        onChange={(event) =>
                          updateAsset(asset.id, { packagePath: event.target.value || undefined })
                        }
                      />
                      <div className="resources-tree-actions">
                        <span>{formatBytes(asset.byteSize)}</span>
                        <button
                          type="button"
                          className="data-table-delete"
                          onClick={() => removeAsset(asset.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </ResourceTreeItem>
                ))}
              </div>
            )}
          </ResourceTreeBranch>
        </div>

        {missingReferences.length > 0 && (
          <p className="resources-asset-warning" role="alert">
            Missing resources: {missingReferences.join(', ')}
          </p>
        )}
      </div>
    </Panel>
  );
}
