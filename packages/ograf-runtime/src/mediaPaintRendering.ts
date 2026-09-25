import {
  getElementMediaPaint,
  LIVE_MEDIA_ELEMENT_TAG,
  type Element,
  type MediaPaint,
} from '@ograf-editor/scene-model';
import { createShaderPaintMask } from './shaderPaintMask';

interface RenderOptions {
  shaderBackingSize?: { width: number; height: number };
  lottieBackingSize?: { width: number; height: number };
  requiresImageAlpha?: boolean;
}

interface NativeContent {
  render(host: HTMLElement, element: Element, options: RenderOptions): void;
  renderAtTime(host: HTMLElement, element: Element, elapsedMs: number): void;
  ready(host: HTMLElement): Promise<void>;
  refreshLayout(host: HTMLElement): void;
  dispose(host: HTMLElement): void;
}

type LiveMediaElement = HTMLElement & {
  getFrame?: () => CanvasImageSource | Promise<CanvasImageSource | null> | null;
  ready?: Promise<void>;
};

interface MountedMediaPaint {
  container: HTMLElement;
  baseHost: HTMLElement;
  baseElement: Element;
  baseIdentity: string;
  paint: MediaPaint;
  paintIdentity: string;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  source: HTMLVideoElement | HTMLImageElement | LiveMediaElement;
  fallback?: HTMLImageElement;
  abort: AbortController;
  mask: ReturnType<typeof createShaderPaintMask>;
  native: NativeContent;
  options: RenderOptions;
  ready: Promise<void>;
  time: number;
  requested: number;
  completed: number;
  busy: boolean;
  disposed: boolean;
  error?: Error;
  waiters: Array<{ revision: number; resolve: () => void }>;
}

const mountedMediaPaints = new WeakMap<HTMLElement, MountedMediaPaint>();

export function mediaFitRect(
  source: { width: number; height: number },
  target: { width: number; height: number },
  fit: MediaPaint['fit'],
  positionX: number,
  positionY: number,
) {
  if (source.width <= 0 || source.height <= 0)
    throw new Error('Media paint source has no decoded dimensions.');
  if (fit === 'fill') return { x: 0, y: 0, width: target.width, height: target.height };
  const scale =
    fit === 'cover'
      ? Math.max(target.width / source.width, target.height / source.height)
      : Math.min(target.width / source.width, target.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    x: (target.width - width) * positionX,
    y: (target.height - height) * positionY,
    width,
    height,
  };
}

function requestedSize(container: HTMLElement, options: RenderOptions) {
  const width =
    options.shaderBackingSize?.width ||
    container.clientWidth ||
    Number.parseFloat(container.style.width) ||
    1;
  const height =
    options.shaderBackingSize?.height ||
    container.clientHeight ||
    Number.parseFloat(container.style.height) ||
    1;
  return { width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) };
}

function mediaPaintBaseElement(element: Element): Element {
  if (element.type === 'image' || element.type === 'image-sequence' || element.type === 'lottie') {
    const { fill: _fill, ...base } = element;
    return base;
  }
  if (element.type === 'text') return { ...element, fill: 'transparent', color: 'transparent' };
  if ('fill' in element) return { ...element, fill: 'transparent' } as Element;
  return element;
}

function waitForVideo(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (!video.src) return Promise.resolve();
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clear = () => {
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      clearTimeout(timeout);
    };
    const loaded = () => {
      clear();
      resolve();
    };
    const failed = () => {
      clear();
      reject(new Error('Media clip could not be decoded by this browser.'));
    };
    const aborted = () => {
      clear();
      reject(new Error('Media paint was disposed before its clip became ready.'));
    };
    const timeout = setTimeout(() => {
      clear();
      reject(new Error('Media clip did not become ready within 10 seconds.'));
    }, 10_000);
    video.addEventListener('loadeddata', loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
  });
}

function waitForImage(image: HTMLImageElement, signal: AbortSignal): Promise<void> {
  if (!image.src) return Promise.resolve();
  if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clear = () => {
      image.removeEventListener('load', loaded);
      image.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      clearTimeout(timeout);
    };
    const loaded = () => {
      clear();
      resolve();
    };
    const failed = () => {
      clear();
      reject(new Error('Live media fallback image could not be decoded.'));
    };
    const aborted = () => {
      clear();
      reject(new Error('Media paint was disposed before its fallback became ready.'));
    };
    const timeout = setTimeout(() => {
      clear();
      reject(new Error('Live media fallback did not become ready within 10 seconds.'));
    }, 10_000);
    image.addEventListener('load', loaded, { once: true });
    image.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
  });
}

