import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWebcamPreviewFrame,
  getWebcamPresentationStream,
  getWebcamPreviewState,
  registerWebcamPreviewAdapter,
  startWebcamPresentation,
  startWebcamPreview,
  stopLiveWebcamPreview,
  stopWebcamPresentation,
  stopWebcamPreview,
} from './webcamPreview';

describe('local webcam preview adapter', () => {
  const stop = vi.fn();
  const getUserMedia = vi.fn();
  const play = vi.fn(async () => {});
  const registered = new Map<string, CustomElementConstructor>();
  const player = {
    readyState: 2,
    videoWidth: 1280,
    videoHeight: 720,
    srcObject: null as MediaStream | null,
    play,
    pause: vi.fn(),
    muted: false,
    defaultMuted: false,
    playsInline: false,
    autoplay: false,
  };

  beforeEach(() => {
    stopWebcamPreview();
    stop.mockClear();
    getUserMedia.mockReset();
    play.mockClear();
    player.srcObject = null;
    registered.clear();
    vi.stubGlobal(
      'HTMLElement',
      class {
        dataset: Record<string, string> = {};
      },
    );
    vi.stubGlobal('customElements', {
      get: (name: string) => registered.get(name),
      define: (name: string, constructor: CustomElementConstructor) => {
        registered.set(name, constructor);
      },
    });
    vi.stubGlobal('document', { createElement: () => player });
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia,
        enumerateDevices: vi.fn(async () => [
          { kind: 'videoinput', deviceId: 'cam-1', label: 'Desk camera' },
          { kind: 'videoinput', deviceId: 'cam-2', label: 'USB camera' },
        ]),
      },
    });
  });

  afterEach(() => {
    stopWebcamPreview();
    vi.unstubAllGlobals();
  });

  function camera() {
    const track = { stop, addEventListener: vi.fn() };
    return {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
  }

  it('does not request permission until Start and serves only the selected tag', async () => {
    expect(registerWebcamPreviewAdapter()).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    getUserMedia.mockResolvedValue(camera());

    await startWebcamPreview('camera.program');
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(player.muted).toBe(true);
    expect(getWebcamPreviewFrame('camera.program')).toBe(player);
    expect(getWebcamPreviewFrame('other.camera')).toBeNull();
    const detached = new Map<string, CustomElementConstructor>();
    const registry = {
      get: (name: string) => detached.get(name),
      define: (name: string, constructor: CustomElementConstructor) => {
        detached.set(name, constructor);
      },
    } as CustomElementRegistry;
    expect(registerWebcamPreviewAdapter(registry, HTMLElement)).toBe(true);
    const hook = new (
      detached.get('zd-ograf-media') as CustomElementConstructor
    )() as HTMLElement & {
      getFrame(): HTMLVideoElement | null;
    };
    hook.dataset.sourceTag = 'camera.program';
    expect(hook.getFrame()).toBe(player);
    expect(getWebcamPreviewState()).toMatchObject({
      status: 'running',
      tag: 'camera.program',
      devices: [
        { deviceId: 'cam-1', label: 'Desk camera' },
        { deviceId: 'cam-2', label: 'USB camera' },
      ],
    });

    stopWebcamPreview();
    expect(stop).toHaveBeenCalledOnce();
    expect(player.srcObject).toBeNull();
    expect(getWebcamPreviewFrame('camera.program')).toBeNull();
  });

  it('switches camera using a device ID and releases the old stream', async () => {
    getUserMedia.mockImplementation(async () => camera());
    await startWebcamPreview('camera.program');
    await startWebcamPreview('camera.program', 'cam-2');

    expect(stop).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { deviceId: { exact: 'cam-2' } },
      audio: false,
    });
    expect(getWebcamPreviewState()).toMatchObject({ status: 'running', deviceId: 'cam-2' });

    await startWebcamPreview('camera.program');
    expect(stop).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: true, audio: false });
  });

  it('shares one camera with the presentation background and stops each use independently', async () => {
    const captured = camera();
    getUserMedia.mockResolvedValue(captured);
    await startWebcamPreview('camera.program');
    await startWebcamPresentation();

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(getWebcamPresentationStream()).toBe(captured);
    stopLiveWebcamPreview();
    expect(getWebcamPreviewFrame('camera.program')).toBeNull();
    expect(getWebcamPresentationStream()).toBe(captured);
    expect(stop).not.toHaveBeenCalled();

    await startWebcamPreview('camera.program');
    stopWebcamPresentation();
    expect(getWebcamPreviewFrame('camera.program')).toBe(player);
    expect(getWebcamPresentationStream()).toBeNull();
    expect(stop).not.toHaveBeenCalled();

    stopLiveWebcamPreview();
    expect(stop).toHaveBeenCalledOnce();
    expect(getWebcamPreviewState().status).toBe('idle');
  });

  it('starts a webcam presentation background without creating a live Media tag', async () => {
    const captured = camera();
    getUserMedia.mockResolvedValue(captured);

    await startWebcamPresentation();
    expect(getWebcamPreviewState()).toMatchObject({
      status: 'running',
      tag: null,
      presentation: true,
    });
    expect(getWebcamPresentationStream()).toBe(captured);
    expect(getWebcamPreviewFrame('camera.program')).toBeNull();

    stopWebcamPresentation();
    expect(stop).toHaveBeenCalledOnce();
    expect(getWebcamPresentationStream()).toBeNull();
  });

  it('stops a late permission grant after Stop is pressed', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((resolve) => (grant = resolve)));
    const starting = startWebcamPreview('camera.program');
    expect(getWebcamPreviewState().status).toBe('starting');
    stopWebcamPreview();
    grant(camera());
    await starting;

    expect(stop).toHaveBeenCalledOnce();
    expect(getWebcamPreviewState().status).toBe('idle');
    expect(getWebcamPreviewFrame('camera.program')).toBeNull();
  });

  it('reports a denied camera request without leaving a live preview', async () => {
    getUserMedia.mockRejectedValue(new Error('Camera permission denied'));
    await startWebcamPreview('camera.program');

    expect(getWebcamPreviewState()).toMatchObject({
      status: 'error',
      tag: null,
      error: 'Camera permission denied',
    });
    expect(getWebcamPreviewFrame('camera.program')).toBeNull();
  });

  it('uses the initiating window and releases its camera when that window closes', async () => {
    getUserMedia.mockResolvedValue(camera());
    let pagehide: (() => void) | undefined;
    const ownerWindow = {
      navigator,
      document,
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'pagehide') pagehide = listener;
      }),
      removeEventListener: vi.fn(),
    } as unknown as Window & typeof globalThis;

    await startWebcamPreview('camera.program', '', ownerWindow);
    expect(ownerWindow.addEventListener).toHaveBeenCalledWith('pagehide', stopWebcamPreview);
    expect(getWebcamPreviewState().status).toBe('running');
    pagehide?.();
    expect(stop).toHaveBeenCalledOnce();
    expect(ownerWindow.removeEventListener).toHaveBeenCalledWith('pagehide', stopWebcamPreview);
    expect(getWebcamPreviewState().status).toBe('idle');
  });
});
