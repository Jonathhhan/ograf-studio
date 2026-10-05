import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaCue } from '@ograf-editor/scene-model';
import { MediaCueRuntime, mediaCueAutomaticStartMs } from './mediaCueRuntime';

const originalMediaElement = globalThis.HTMLMediaElement;
const originalVideoElement = globalThis.HTMLVideoElement;

afterEach(() => {
  Object.defineProperty(globalThis, 'HTMLMediaElement', {
    configurable: true,
    value: originalMediaElement,
  });
  Object.defineProperty(globalThis, 'HTMLVideoElement', {
    configurable: true,
    value: originalVideoElement,
  });
});

describe('Media Cue runtime timing', () => {
  it('maps timeline and lifecycle triggers to the absolute OGraf clock', () => {
    const descriptor = {
      frameRate: 25,
      keyframes: [{ id: 'step', frame: 12, role: 'step' as const }],
    };
    expect(
      mediaCueAutomaticStartMs(
        createMediaCue({ trigger: { type: 'timeline', startFrame: 50 } }),
        descriptor,
      ),
    ).toBe(2_000);
    expect(
      mediaCueAutomaticStartMs(
        createMediaCue({
          trigger: { type: 'lifecycle', keyframeId: 'step' },
        }),
        descriptor,
      ),
    ).toBe(480);
  });

  it('keeps custom-action and manual cues dormant until explicitly triggered', () => {
    const descriptor = { frameRate: 25, keyframes: [] };
    expect(
      mediaCueAutomaticStartMs(
        createMediaCue({ trigger: { type: 'customAction', actionId: 'take' } }),
        descriptor,
      ),
    ).toBeNull();
    expect(
      mediaCueAutomaticStartMs(createMediaCue({ trigger: { type: 'manual' } }), descriptor),
    ).toBeNull();
  });

  it('defers audio on non-audio render ticks and retries an autoplay-blocked sound', async () => {
    class FakeMediaElement {
      src = '';
      preload = '';
      loop = false;
      muted = false;
      volume = 1;
      playbackRate = 1;
      currentTime = 0;
      duration = 1;
      readyState = 1;
      dataset: Record<string, string> = {};
      style: Record<string, string> = {};
      play = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error('Autoplay blocked'))
        .mockResolvedValue(undefined);
      pause = vi.fn();
      removeAttribute = vi.fn();
      load = vi.fn();
      remove = vi.fn();
    }
    class FakeVideoElement extends FakeMediaElement {
      playsInline = false;
    }
    Object.defineProperty(globalThis, 'HTMLMediaElement', {
      configurable: true,
      value: FakeMediaElement,
    });
    Object.defineProperty(globalThis, 'HTMLVideoElement', {
      configurable: true,
      value: FakeVideoElement,
    });

    const created: FakeMediaElement[] = [];
    const host = {
      dataset: {} as Record<string, string>,
      ownerDocument: {
        createElement: () => new FakeMediaElement(),
      },
      appendChild: (media: FakeMediaElement) => created.push(media),
      remove: vi.fn(),
    };
    const sourceId = 'sound-source';
    const runtime = new MediaCueRuntime(
      host as unknown as HTMLElement,
      {
        frameRate: 25,
        keyframes: [],
        mediaCues: [
          createMediaCue({
            id: 'sound',
            sources: [
              {
                id: sourceId,
                name: 'Sting',
                kind: 'clip',
                mediaType: 'audio',
                src: 'data:audio/wav;base64,AA==',
              },
            ],
            activeSourceId: sourceId,
            trigger: { type: 'timeline', startFrame: 0 },
          }),
        ],
      } as never,
    );

    runtime.renderAtTime(0, { includeAudio: false });
    expect(created).toHaveLength(0);

    runtime.renderAtTime(0);
    await Promise.resolve();
    runtime.renderAtTime(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(created[0]!.play).toHaveBeenCalledTimes(1);
    expect(host.dataset.ografMediaCueError).toBe('Autoplay blocked');

    runtime.resumeBlocked();
    await Promise.resolve();
    expect(created[0]!.play).toHaveBeenCalledTimes(2);
    expect(host.dataset.ografMediaCueError).toBeUndefined();

    runtime.renderAtTime(1_000);
    await Promise.resolve();
    expect(created).toHaveLength(1);
    expect(created[0]!.play).toHaveBeenCalledTimes(2);
  });
});