async function mediaSource(mounted: MountedMediaPaint): Promise<CanvasImageSource | null> {
  if (mounted.paint.source.kind === 'clip') {
    const video = mounted.source as HTMLVideoElement;
    return video.readyState >= 2 && video.videoWidth > 0 ? video : null;
  }
  const live = mounted.source as LiveMediaElement;
  await live.ready?.catch(() => undefined);
  const frame = await live.getFrame?.();
  if (frame) return frame;
  const fallback = mounted.fallback;
  return fallback?.complete && fallback.naturalWidth > 0 ? fallback : null;
}

function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement)
    return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof HTMLImageElement)
    return { width: source.naturalWidth, height: source.naturalHeight };
  return {
    width: 'width' in source ? Number(source.width) : 0,
    height: 'height' in source ? Number(source.height) : 0,
  };
}

function settle(mounted: MountedMediaPaint): void {
  mounted.waiters = mounted.waiters.filter((waiter) => {
    if (mounted.disposed || mounted.error || waiter.revision <= mounted.completed) {
      waiter.resolve();
      return false;
    }
    return true;
  });
}

function reportFailure(mounted: MountedMediaPaint, cause: unknown): void {
  mounted.error = cause instanceof Error ? cause : new Error(String(cause));
  mounted.container.dataset.ografMediaError = mounted.error.message;
}

function drawRequestedFrame(mounted: MountedMediaPaint): void {
  if (mounted.busy || mounted.disposed || mounted.error) return;
  const revision = mounted.requested;
  const elapsedMs = mounted.time;
  mounted.busy = true;
  void (async () => {
    mounted.native.renderAtTime(mounted.baseHost, mounted.baseElement, elapsedMs);
    await Promise.all([mounted.ready, mounted.native.ready(mounted.baseHost), mounted.mask.ready]);
    const coverage = await mounted.mask.update(elapsedMs);
    const source = await mediaSource(mounted);
    const { canvas, context, paint } = mounted;
    context.resetTransform();
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (source) {
      const rect = mediaFitRect(
        sourceSize(source),
        canvas,
        paint.fit,
        paint.positionX,
        paint.positionY,
      );
      context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
      if (coverage) {
        context.globalCompositeOperation = 'destination-in';
        context.drawImage(coverage, 0, 0, canvas.width, canvas.height);
        context.globalCompositeOperation = 'source-over';
      }
    }
  })()
    .catch((error: unknown) => {
      if (!mounted.disposed) reportFailure(mounted, error);
    })
    .finally(() => {
      mounted.busy = false;
      mounted.completed = Math.max(mounted.completed, revision);
      settle(mounted);
      if (mounted.completed < mounted.requested) drawRequestedFrame(mounted);
    });
}

function requestFrame(mounted: MountedMediaPaint, elapsedMs: number): void {
  if (mounted.error) throw mounted.error;
  mounted.time = elapsedMs;
  mounted.requested += 1;
  drawRequestedFrame(mounted);
}

