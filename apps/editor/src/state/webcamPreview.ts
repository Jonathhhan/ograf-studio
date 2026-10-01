import { LIVE_MEDIA_ELEMENT_TAG } from '@ograf-editor/scene-model';

export interface WebcamPreviewState {
  status: 'idle' | 'starting' | 'running' | 'error';
  tag: string | null;
  presentation: boolean;
  deviceId: string;
  devices: Array<{ deviceId: string; label: string }>;
  error: string | null;
}

const idle: WebcamPreviewState = {
  status: 'idle',
  tag: null,
  presentation: false,
  deviceId: '',
  devices: [],
  error: null,
};

let state = idle;
let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;
let captureWindow: (Window & typeof globalThis) | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const adapterConstructors = new WeakMap<CustomElementRegistry, CustomElementConstructor>();

function publish(patch: Partial<WebcamPreviewState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function releaseMedia(): void {
  captureWindow?.removeEventListener?.('pagehide', stopWebcamPreview);
  captureWindow = null;
  if (video) {
    video.pause();
    video.srcObject = null;
    video = null;
  }
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

export function subscribeWebcamPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWebcamPreviewState(): WebcamPreviewState {
  return state;
}

export function getWebcamPreviewFrame(tag: string): HTMLVideoElement | null {
  return state.status === 'running' &&
    state.tag === tag &&
    video &&
    video.readyState >= 2 &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
    ? video
    : null;
}

export function getWebcamPresentationStream(): MediaStream | null {
  return state.status === 'running' && state.presentation ? stream : null;
}

export function stopWebcamPreview(): void {
  generation++;
  releaseMedia();
  publish({ status: 'idle', tag: null, presentation: false, error: null });
}

export function stopLiveWebcamPreview(): void {
  if (state.presentation) publish({ tag: null });
  else stopWebcamPreview();
}

export function stopWebcamPresentation(): void {
  if (state.tag) publish({ presentation: false });
  else stopWebcamPreview();
}

export async function startWebcamPreview(
  tag: string,
  deviceId = '',
  ownerWindow: Window & typeof globalThis = globalThis as Window & typeof globalThis,
): Promise<void> {
  const sourceTag = tag.trim();
  if (!sourceTag) {
    publish({ status: 'error', error: 'Enter a live tag before starting the webcam.' });
    return;
  }
  if (!registerWebcamPreviewAdapter()) {
    publish({
      status: 'error',
      error: 'Another live-media adapter is already registered in this browser tab.',
    });
    return;
  }
  if (
    state.status === 'running' &&
    stream &&
    deviceId === state.deviceId &&
    captureWindow === ownerWindow
  ) {
    publish({ tag: sourceTag, error: null });
    return;
  }
  await startCapture(sourceTag, state.presentation, deviceId, ownerWindow);
}

export async function startWebcamPresentation(
  deviceId = '',
  ownerWindow: Window & typeof globalThis = globalThis as Window & typeof globalThis,
): Promise<void> {
  if (
    state.status === 'running' &&
    stream &&
    deviceId === state.deviceId &&
    captureWindow === ownerWindow
  ) {
    publish({ presentation: true, error: null });
    return;
  }
  await startCapture(state.tag, true, deviceId, ownerWindow);
}

async function startCapture(
  tag: string | null,
  presentation: boolean,
  deviceId: string,
  ownerWindow: Window & typeof globalThis,
): Promise<void> {
  const request = ++generation;
  releaseMedia();
  captureWindow = ownerWindow;
  captureWindow.addEventListener?.('pagehide', stopWebcamPreview);
  publish({ status: 'starting', tag, presentation, deviceId, error: null });
  try {
    const mediaDevices = ownerWindow.navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia)
      throw new Error('Camera capture is unavailable. Open Studio on localhost or HTTPS.');
    const captured = await mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: false,
    });
    if (request !== generation) {
      captured.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = captured;
    const player = ownerWindow.document.createElement('video');
    player.muted = true;
    player.defaultMuted = true;
    player.playsInline = true;
    player.autoplay = true;
    player.srcObject = captured;
    video = player;
    await player.play();
    if (request !== generation) return;
    captured.getVideoTracks().forEach((track) =>
      track.addEventListener('ended', () => {
        if (stream === captured) stopWebcamPreview();
      }),
    );
    const devices = mediaDevices.enumerateDevices
      ? await mediaDevices.enumerateDevices().catch(() => [])
      : [];
    if (request !== generation) return;
    const cameras = (devices ?? [])
      .filter((candidate) => candidate.kind === 'videoinput')
      .map((candidate, index) => ({
        deviceId: candidate.deviceId,
        label: candidate.label || `Camera ${index + 1}`,
      }));
    publish({ status: 'running', devices: cameras, error: null });
  } catch (cause) {
    if (request !== generation) return;
    releaseMedia();
    publish({
      status: 'error',
      tag: null,
      presentation: false,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export function registerWebcamPreviewAdapter(
  registry?: CustomElementRegistry,
  elementBase?: typeof HTMLElement,
): boolean {
  const targetRegistry = registry ?? globalThis.customElements;
  const base = elementBase ?? globalThis.HTMLElement;
  if (!targetRegistry || !base) return false;
  const existing = targetRegistry.get(LIVE_MEDIA_ELEMENT_TAG);
  if (existing) return existing === adapterConstructors.get(targetRegistry);
  class StudioWebcamMediaElement extends base {
    getFrame(): HTMLVideoElement | null {
      return getWebcamPreviewFrame(this.dataset.sourceTag ?? '');
    }
  }
  adapterConstructors.set(targetRegistry, StudioWebcamMediaElement);
  targetRegistry.define(LIVE_MEDIA_ELEMENT_TAG, StudioWebcamMediaElement);
  return true;
}
