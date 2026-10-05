import { useEffect, useState, useSyncExternalStore } from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import {
  getWebcamPreviewState,
  startWebcamPreview,
  startWebcamPresentation,
  stopLiveWebcamPreview,
  stopWebcamPresentation,
  subscribeWebcamPreview,
} from '../state/webcamPreview';
import './WebcamPreviewControls.css';

export function WebcamPreviewControls({
  tag,
  presentation = false,
  disabled = false,
}: {
  tag?: string;
  presentation?: boolean;
  disabled?: boolean;
}) {
  const { window } = useEditorWindow();
  const webcam = useSyncExternalStore(subscribeWebcamPreview, getWebcamPreviewState);
  const [deviceId, setDeviceId] = useState('');
  useEffect(() => setDeviceId(webcam.deviceId), [webcam.deviceId]);
  const activeHere =
    webcam.status === 'running' &&
    (presentation ? webcam.presentation : webcam.tag === (tag ?? '').trim());

  return (
    <div className="webcam-preview-controls">
      <span>Webcam preview · local only, video muted</span>
      <div className="webcam-preview-controls-row">
        {webcam.devices.length > 1 ? (
          <select
            aria-label="Preview camera"
            value={deviceId}
            disabled={disabled || webcam.status === 'starting'}
            onChange={(event) => setDeviceId(event.target.value)}
          >
            <option value="">Default camera</option>
            {webcam.devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          disabled={disabled || (!presentation && !tag?.trim()) || webcam.status === 'starting'}
          onClick={() => {
            if (activeHere && webcam.deviceId === deviceId) {
              if (presentation) stopWebcamPresentation();
              else stopLiveWebcamPreview();
            } else if (presentation) void startWebcamPresentation(deviceId, window);
            else void startWebcamPreview(tag ?? '', deviceId, window);
          }}
        >
          {webcam.status === 'starting'
            ? 'Starting camera…'
            : activeHere && webcam.deviceId === deviceId
              ? presentation
                ? 'Stop background webcam'
                : 'Stop live webcam'
              : activeHere
                ? 'Switch camera'
                : webcam.status === 'running'
                  ? 'Use webcam here'
                  : 'Start webcam'}
        </button>
      </div>
      {webcam.status === 'running' && !activeHere ? (
        <small>
          Webcam is currently previewing{' '}
          {webcam.tag ? `live tag “${webcam.tag}”` : 'the presentation background'}.
        </small>
      ) : null}
      {webcam.error ? <small role="alert">{webcam.error}</small> : null}
      <small>
        Camera permission is requested only when you press Start. Nothing is saved or exported.
      </small>
    </div>
  );
}
