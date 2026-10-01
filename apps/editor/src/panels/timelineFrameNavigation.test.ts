import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../state/timelineStore';
import {
  collectTimelineKeyframeFrames,
  handleTimelinePlaybackKey,
  jumpTimelineKeyframe,
  stepTimelineFrame,
  timelineFrameDirection,
  timelineKeyframeDirection,
} from './timelineFrameNavigation';
import {
  createComposition,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  defaultTransformFor,
} from '@ograf-editor/scene-model';

const arrows = {
  key: 'ArrowRight',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

describe('Timeline frame navigation', () => {
  beforeEach(() =>
    useTimelineStore.setState({
      currentFrame: 0,
      durationFrames: 60,
      controller: null,
      isPlaying: false,
      previewLoopLayerId: null,
    }),
  );

  it('steps only unmodified arrows and ignores composing input', () => {
    expect(timelineFrameDirection(arrows)).toBe(1);
    expect(timelineFrameDirection({ ...arrows, key: 'ArrowLeft' })).toBe(-1);
    for (const key of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing'])
      expect(timelineFrameDirection({ ...arrows, [key]: true })).toBeNull();
    expect(timelineFrameDirection({ ...arrows, key: 'ArrowDown' })).toBeNull();
  });

  it('recognizes Ctrl/Cmd arrows only for keyframe jumps', () => {
    expect(timelineKeyframeDirection({ ...arrows, ctrlKey: true })).toBe(1);
    expect(timelineKeyframeDirection({ ...arrows, key: 'ArrowLeft', metaKey: true })).toBe(-1);
    expect(timelineKeyframeDirection(arrows)).toBeNull();
    expect(timelineKeyframeDirection({ ...arrows, ctrlKey: true, shiftKey: true })).toBeNull();
    expect(timelineKeyframeDirection({ ...arrows, ctrlKey: true, key: 'ArrowDown' })).toBeNull();
  });

  it('collects distinct lifecycle, layer, and property frames but excludes local-loop keys', () => {
    const composition = createComposition();
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = [
      createLayerKeyframe(5, defaultTransformFor('rectangle')),
      createLayerKeyframe(20, defaultTransformFor('rectangle')),
    ];
    layer.animationTracks.x = [createLayerPropertyKeyframe(12, 42)];
    layer.loop = createLayerLoopClip({
      durationFrames: 10,
      tracks: { x: [createLayerPropertyKeyframe(7, 1)] },
    });
    composition.layers = [layer];
    const frames = collectTimelineKeyframeFrames(composition);
    expect(frames).toEqual(expect.arrayContaining([0, 5, 12, 20]));
    expect(frames).not.toContain(7);
    expect(frames).toEqual([...new Set(frames)].sort((left, right) => left - right));
  });

  it('jumps to adjacent distinct keyframes, pauses, and does not wrap at the ends', () => {
    const seek = vi.fn((frame: number) => useTimelineStore.getState().setCurrentFrame(frame));
    const pause = vi.fn(() => useTimelineStore.getState().setPlaying(false));
    useTimelineStore.setState({
      currentFrame: 10,
      isPlaying: true,
      previewLoopLayerId: 'loop',
      controller: { seek, pause, play: vi.fn(), stop: vi.fn() },
    });
    expect(jumpTimelineKeyframe([0, 10, 24, 40], 1)).toBe(true);
    expect(jumpTimelineKeyframe([0, 10, 24, 40], 1)).toBe(true);
    expect(jumpTimelineKeyframe([0, 10, 24, 40], -1)).toBe(true);
    expect(seek.mock.calls).toEqual([[24], [40], [24]]);
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: 24,
      isPlaying: false,
      previewLoopLayerId: null,
    });
    useTimelineStore.getState().setCurrentFrame(40);
    expect(jumpTimelineKeyframe([0, 10, 24, 40], 1)).toBe(true);
    expect(seek.mock.calls).toHaveLength(3);
    expect(pause).toHaveBeenCalledTimes(4);
  });

  it('pauses and advances once per event using the latest playhead', () => {
    const seek = vi.fn((frame: number) => useTimelineStore.getState().setCurrentFrame(frame));
    const pause = vi.fn(() => useTimelineStore.getState().setPlaying(false));
    useTimelineStore.setState({
      currentFrame: 10.2,
      isPlaying: true,
      previewLoopLayerId: 'loop',
      controller: { seek, pause, play: vi.fn(), stop: vi.fn() },
    });
    stepTimelineFrame(1);
    stepTimelineFrame(1);
    stepTimelineFrame(-1);
    expect(seek.mock.calls).toEqual([[11], [12], [11]]);
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: 11,
      isPlaying: false,
      previewLoopLayerId: null,
    });
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(seek.mock.invocationCallOrder[0]!);
  });

  it('clamps at both ends and tolerates an unavailable controller', () => {
    expect(stepTimelineFrame(1)).toBe(false);
    const seek = vi.fn((frame: number) => useTimelineStore.getState().setCurrentFrame(frame));
    useTimelineStore.setState({
      controller: { seek, pause: vi.fn(), play: vi.fn(), stop: vi.fn() },
    });
    stepTimelineFrame(-1);
    expect(useTimelineStore.getState().currentFrame).toBe(0);
    useTimelineStore.getState().setCurrentFrame(60);
    stepTimelineFrame(1);
    expect(useTimelineStore.getState().currentFrame).toBe(60);
  });

  it('toggles playback once per Space press using current state and consumes held repeats', () => {
    const play = vi.fn(() => useTimelineStore.getState().setPlaying(true));
    const pause = vi.fn(() => useTimelineStore.getState().setPlaying(false));
    useTimelineStore.setState({ controller: { play, pause, seek: vi.fn(), stop: vi.fn() } });
    const space = { ...arrows, key: ' ', code: 'Space' };
    expect(handleTimelinePlaybackKey(space)).toBe(true);
    expect(useTimelineStore.getState().isPlaying).toBe(true);
    expect(handleTimelinePlaybackKey({ ...space, repeat: true })).toBe(true);
    expect(play).toHaveBeenCalledOnce();
    expect(pause).not.toHaveBeenCalled();
    expect(handleTimelinePlaybackKey({ ...space, code: undefined })).toBe(true);
    expect(pause).toHaveBeenCalledOnce();
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it('ignores modified or composing Space and safely handles an unavailable timeline', () => {
    const space = { ...arrows, key: ' ', code: 'Space' };
    expect(handleTimelinePlaybackKey(space)).toBe(true);
    for (const key of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing'])
      expect(handleTimelinePlaybackKey({ ...space, [key]: true })).toBe(false);
    expect(handleTimelinePlaybackKey(arrows)).toBe(false);
    const play = vi.fn();
    useTimelineStore.setState({
      durationFrames: 0,
      controller: { play, pause: vi.fn(), seek: vi.fn(), stop: vi.fn() },
    });
    expect(handleTimelinePlaybackKey(space)).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });
});