export function mountMediaPaintContent(
  container: HTMLElement,
  element: Element,
  options: RenderOptions,
  native: NativeContent,
): void {
  const paint = getElementMediaPaint(element);
  if (!paint) throw new Error('The element has no media paint.');
  const abort = new AbortController();
  const visualHost = container.ownerDocument.createElement('div');
  visualHost.dataset.ografMediaPaint = 'true';
  Object.assign(visualHost.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  });
  container.appendChild(visualHost);
  const baseHost = container.ownerDocument.createElement('div');
  baseHost.dataset.ografMediaBase = 'true';
  Object.assign(baseHost.style, { position: 'absolute', inset: '0', zIndex: '1' });
  visualHost.appendChild(baseHost);
  const baseElement = mediaPaintBaseElement(element);
  if (['image', 'image-sequence', 'lottie'].includes(element.type)) baseHost.style.opacity = '0';
  native.render(baseHost, baseElement, { ...options, requiresImageAlpha: true });
  const size = requestedSize(container, options);
  const canvas = container.ownerDocument.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.dataset.ografMediaCanvas = 'true';
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    zIndex: '0',
  });
  visualHost.appendChild(canvas);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Media paint requires Canvas 2D rendering support.');
  let source: HTMLVideoElement | HTMLImageElement | LiveMediaElement;
  let fallback: HTMLImageElement | undefined;
  let ready: Promise<void>;
  if (paint.source.kind === 'clip') {
    const video = container.ownerDocument.createElement('video');
    video.dataset.ografMediaClip = 'true';
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.loop = paint.loop;
    video.playbackRate = paint.speed;
    video.src = paint.source.src;
    Object.assign(video.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    visualHost.appendChild(video);
    video.load();
    source = video;
    ready = waitForVideo(video, abort.signal).then(() => {
      if (paint.offsetMs > 0 && Number.isFinite(video.duration))
        video.currentTime = Math.min(video.duration, paint.offsetMs / 1000);
      void video.play().catch(() => undefined);
    });
  } else {
    const live = container.ownerDocument.createElement(LIVE_MEDIA_ELEMENT_TAG) as LiveMediaElement;
    live.dataset.ografMediaLive = 'true';
    live.dataset.sourceTag = paint.source.tag;
    live.dataset.version = '1';
    Object.assign(live.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    visualHost.appendChild(live);
    source = live;
    if (paint.source.fallback) {
      fallback = container.ownerDocument.createElement('img');
      fallback.src = paint.source.fallback;
      fallback.alt = '';
      Object.assign(fallback.style, {
        position: 'absolute',
        width: '1px',
        height: '1px',
        opacity: '0',
        pointerEvents: 'none',
      });
      visualHost.appendChild(fallback);
    }
    ready = fallback ? waitForImage(fallback, abort.signal) : Promise.resolve();
  }
  const mask = createShaderPaintMask(baseHost, element, size, {
    refreshTextLayout: () => native.refreshLayout(baseHost),
  });
  const mounted: MountedMediaPaint = {
    container,
    baseHost,
    baseElement,
    baseIdentity: JSON.stringify(baseElement),
    paint,
    paintIdentity: JSON.stringify(paint),
    canvas,
    context,
    source,
    ...(fallback ? { fallback } : {}),
    abort,
    mask,
    native,
    options,
    ready,
    time: 0,
    requested: 0,
    completed: -1,
    busy: false,
    disposed: false,
    waiters: [],
  };
  mountedMediaPaints.set(container, mounted);
  void ready.catch((error: unknown) => reportFailure(mounted, error));
  requestFrame(mounted, 0);
}

export function updateMediaPaintContent(
  container: HTMLElement,
  element: Element,
  _options: RenderOptions,
): boolean {
  const mounted = mountedMediaPaints.get(container);
  const paint = getElementMediaPaint(element);
  if (!mounted || !paint) return false;
  if (
    mounted.paintIdentity !== JSON.stringify(paint) ||
    mounted.baseIdentity !== JSON.stringify(mediaPaintBaseElement(element))
  )
    return false;
  requestFrame(mounted, mounted.time);
  return true;
}

export function renderMediaPaintAtTime(container: HTMLElement, elapsedMs: number): boolean {
  const mounted = mountedMediaPaints.get(container);
  if (!mounted) return false;
  requestFrame(mounted, elapsedMs);
  return true;
}

export async function waitForMediaPaintContentReady(root: ParentNode): Promise<void> {
  const entries = [root, ...root.querySelectorAll<HTMLElement>('*')]
    .map((element) => mountedMediaPaints.get(element as HTMLElement))
    .filter((entry): entry is MountedMediaPaint => !!entry);
  await Promise.all(
    entries.map((entry) => {
      if (entry.error || entry.disposed || entry.completed >= entry.requested)
        return Promise.resolve();
      return new Promise<void>((resolve) =>
        entry.waiters.push({ revision: entry.requested, resolve }),
      );
    }),
  );
  const failed = entries.find((entry) => entry.error || entry.disposed);
  if (failed) throw failed.error ?? new Error('Media paint was disposed before becoming ready.');
}

export function disposeMediaPaintContent(container: HTMLElement): void {
  const mounted = mountedMediaPaints.get(container);
  if (!mounted) return;
  mounted.disposed = true;
  mounted.abort.abort();
  mounted.mask.dispose();
  mounted.native.dispose(mounted.baseHost);
  if (mounted.source instanceof HTMLVideoElement) {
    mounted.source.pause();
    mounted.source.removeAttribute('src');
    mounted.source.load();
  }
  mounted.canvas.width = mounted.canvas.height = 1;
  settle(mounted);
  mountedMediaPaints.delete(container);
}
