import { useTimelineStore } from '../state/timelineStore';
import { computeKeyframeFrames, type Composition } from '@ograf-editor/scene-model';

interface ArrowModifiers {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

export function timelineFrameDirection(event: ArrowModifiers): -1 | 1 | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing)
    return null;
  return event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null;
}

export function timelineKeyframeDirection(event: ArrowModifiers): -1 | 1 | null {
  if (event.altKey || event.shiftKey || event.isComposing || (!event.ctrlKey && !event.metaKey))
    return null;
  return event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null;
}

/** Main-timeline keys only; local-loop tracks intentionally use their own ruler. */
export function collectTimelineKeyframeFrames(composition: Composition): number[] {
  const frames = new Set(computeKeyframeFrames(composition).map((item) => item.frame));
  for (const layer of composition.layers) {
    for (const keyframe of layer.keyframes) frames.add(keyframe.frame);
    for (const track of Object.values(layer.animationTracks)) {
      for (const keyframe of track ?? []) frames.add(keyframe.frame);
    }
  }
  const lifecycleFrames = new Map(
    computeKeyframeFrames(composition).map((item) => [item.keyframeId, item.frame]),
  );
  for (const cue of composition.mediaCues ?? []) {
    if (cue.trigger.type === 'timeline') frames.add(cue.trigger.startFrame);
    if (cue.trigger.type === 'lifecycle') {
      const frame = lifecycleFrames.get(cue.trigger.keyframeId);
      if (frame !== undefined) frames.add(frame);
    }
  }
  return [...frames].sort((left, right) => left - right);
}

/** Fresh store state keeps repeated shortcuts aligned with the current playhead. */
export function jumpTimelineKeyframe(frames: readonly number[], direction: -1 | 1): boolean {
  const controller = useTimelineStore.getState().controller;
  if (!controller || frames.length === 0) return false;
  controller.pause();
  const state = useTimelineStore.getState();
  state.setPreviewLoopLayerId(null);
  const current = state.currentFrame;
  const target =
    direction > 0
      ? frames.find((frame) => frame > current + 1e-6)
      : [...frames].reverse().find((frame) => frame < current - 1e-6);
  if (target !== undefined) controller.seek(target);
  return true;
}

/** Consume Space before focused timeline buttons or markers can activate it themselves. */
export function handleTimelinePlaybackKey(
  event: ArrowModifiers & { code?: string; repeat?: boolean },
): boolean {
  if (
    (event.key !== ' ' && event.code !== 'Space') ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.isComposing
  )
    return false;
  const { controller, isPlaying, durationFrames } = useTimelineStore.getState();
  if (!event.repeat && controller) {
    if (isPlaying) controller.pause();
    else if (durationFrames > 0) controller.play();
  }
  return true;
}

/** Editors and accessible value/resize widgets own their arrow keys. */
export function timelineTargetOwnsArrows(target: Element): boolean {
  return Boolean(
    target.closest(
      'input, textarea, select, [role="textbox"], [role="spinbutton"], [role="slider"], [role="separator"], [contenteditable]:not([contenteditable="false"])',
    ),
  );
}

/** Fresh store state avoids stale closure steps during keyboard repeat or rapid clicks. */
export function stepTimelineFrame(delta: -1 | 1): boolean {
  const controller = useTimelineStore.getState().controller;
  if (!controller) return false;
  controller.pause();
  const state = useTimelineStore.getState();
  state.setPreviewLoopLayerId(null);
  controller.seek(
    Math.max(0, Math.min(state.durationFrames, Math.round(state.currentFrame) + delta)),
  );
  return true;
}
