import {
  LIVE_MEDIA_ELEMENT_TAG,
  type MediaCue,
  type MediaCueSource,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import { resolveMediaTimelinePosition } from './mediaTimeline';

interface MountedCue {
  cue: MediaCue;
  activeSourceId: string | null;
  media: HTMLMediaElement | HTMLElement | null;
  outgoing: HTMLMediaElement | null;
  activationMs: number | null;
  transitionStartMs: number | null;
  playbackBlocked: boolean;
  playPending: boolean;
}

export type MediaCueVisualSwitch = (
  cue: MediaCue,
  source: MediaCueSource,
  timestampMs: number,
) => void | Promise<void>;

export function mediaCueAutomaticStartMs(
  cue: MediaCue,
  descriptor: Pick<CompiledGraphicDescriptor, 'frameRate' | 'keyframes'>,
): number | null {
  const trigger = cue.trigger;
  const frame =
    trigger.type === 'timeline'
      ? trigger.startFrame
      : trigger.type === 'lifecycle'
        ? descriptor.keyframes.find((keyframe) => keyframe.id === trigger.keyframeId)?.frame
        : undefined;
  return frame === undefined ? null : (frame / descriptor.frameRate) * 1000;
}

function isOneShotAudio(cue: MediaCue, source: MediaCueSource | undefined): boolean {
  return source?.kind === 'clip' && source.mediaType === 'audio' && !cue.loop;
}

export class MediaCueRuntime {
  readonly #host: HTMLElement;
  readonly #descriptor: CompiledGraphicDescriptor;
  readonly #visualSwitch: MediaCueVisualSwitch | undefined;
  readonly #mounted = new Map<string, MountedCue>();
  #timestampMs = 0;

  constructor(
    host: HTMLElement,
    descriptor: CompiledGraphicDescriptor,
    visualSwitch?: MediaCueVisualSwitch,
  ) {
    this.#host = host;
    this.#descriptor = descriptor;
    this.#visualSwitch = visualSwitch;
    for (const cue of descriptor.mediaCues ?? []) {
      this.#mounted.set(cue.id, {
        cue,
        activeSourceId: null,
        media: null,
        outgoing: null,
        activationMs: null,
        transitionStartMs: null,
        playbackBlocked: false,
        playPending: false,
      });
    }
  }

  reset(): void {
    for (const mounted of this.#mounted.values()) {
      this.#disposeMedia(mounted.media);
      this.#disposeMedia(mounted.outgoing);
      mounted.activeSourceId = null;
      mounted.media = null;
      mounted.outgoing = null;
      mounted.activationMs = null;
      mounted.transitionStartMs = null;
      mounted.playbackBlocked = false;
      mounted.playPending = false;
    }
  }

  /** Retry audio that the browser blocked before the operator's first playback gesture. */
  resumeBlocked(): void {
    for (const mounted of this.#mounted.values()) {
      if (!mounted.playbackBlocked || !(mounted.media instanceof HTMLMediaElement)) continue;
      mounted.playbackBlocked = false;
      this.#attemptPlay(mounted, mounted.media);
    }
  }

  dispose(): void {
    this.reset();
    this.#mounted.clear();
    this.#host.remove?.();
  }

  async triggerCustomAction(
    actionId: string,
    payload: unknown,
    timestampMs = this.#timestampMs,
  ): Promise<void> {
    const requestedSource =
      payload && typeof payload === 'object' && 'source' in payload
        ? String((payload as { source?: unknown }).source ?? '')
        : '';
    for (const mounted of this.#mounted.values()) {
      if (mounted.cue.trigger.type !== 'customAction' || mounted.cue.trigger.actionId !== actionId)
        continue;
      const source = requestedSource
        ? mounted.cue.sources.find(
            (candidate) => candidate.id === requestedSource || candidate.name === requestedSource,
          )
        : undefined;
      await this.take(mounted.cue.id, source?.id ?? mounted.cue.activeSourceId, timestampMs);
    }
  }

  async take(cueId: string, sourceId: string | null, timestampMs: number): Promise<void> {
    const mounted = this.#mounted.get(cueId);
    if (!mounted) return;
    const source = mounted.cue.sources.find((candidate) => candidate.id === sourceId);
    if (!source) return;
    if (mounted.activeSourceId === source.id) {
      if (mounted.cue.retrigger === 'ignore') return;
      if (mounted.cue.retrigger === 'resume') {
        if (mounted.media instanceof HTMLMediaElement) {
          await mounted.media.play().catch(() => undefined);
        }
        return;
      }
    }

    const incoming = this.#createMedia(mounted.cue, source);
    const previous = mounted.media instanceof HTMLMediaElement ? mounted.media : null;
    mounted.activeSourceId = source.id;
    mounted.media = incoming;
    mounted.activationMs = timestampMs;
    mounted.transitionStartMs =
      mounted.cue.transition.type === 'crossfade' && previous ? timestampMs : null;
    mounted.playbackBlocked = false;
    mounted.playPending = false;
    mounted.outgoing = mounted.transitionStartMs === null ? null : previous;
    if (!mounted.outgoing) this.#disposeMedia(previous);
    if (incoming instanceof HTMLMediaElement) {
      incoming.volume = mounted.cue.muted ? 0 : mounted.cue.volume;
      incoming.playbackRate = mounted.cue.speed;
      if (incoming.readyState >= 1 && mounted.cue.trimStartMs > 0) {
        incoming.currentTime = mounted.cue.trimStartMs / 1000;
      }
      this.#attemptPlay(mounted, incoming);
    }
    await this.#visualSwitch?.(mounted.cue, source, timestampMs);
  }

  renderAtTime(timestampMs: number, options: { includeAudio?: boolean } = {}): void {
    this.#timestampMs = timestampMs;
    for (const mounted of this.#mounted.values()) {
      const authoredSource = mounted.cue.sources.find(
        (candidate) => candidate.id === mounted.cue.activeSourceId,
      );
      if (
        options.includeAudio === false &&
        authoredSource?.kind === 'clip' &&
        authoredSource.mediaType === 'audio'
      ) {
        continue;
      }
      if (mounted.activationMs === null) {
        const startMs = mediaCueAutomaticStartMs(mounted.cue, this.#descriptor);
        if (startMs !== null && timestampMs >= startMs) {
          void this.take(mounted.cue.id, mounted.cue.activeSourceId, startMs);
        }
        continue;
      }
      const media = mounted.media;
      const baseVolume = mounted.cue.muted ? 0 : mounted.cue.volume;
      let incomingGain = 1;
      if (mounted.transitionStartMs !== null && mounted.outgoing) {
        const durationMs =
          (Math.max(1, mounted.cue.transition.durationFrames) / this.#descriptor.frameRate) * 1000;
        const progress = Math.min(
          1,
          Math.max(0, (timestampMs - mounted.transitionStartMs) / durationMs),
        );
        incomingGain = progress;
        mounted.outgoing.volume = baseVolume * (1 - progress);
        if (progress >= 1) {
          this.#disposeMedia(mounted.outgoing);
          mounted.outgoing = null;
          mounted.transitionStartMs = null;
        }
      }
      if (!(media instanceof HTMLMediaElement)) continue;
      if (isOneShotAudio(mounted.cue, authoredSource)) {
        media.volume = Math.min(1, Math.max(0, baseVolume));
        media.playbackRate = mounted.cue.speed;
        // Sound Events are edge-triggered one-shots. Once started, their media clock owns playback;
        // later OGraf transitions must never seek them back to the marker or call play() again.
        continue;
      }
      const localTimestamp = Math.max(0, timestampMs - mounted.activationMs);
      if (
        mounted.cue.durationFrames != null &&
        localTimestamp >=
          (Math.max(1, mounted.cue.durationFrames) / this.#descriptor.frameRate) * 1000
      ) {
        media.pause();
        continue;
      }
      const position = resolveMediaTimelinePosition(localTimestamp, {
        timelineStartMs: 0,
        trimStartMs: mounted.cue.trimStartMs,
        trimEndMs: mounted.cue.trimEndMs,
        loop: mounted.cue.loop,
        speed: mounted.cue.speed,
        durationMs: Number.isFinite(media.duration) ? media.duration * 1000 : null,
      });
      media.volume = Math.min(1, Math.max(0, baseVolume * incomingGain));
      media.playbackRate = mounted.cue.speed;
      if (!position.active) {
        media.pause();
        continue;
      }
      if (media.readyState >= 1) {
        const seconds = position.positionMs / 1000;
        if (Math.abs(media.currentTime - seconds) > 0.08) media.currentTime = seconds;
      }
      if (mounted.playbackBlocked || mounted.playPending) continue;
      this.#attemptPlay(mounted, media);
    }
  }

  #attemptPlay(mounted: MountedCue, media: HTMLMediaElement): void {
    if (mounted.playPending) return;
    mounted.playPending = true;
    void media
      .play()
      .then(() => {
        mounted.playPending = false;
        mounted.playbackBlocked = false;
        delete this.#host.dataset.ografMediaCueError;
      })
      .catch((cause: unknown) => {
        mounted.playPending = false;
        mounted.playbackBlocked = true;
        this.#host.dataset.ografMediaCueError =
          cause instanceof Error ? cause.message : String(cause);
      });
  }

  #createMedia(cue: MediaCue, source: MediaCueSource): HTMLMediaElement | HTMLElement {
    if (source.kind === 'live') {
      const live = this.#host.ownerDocument.createElement(LIVE_MEDIA_ELEMENT_TAG);
      live.dataset.sourceTag = source.tag;
      live.dataset.ografMediaCueId = cue.id;
      live.style.display = 'none';
      this.#host.appendChild(live);
      return live;
    }
    const media = this.#host.ownerDocument.createElement(source.mediaType);
    media.src = source.src;
    media.preload = 'auto';
    media.loop = false;
    media.muted = cue.muted;
    media.volume = cue.muted ? 0 : cue.volume;
    media.playbackRate = cue.speed;
    if (media instanceof HTMLVideoElement) media.playsInline = true;
    media.dataset.ografMediaCueId = cue.id;
    media.dataset.ografMediaSourceId = source.id;
    media.style.display = 'none';
    this.#host.appendChild(media);
    return media;
  }

  #disposeMedia(media: HTMLMediaElement | HTMLElement | null): void {
    if (!media) return;
    if (media instanceof HTMLMediaElement) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
    media.remove();
  }
}
