import { toCanvas } from 'html-to-image';
import {
  effectEnabled,
  effectStackPadding,
  effectStackToCss,
  getElementMediaPaint,
  getEffectStack,
  type Element,
  type EffectBlendMode,
  type LayerEffect,
  type LayerEffects,
} from '@ograf-editor/scene-model';
import { createShaderRenderer, type ShaderRenderer } from './shaderRendering';
import { mediaFitRect } from './mediaPaintRendering';

interface ShaderStage {
  canvas: HTMLCanvasElement;
  renderer: ShaderRenderer;
  source: string;
  scale: number;
  width: number;
  height: number;
}

type ShaderEffectInput = HTMLCanvasElement | ImageBitmap;

class ShaderEffectStackController {
  readonly host: HTMLElement;
  readonly output: HTMLCanvasElement;
  readonly originals = new Map<HTMLElement, string>();
  readonly shaders = new Map<string, ShaderStage>();
  effects: LayerEffects;
  elapsedMs = 0;
  requested = 0;
  completed = 0;
  busy = false;
  disposed = false;
  error: Error | null = null;
  baseCanvas: ShaderEffectInput | null = null;
  baseSignature = '';
  waiters: Array<{ revision: number; resolve: () => void }> = [];

  constructor(host: HTMLElement, effects: LayerEffects) {
    this.host = host;
    this.effects = effects;
    this.output = host.ownerDocument.createElement('canvas');
    this.output.dataset.ografShaderEffectOutput = 'true';
    this.output.setAttribute('aria-hidden', 'true');
    Object.assign(this.output.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '2147483646',
    });
    host.appendChild(this.output);
  }

  contentChildren(): HTMLElement[] {
    return [...this.host.children].filter(
      (child) =>
        child !== this.output &&
        (child as HTMLElement).dataset.ografRuntimeAuxiliary !== 'true' &&
        (child as HTMLElement).dataset.ografEffectFilter !== 'true',
    ) as HTMLElement[];
  }

  showOriginals(): void {
    for (const child of this.contentChildren()) {
      if (!this.originals.has(child)) this.originals.set(child, child.style.opacity);
      child.style.opacity = this.originals.get(child) ?? '';
    }
  }

  hideOriginals(): void {
    for (const child of this.contentChildren()) {
      if (!this.originals.has(child)) this.originals.set(child, child.style.opacity);
      child.style.opacity = '0';
    }
  }

  size(): { width: number; height: number } {
    return {
      width: Math.max(
        1,
        Math.round(Number.parseFloat(this.host.style.width) || this.host.clientWidth || 1),
      ),
      height: Math.max(
        1,
        Math.round(Number.parseFloat(this.host.style.height) || this.host.clientHeight || 1),
      ),
    };
  }

  sourceSignature(width: number, height: number): string {
    const images = [...this.host.querySelectorAll('img')].map(
      (image) => image.currentSrc || image.src,
    );
    const dynamicCanvas = [...this.host.querySelectorAll('canvas')].some(
      (canvas) => canvas !== this.output && canvas.dataset.ografShaderEffectStage !== 'true',
    );
    return JSON.stringify([
      this.host.dataset.ografRenderedElement,
      width,
      height,
      images,
      dynamicCanvas ? this.elapsedMs : null,
    ]);
  }

  async captureHost(width: number, height: number): Promise<ShaderEffectInput> {
    const media = [...this.host.querySelectorAll<HTMLCanvasElement>('canvas')].find(
      (canvas) => canvas.dataset.ografMediaCanvas === 'true',
    );
    const options = {
      width,
      height,
      canvasWidth: width,
      canvasHeight: height,
      pixelRatio: 1,
      cacheBust: false,
      style: {
        transform: 'none',
        transformOrigin: '0 0',
        opacity: '1',
        filter: 'none',
        mixBlendMode: 'normal',
      },
      filter: (node: HTMLElement) => {
        const dataset = node.dataset;
        return (
          !dataset ||
          (dataset.ografShaderEffectOutput !== 'true' && dataset.ografEffectFilter !== 'true')
        );
      },
    };
    if (!media) return toCanvas(this.host, options);
    const video = [...this.host.querySelectorAll<HTMLVideoElement>('video')].find(
      (candidate) =>
        candidate.dataset.ografMediaClip === 'true' &&
        candidate.readyState >= 2 &&
        candidate.videoWidth > 0 &&
        candidate.videoHeight > 0,
    );
    const serialized = this.host.dataset.ografRenderedElement;
    const paint = serialized ? getElementMediaPaint(JSON.parse(serialized) as Element) : undefined;
    const fit = paint?.fit ?? media.dataset.ografMediaFit;
    const positionX = paint?.positionX ?? Number(media.dataset.ografMediaPositionX);
    const positionY = paint?.positionY ?? Number(media.dataset.ografMediaPositionY);
    if (
      video &&
      (fit === 'cover' || fit === 'contain' || fit === 'fill') &&
      Number.isFinite(positionX) &&
      Number.isFinite(positionY)
    ) {
      const source = this.canvas(width, height);
      const context = source.getContext('2d');
      if (!context) throw new Error('Shader effect video input requires Canvas 2D support.');
      const rect = mediaFitRect(
        { width: video.videoWidth, height: video.videoHeight },
        { width, height },
        fit,
        positionX,
        positionY,
      );
      context.drawImage(video, rect.x, rect.y, rect.width, rect.height);
      return source;
    }
    // The Media renderer has already flattened native geometry/alpha into this canvas. Supplying
    // it directly avoids both html-to-image's live-canvas omission and Chromium's unreliable
    // canvas-to-canvas-to-WebGL upload path.
    if (typeof createImageBitmap === 'undefined') return media;
    return createImageBitmap(media);
  }

  async captureBase(): Promise<ShaderEffectInput> {
    const { width, height } = this.size();
    const padding = effectStackPadding(this.effects);
    const signature = `${this.sourceSignature(width, height)}:${padding}`;
    if (this.baseCanvas && signature === this.baseSignature) return this.baseCanvas;
    this.showOriginals();
    this.output.style.display = 'none';
    try {
      const captured = await this.captureHost(width, height);
      const isBitmap = typeof ImageBitmap !== 'undefined' && captured instanceof ImageBitmap;
      if (padding > 0 && !isBitmap) {
        if (typeof ImageBitmap !== 'undefined' && this.baseCanvas instanceof ImageBitmap)
          this.baseCanvas.close();
        const padded = this.canvas(width + padding * 2, height + padding * 2);
        padded.getContext('2d')?.drawImage(captured, padding, padding);
        this.baseCanvas = padded;
        Object.assign(this.output.style, {
          left: `${-padding}px`,
          top: `${-padding}px`,
          width: `calc(100% + ${padding * 2}px)`,
          height: `calc(100% + ${padding * 2}px)`,
        });
      } else {
        if (
          typeof ImageBitmap !== 'undefined' &&
          this.baseCanvas instanceof ImageBitmap &&
          this.baseCanvas !== captured
        )
          this.baseCanvas.close();
        this.baseCanvas = captured;
        Object.assign(this.output.style, { left: '0', top: '0', width: '100%', height: '100%' });
      }
      this.baseSignature = signature;
      return this.baseCanvas;
    } finally {
      this.hideOriginals();
      this.output.style.display = 'block';
    }
  }

  canvas(width: number, height: number): HTMLCanvasElement {
    const canvas = this.host.ownerDocument.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.dataset.ografShaderEffectStage = 'true';
    return canvas;
  }

  blendMode(mode: EffectBlendMode): GlobalCompositeOperation {
    if (mode === 'add') return 'lighter';
    return mode === 'normal' ? 'source-over' : mode;
  }

  applyCanvasEffect(input: ShaderEffectInput, effect: LayerEffect): HTMLCanvasElement {
    const processed = this.canvas(input.width, input.height);
    const processedContext = processed.getContext('2d');
    if (!processedContext) throw new Error('Effect stack requires Canvas 2D support.');
    processedContext.filter = effectStackToCss({
      ...this.effects,
      stack: [{ ...effect, blendMode: 'normal', blendOpacity: 1 }],
    });
    processedContext.drawImage(input, 0, 0);
    const opacity = effect.blendOpacity ?? 1;
    const mode = effect.blendMode ?? 'normal';
    if (mode === 'normal' && opacity === 1) return processed;
    const output = this.canvas(input.width, input.height);
    const context = output.getContext('2d');
    if (!context) throw new Error('Effect stack requires Canvas 2D support.');
    context.drawImage(input, 0, 0);
    context.globalAlpha = opacity;
    context.globalCompositeOperation = this.blendMode(mode);
    context.drawImage(processed, 0, 0);
    return output;
  }

  async applyShaderEffect(
    input: ShaderEffectInput,
    effect: LayerEffect,
    mediaOverlay = false,
  ): Promise<HTMLCanvasElement> {
    if (!effect.shader) throw new Error(`${effect.name} has no shader source.`);
    let stage = this.shaders.get(effect.id);
    if (
      !stage ||
      stage.source !== effect.shader.fragmentSource ||
      stage.scale !== effect.shader.resolutionScale ||
      stage.width !== input.width ||
      stage.height !== input.height
    ) {
      stage?.renderer.dispose();
      const canvas = this.canvas(input.width, input.height);
      const renderer = createShaderRenderer(
        canvas,
        effect.shader,
        { width: input.width, height: input.height },
        () => {},
        false,
        { blendMode: 'normal', blendOpacity: 1 },
      );
      stage = {
        canvas,
        renderer,
        source: effect.shader.fragmentSource,
        scale: effect.shader.resolutionScale,
        width: input.width,
        height: input.height,
      };
      this.shaders.set(effect.id, stage);
    } else {
      stage.renderer.updateParameters(effect.shader);
      stage.renderer.setEffectBlend({ blendMode: 'normal', blendOpacity: 1 });
    }
    stage.renderer.setInput(input);
    stage.renderer.render(this.elapsedMs);
    await stage.renderer.ready();
    if (mediaOverlay) return stage.canvas;
    const mode = effect.blendMode ?? 'normal';
    const opacity = effect.blendOpacity ?? 1;
    const blended = this.canvas(input.width, input.height);
    const context = blended.getContext('2d');
    if (!context) throw new Error('Shader effect blending requires Canvas 2D support.');
    if (mode === 'normal' && opacity === 1) {
      context.drawImage(stage.canvas, 0, 0);
    } else {
      context.drawImage(input, 0, 0);
      context.globalAlpha = opacity;
      context.globalCompositeOperation = this.blendMode(mode);
      context.drawImage(stage.canvas, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    }
    // A post-process may recolor pixels but must not expand a Media-painted object's native alpha.
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(input, 0, 0);
    context.globalCompositeOperation = 'source-over';
    return blended;
  }

  async render(): Promise<void> {
    let result = await this.captureBase();
    const mediaOverlay = [...this.host.querySelectorAll<HTMLCanvasElement>('canvas')].some(
      (canvas) => canvas.dataset.ografMediaCanvas === 'true',
    );
    let overlayEffect: LayerEffect | undefined;
    const liveShaderIds = new Set<string>();
    for (const effect of getEffectStack(this.effects)) {
      if (!effectEnabled(effect, this.effects) || effect.blendOpacity === 0) continue;
      if (effect.type === 'shader') {
        liveShaderIds.add(effect.id);
        result = await this.applyShaderEffect(result, effect, mediaOverlay);
        if (mediaOverlay) overlayEffect = effect;
      } else {
        const css = effectStackToCss({
          ...this.effects,
          stack: [{ ...effect, blendMode: 'normal', blendOpacity: 1 }],
        });
        if (
          css === 'none' &&
          (effect.blendMode ?? 'normal') === 'normal' &&
          (effect.blendOpacity ?? 1) === 1
        )
          continue;
        result = this.applyCanvasEffect(result, effect);
      }
    }
    for (const [id, stage] of this.shaders) {
      if (liveShaderIds.has(id)) continue;
      stage.renderer.dispose();
      this.shaders.delete(id);
    }
    // Dynamic inputs (Media, Lottie, shader paints) may request another frame while html-to-image
    // is still flattening this one. Commit the latest completed frame instead of starving the
    // output forever; run() immediately follows with the newest queued revision.
    if (this.disposed) return;
    if (this.output.width !== result.width) this.output.width = result.width;
    if (this.output.height !== result.height) this.output.height = result.height;
    const context = this.output.getContext('2d');
    if (!context) throw new Error('Shader effect output requires Canvas 2D support.');
    context.clearRect(0, 0, this.output.width, this.output.height);
    context.drawImage(result, 0, 0);
    if (mediaOverlay && overlayEffect) {
      this.showOriginals();
      this.output.style.mixBlendMode =
        overlayEffect.blendMode === 'add' ? 'screen' : (overlayEffect.blendMode ?? 'normal');
      this.output.style.opacity = String(overlayEffect.blendOpacity ?? 1);
    } else {
      this.output.style.mixBlendMode = 'normal';
      this.output.style.opacity = '1';
    }
    delete this.host.dataset.ografEffectError;
    this.error = null;
  }

  settle(): void {
    this.waiters = this.waiters.filter((waiter) => {
      if (this.error || this.disposed || waiter.revision <= this.completed) {
        waiter.resolve();
        return false;
      }
      return true;
    });
  }

  run(): void {
    if (this.busy || this.disposed) return;
    const revision = this.requested;
    this.busy = true;
    void this.render()
      .catch((cause: unknown) => {
        this.error = cause instanceof Error ? cause : new Error(String(cause));
        this.host.dataset.ografEffectError = this.error.message;
        this.showOriginals();
        this.output.style.display = 'none';
      })
      .finally(() => {
        this.completed = Math.max(this.completed, revision);
        this.busy = false;
        this.settle();
        if (this.completed < this.requested) this.run();
      });
  }

  update(effects: LayerEffects, elapsedMs: number): void {
    this.effects = effects;
    this.elapsedMs = elapsedMs;
    this.requested += 1;
    this.run();
  }

  ready(): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    if (this.completed >= this.requested) return Promise.resolve();
    return new Promise<void>((resolve) =>
      this.waiters.push({ revision: this.requested, resolve }),
    ).then(() => {
      if (this.error) throw this.error;
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const stage of this.shaders.values()) stage.renderer.dispose();
    this.shaders.clear();
    if (typeof ImageBitmap !== 'undefined' && this.baseCanvas instanceof ImageBitmap)
      this.baseCanvas.close();
    this.baseCanvas = null;
    this.showOriginals();
    this.output.remove();
    this.settle();
  }
}

const shaderStacks = new WeakMap<HTMLElement, ShaderEffectStackController>();

export function applyShaderEffectStack(
  host: HTMLElement,
  effects: LayerEffects,
  elapsedMs: number,
): void {
  let controller = shaderStacks.get(host);
  if (!controller) {
    controller = new ShaderEffectStackController(host, effects);
    shaderStacks.set(host, controller);
  }
  controller.update(effects, elapsedMs);
}

export function removeShaderEffectStack(host: HTMLElement): void {
  const controller = shaderStacks.get(host);
  if (!controller) return;
  controller.dispose();
  shaderStacks.delete(host);
}

export async function waitForShaderEffectStacksReady(root: ParentNode): Promise<void> {
  const controllers = [root, ...root.querySelectorAll<HTMLElement>('*')].flatMap((element) => {
    const controller = shaderStacks.get(element as HTMLElement);
    return controller ? [controller] : [];
  });
  await Promise.all(controllers.map((controller) => controller.ready()));
}
