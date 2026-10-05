import { applyLayerEffectsFilter } from './effectCompositing';
import {
  GRAPHIC_ERROR_STATUS_CODE,
  type CompiledGraphicDescriptor,
  type CustomActionParams,
  type Graphic,
  type GoToTimeParams,
  type LoadParams,
  type PlayActionParams,
  type PlayActionReturnPayload,
  type ReturnPayload,
  type ScheduledAction,
  type SetActionsScheduleParams,
  type StopActionParams,
  type UpdateActionParams,
} from '@ograf-editor/ograf-types';
import { buildRuntimeTimeline } from './buildRuntimeTimeline';
import { applyCompiledMasks } from './maskRendering';
import { resolvePlayTarget } from './lifecycle';
import { ShaderContextLostError, shaderBackingSizeForLayer } from './shaderRendering';
import {
  applyAnimatedPaint,
  disposeElementContent,
  lottieBackingSizeForLayer,
  renderAnimatedElementAtTime,
  renderElementContent,
  refreshLottiePresentation,
  resolveBoundElement,
  resolveBoundEffects,
  setLottieDeterministicRendering,
  waitForElementContentReady,
} from './renderElement';
import {
  scriptingErrors,
  getElementShaderPaints,
  effectEnabled,
  getEffectStack,
  getShaderAnimationValue,
  hasElementMediaPaint,
  normalizeTextAnimation,
  normalizeChartAnimation,
  parseShaderAnimationProperty,
  shaderAnimationPropertySpec,
  hasElementShaderPaint,
  resolveShaderParameters,
  type VisualRuleAction,
} from '@ograf-editor/scene-model';
import { shaderStrokePaddingForLayer } from './shaderPaintRendering';
import {
  EFFECT_ANIMATION_PROPERTIES,
  numericEffectProperties,
  effectParameterValue,
  withEffectParameter,
  isGradientStopOffsetProperty,
  TRANSFORM_ANIMATION_PROPERTIES,
  type AnimatableLayerProperty,
  type LayerTransform,
} from '@ograf-editor/scene-model';
import {
  applyCompiledLayerVisualState,
  interpolateCompiledLayerVisualState,
  sampleCompiledLayerVisualState,
} from './loopRendering';
import {
  expandRuntimeCollections,
  isRuntimeCollectionLayerActive,
  runtimeCollectionItemSelection,
} from './runtimeCollections';
import { registerDocumentFonts } from './documentFonts';
import { applyCompiledAutoLayout } from './autoLayoutRendering';
import { applyCompiledMotionPaths } from './motionPathRendering';
import {
  layerHasRuntimeVisualInputs,
  pointerVisualRuleTriggers,
  RuntimeVisualRules,
  visualRuleEffectFor,
  visualRuleLayerVisible,
  type FiredRuntimeVisualRule,
} from './runtimeVisualRules';
import { MediaCueRuntime } from './mediaCueRuntime';
import { renderTextAnimationAtFrame } from './textAnimationRendering';
import { chartAnimationEndFrame, renderChartAnimationAtFrame } from './chartRendering';

/** How deep rule -> custom action -> rule chains may go before rules stop answering. */
const MAX_RULE_CUSTOM_ACTION_DEPTH = 4;

function errorPayload(err: unknown): ReturnPayload {
  return {
    statusCode: GRAPHIC_ERROR_STATUS_CODE,
    statusMessage: err instanceof Error ? err.message : String(err),
  };
}

function contentOptions(layer: CompiledGraphicDescriptor['layers'][number], frameRate: number) {
  return {
    frameRate,
    ...(layer.element.type === 'lottie'
      ? { lottieBackingSize: lottieBackingSizeForLayer(layer) }
      : {}),
    ...(hasElementShaderPaint(layer.element) || hasElementMediaPaint(layer.element)
      ? {
          shaderBackingSize: shaderBackingSizeForLayer(layer),
          shaderStrokePadding: shaderStrokePaddingForLayer(layer),
        }
      : {}),
  };
}

interface LoopExitCorrection {
  startFrame: number;
  targetFrame: number;
  layers: Map<
    string,
    {
      transform: Partial<LayerTransform>;
      effects: Partial<Record<(typeof EFFECT_ANIMATION_PROPERTIES)[number], number>>;
      paint: Partial<Record<AnimatableLayerProperty, number>>;
      discreteShader: Partial<Record<AnimatableLayerProperty, number>>;
      stack: Record<string, number>;
    }
  >;
}

interface DirectLifecycleTransition {
  startFrame: number;
  targetFrame: number;
  layers: Map<
    string,
    {
      source: ReturnType<typeof sampleCompiledLayerVisualState>;
      target: ReturnType<typeof sampleCompiledLayerVisualState>;
    }
  >;
}

/**
 * The generic, descriptor-driven `Graphic` implementation — interprets a CompiledGraphicDescriptor
 * rather than being generated per-project. The SAME class (via this same npm-published/bundled
 * source) drives both the editor's in-app preview harness and every exported package's `main.js`,
 * keeping preview and exported playback on the same interpreter.
 *
 * Custom Elements can't take constructor arguments (the browser calls `new SubClass()` with no
 * args when upgrading/creating one), so the descriptor is read via a `static descriptor` on the
 * concrete subclass instead: `class Foo extends GraphicElement { static descriptor = {...} }`.
 * The in-app preview harness dynamically declares one such subclass per compile and registers it
 * under a fresh tag name; an exported package's main.js does the same thing once, statically.
 */
export abstract class GraphicElement extends HTMLElement implements Graphic {
  static descriptor: CompiledGraphicDescriptor;
  #frameRequestId = 0;
  #frameRequests = new Map<
    number,
    { owner: Window | null; request: number; callback: FrameRequestCallback }
  >();

  #requestFrame(callback: FrameRequestCallback): number {
    const id = ++this.#frameRequestId;
    const owner = this.ownerDocument?.defaultView ?? null;
    const invoke = () => {
      this.#frameRequests.delete(id);
      callback(performance.now());
    };
    const request = owner ? owner.requestAnimationFrame(invoke) : requestAnimationFrame(invoke);
    this.#frameRequests.set(id, { owner, request, callback });
    return id;
  }

  #cancelFrame(id: number): void {
    const entry = this.#frameRequests.get(id);
    if (!entry) return;
    if (entry.owner) entry.owner.cancelAnimationFrame(entry.request);
    else cancelAnimationFrame(entry.request);
    this.#frameRequests.delete(id);
  }

  adoptedCallback(): void {
    // Keep callbacks on the visible document's clock without changing their IDs or phase.
    for (const [id, entry] of this.#frameRequests) {
      if (entry.owner) entry.owner.cancelAnimationFrame(entry.request);
      else cancelAnimationFrame(entry.request);
      const owner = this.ownerDocument.defaultView;
      const invoke = () => {
        this.#frameRequests.delete(id);
        entry.callback(performance.now());
      };
      const request = owner ? owner.requestAnimationFrame(invoke) : requestAnimationFrame(invoke);
      this.#frameRequests.set(id, { ...entry, owner, request });
    }
    if (this.shadowRoot) refreshLottiePresentation(this.shadowRoot);
  }

  #layerEls = new Map<string, HTMLElement>();
  #renderDescriptor: CompiledGraphicDescriptor | null = null;
  #mediaCueRuntime: MediaCueRuntime | null = null;
  #timeline: ReturnType<typeof buildRuntimeTimeline> | null = null;
  #activeTween: { kill(): void } | null = null;
  /** Index into `descriptor.stepKeyframeIds` — the OGraf "current step", not a keyframe index. */
  #currentStep: number | undefined;
  #lastData: Record<string, unknown> = {};
  /** Visual rule state: event overrides, hover, delays and transitions. */
  #rules: RuntimeVisualRules | null = null;
  #ruleTimers = new Set<ReturnType<typeof setTimeout>>();
  #ruleTransitionFrame: number | null = null;
  /** Layers whose content opacity a rule visibility fade currently owns. */
  #ruleFadingLayers = new Set<string>();
  #clickTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #schedule: ScheduledAction[] = [];
  /** Snapshot of `#lastData` taken when `setActionsSchedule` is called — the baseline `goToTime`
   * replays scheduled `updateAction` entries on top of, so scrubbing backward past a scheduled
   * update correctly reverts keys that update doesn't touch, instead of leaving them stuck. */
  #scheduleBaseData: Record<string, unknown> = {};
  /** Realtime self-animated-content redraw requests. Phase is derived from absolute elapsed time. */
  #contentAnimationFrame: number | null = null;
  #textAnimationFrame: number | null = null;
  #textAnimationEpochs = new Map<string, number>();
  #chartAnimationFrame: number | null = null;
  #chartAnimationEpochs = new Map<string, number>();
  #contentPlaybackError: Error | null = null;
  #operationQueue: Promise<void> = Promise.resolve();
  #renderType: LoadParams['renderType'] = 'realtime';
  /** Absolute clock epochs for active layer-local loops. Values use performance.now() in realtime
   * and the scheduled OGraf timestamp in non-realtime; sampling always derives phase absolutely. */
  #activeLoopEpochs = new Map<string, number>();
  #loopAnimationFrame: number | null = null;
  #loopExitCorrection: LoopExitCorrection | null = null;
  #directLifecycleTransition: DirectLifecycleTransition | null = null;
  #updateAnimations: Animation[] = [];
  #updateGeneration = 0;

  private get descriptor(): CompiledGraphicDescriptor {
    return (this.constructor as typeof GraphicElement).descriptor;
  }

  private get activeDescriptor(): CompiledGraphicDescriptor {
    return this.#renderDescriptor ?? this.descriptor;
  }

  #resolveLayerElement(layer: CompiledGraphicDescriptor['layers'][number], data = this.#lastData) {
    return resolveBoundElement(layer, data);
  }

  #visualRuleVisible(layer: CompiledGraphicDescriptor['layers'][number]): boolean {
    return visualRuleLayerVisible(layer, this.#lastData);
  }

  #ruleClock(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  #clearRuleTimers(): void {
    for (const timer of this.#ruleTimers) clearTimeout(timer);
    this.#ruleTimers.clear();
    if (this.#ruleTransitionFrame !== null && typeof cancelAnimationFrame !== 'undefined')
      this.#cancelFrame(this.#ruleTransitionFrame);
    this.#ruleTransitionFrame = null;
  }

  /**
   * Re-derives rule output from current data, then redraws what it changed. Rule transitions run
   * on the page clock in real time; outside schedule replay, non-real-time output lands at once.
   */
  #refreshRuleOutput(): void {
    const rules = this.#rules;
    if (rules) {
      const now = this.#ruleClock();
      rules.update(this.#lastData, now);
      const running = rules.publish(
        this.#renderType === 'realtime' ? now : Number.POSITIVE_INFINITY,
      );
      if (running) this.#ensureRuleTransitionRendering();
    }
    this.#refreshBoundLayers();
    this.#renderLoopSnapshot(this.#ruleClock());
  }

  #ensureRuleTransitionRendering(): void {
    if (
      this.#renderType !== 'realtime' ||
      this.#ruleTransitionFrame !== null ||
      typeof requestAnimationFrame === 'undefined'
    )
      return;
    const render = (now: number) => {
      this.#ruleTransitionFrame = null;
      if (!this.#rules || this.#renderType !== 'realtime') return;
      const running = this.#rules.publish(now);
      this.#refreshBoundLayers();
      this.#renderLoopSnapshot(now);
      if (running) this.#ruleTransitionFrame = this.#requestFrame(render);
    };
    this.#ruleTransitionFrame = this.#requestFrame(render);
  }

  /**
   * Runs fired rules: visibility and property actions change rule state, the rest (sounds, media,
   * custom actions) run afterwards. Delayed rules wait on a timer in real time only; `depth` stops
   * a rule that runs a custom action that fires the same rule from looping forever.
   */
  #runRules(fired: FiredRuntimeVisualRule[], depth = 0, delayed = false): void {
    const rules = this.#rules;
    if (!rules) return;
    const sideEffects: VisualRuleAction[] = [];
    for (const entry of fired) {
      const delay = delayed ? 0 : rules.delayMs(entry);
      if (delay > 0 && this.#renderType === 'realtime') {
        const timer = setTimeout(() => {
          this.#ruleTimers.delete(timer);
          if (this.#rules === rules) this.#runRules([entry], depth, true);
        }, delay);
        this.#ruleTimers.add(timer);
        continue;
      }
      sideEffects.push(...rules.run(entry));
    }
    this.#refreshRuleOutput();
    this.#runVisualRuleEventActions(sideEffects, depth);
  }

  #fireLifecycleRules(
    trigger: 'play' | 'step' | 'stop' | 'custom-action',
    eventId?: string,
    depth = 0,
  ): void {
    if (!this.#rules) return;
    this.#runRules(
      this.#rules.eventFired(trigger, this.#lastData, eventId === undefined ? {} : { eventId }),
      depth,
    );
  }

  async #serializeOperation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operationQueue;
    let release = () => {};
    this.#operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  connectedCallback(): void {
    if (this.shadowRoot && this.#layerEls.size > 0) return;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.#buildDom();
  }

  disconnectedCallback(): void {
    queueMicrotask(() => {
      if (this.isConnected) return;
      this.#activeTween?.kill();
      this.#timeline?.kill();
      this.#clearContentAnimationFrames();
      this.#clearTextAnimationFrames();
      this.#clearChartAnimationFrames();
      this.#stopLoopRendering();
      this.#cancelUpdateAnimations();
      for (const timer of this.#clickTimers.values()) clearTimeout(timer);
      this.#clickTimers.clear();
      this.#clearRuleTimers();
      for (const element of this.#layerEls.values()) disposeElementContent(element);
      this.#mediaCueRuntime?.dispose();
      this.#mediaCueRuntime = null;
      this.#layerEls.clear();
      this.#renderDescriptor = null;
    });
  }

  #clearContentAnimationFrames(): void {
    if (this.#contentAnimationFrame !== null && typeof cancelAnimationFrame !== 'undefined') {
      this.#cancelFrame(this.#contentAnimationFrame);
    }
    this.#contentAnimationFrame = null;
  }

  #clearTextAnimationFrames(): void {
    if (this.#textAnimationFrame !== null && typeof cancelAnimationFrame !== 'undefined') {
      this.#cancelFrame(this.#textAnimationFrame);
    }
    this.#textAnimationFrame = null;
    this.#textAnimationEpochs.clear();
    for (const host of this.#layerEls.values()) delete host.dataset.ografTextAnimationFrame;
  }

  #renderTextAnimationReplays(now: number): void {
    const frameRate = this.activeDescriptor.frameRate;
    for (const [layerId, epoch] of this.#textAnimationEpochs) {
      const layer = this.activeDescriptor.layers.find((candidate) => candidate.id === layerId);
      const host = this.#layerEls.get(layerId);
      const element = layer ? this.#resolveLayerElement(layer) : null;
      if (!host || element?.type !== 'text') {
        this.#textAnimationEpochs.delete(layerId);
        continue;
      }
      const animation = normalizeTextAnimation(element.textAnimation);
      const frame = Math.max(0, ((now - epoch) / 1000) * frameRate);
      host.dataset.ografTextAnimationFrame = String(frame);
      renderTextAnimationAtFrame(host, element, frame);
      if (frame >= animation.durationFrames) {
        this.#textAnimationEpochs.delete(layerId);
        delete host.dataset.ografTextAnimationFrame;
      }
    }
  }

  #ensureTextAnimationRendering(): void {
    if (
      this.#renderType !== 'realtime' ||
      this.#textAnimationEpochs.size === 0 ||
      this.#textAnimationFrame !== null ||
      typeof requestAnimationFrame === 'undefined'
    )
      return;
    const render = (now: number) => {
      this.#textAnimationFrame = null;
      this.#renderTextAnimationReplays(now);
      if (this.#textAnimationEpochs.size > 0) this.#textAnimationFrame = this.#requestFrame(render);
    };
    this.#textAnimationFrame = this.#requestFrame(render);
  }

  #triggerTextAnimationReplays(
    predicate: (layer: CompiledGraphicDescriptor['layers'][number]) => boolean,
    epoch = typeof performance !== 'undefined' ? performance.now() : Date.now(),
  ): string[] {
    const triggered: string[] = [];
    for (const layer of this.activeDescriptor.layers) {
      if (layer.element.type !== 'text' || !predicate(layer)) continue;
      const element = this.#resolveLayerElement(layer);
      if (element.type !== 'text' || normalizeTextAnimation(element.textAnimation).type === 'none')
        continue;
      this.#textAnimationEpochs.set(layer.id, epoch);
      const host = this.#layerEls.get(layer.id);
      if (host) {
        host.dataset.ografTextAnimationFrame = '0';
        renderTextAnimationAtFrame(host, element, 0);
      }
      triggered.push(layer.id);
    }
    this.#ensureTextAnimationRendering();
    return triggered;
  }

  #clearChartAnimationFrames(): void {
    if (this.#chartAnimationFrame !== null) this.#cancelFrame(this.#chartAnimationFrame);
    this.#chartAnimationFrame = null;
    this.#chartAnimationEpochs.clear();
    for (const host of this.#layerEls.values()) delete host.dataset.ografChartAnimationFrame;
  }

  #startChartAnimations(skipAnimation: boolean, changedKeys?: Set<string>): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const layer of this.activeDescriptor.layers) {
      if (layer.element.type !== 'chart') continue;
      const element = this.#resolveLayerElement(layer);
      if (element.type !== 'chart') continue;
      const animation = normalizeChartAnimation(element.animation);
      if (animation.type === 'none') continue;
      if (
        changedKeys &&
        (!animation.replayOnUpdate ||
          !(layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
            (binding) => binding.targetProperty === 'data' && changedKeys.has(binding.dataKey),
          ))
      )
        continue;
      const host = this.#layerEls.get(layer.id);
      if (!host) continue;
      const settle = skipAnimation || this.#renderType !== 'realtime';
      const frame = settle ? chartAnimationEndFrame(element) : 0;
      host.dataset.ografChartAnimationFrame = String(frame);
      renderChartAnimationAtFrame(host, element, frame);
      if (settle) this.#chartAnimationEpochs.delete(layer.id);
      else this.#chartAnimationEpochs.set(layer.id, now);
    }
    this.#ensureChartAnimationRendering();
  }

  #ensureChartAnimationRendering(): void {
    if (
      this.#renderType !== 'realtime' ||
      this.#chartAnimationEpochs.size === 0 ||
      this.#chartAnimationFrame !== null ||
      typeof requestAnimationFrame === 'undefined'
    )
      return;
    const render = (now: number) => {
      this.#chartAnimationFrame = null;
      for (const [layerId, epoch] of this.#chartAnimationEpochs) {
        const layer = this.activeDescriptor.layers.find((candidate) => candidate.id === layerId);
        const host = this.#layerEls.get(layerId);
        const element = layer ? this.#resolveLayerElement(layer) : null;
        if (!host || element?.type !== 'chart') {
          this.#chartAnimationEpochs.delete(layerId);
          continue;
        }
        const endFrame = chartAnimationEndFrame(element);
        const frame = Math.min(
          endFrame,
          Math.max(0, ((now - epoch) / 1000) * this.activeDescriptor.frameRate),
        );
        host.dataset.ografChartAnimationFrame = String(frame);
        renderChartAnimationAtFrame(host, element, frame);
        // Keep the completed snapshot while parked at a Step or during OUT. Returning to the
        // lifecycle's earlier frame must not replay the chart's entrance after an update.
        if (frame >= endFrame) this.#chartAnimationEpochs.delete(layerId);
      }
      if (this.#chartAnimationEpochs.size > 0)
        this.#chartAnimationFrame = this.#requestFrame(render);
    };
    this.#chartAnimationFrame = this.#requestFrame(render);
  }

  #cancelUpdateAnimations(): void {
    for (const animation of this.#updateAnimations) animation.cancel();
    this.#updateAnimations = [];
    for (const layer of this.activeDescriptor.layers) {
      const content = this.#layerEls.get(layer.id)?.firstElementChild as HTMLElement | null;
      if (content) content.style.opacity = '';
      if (content) content.style.transform = '';
    }
  }

  #changedBindingKeys(data: unknown): Set<string> {
    if (!data || typeof data !== 'object') return new Set();
    const patch = data as Record<string, unknown>;
    return new Set(
      this.activeDescriptor.layers
        .flatMap((layer) => [
          ...(layer.bindings ?? (layer.binding ? [layer.binding] : [])).map(
            (binding) => binding.dataKey,
          ),
          ...(layer.collectionItem ? [layer.collectionItem.dataKey] : []),
          ...(this.#rules?.dataKeysFor(layer.id) ?? []),
        ])
        .filter((key): key is string => key !== undefined && Object.hasOwn(patch, key)),
    );
  }

  #replayUpdatedText(dataKeys: Set<string>): void {
    this.#triggerTextAnimationReplays((layer) => {
      if (layer.element.type !== 'text') return false;
      const animation = normalizeTextAnimation(layer.element.textAnimation);
      if (!animation.replayOnUpdate) return false;
      return (layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
        (binding) => binding.targetProperty === 'content' && dataKeys.has(binding.dataKey),
      );
    });
  }

  /** Deterministic scheduled-update opacity used by non-realtime goToTime replay. */
  #setBoundContentOpacity(dataKeys: Set<string>, opacity: number): void {
    for (const layer of this.activeDescriptor.layers) {
      const bindings = layer.bindings ?? (layer.binding ? [layer.binding] : []);
      if (
        !bindings.some((binding) => dataKeys.has(binding.dataKey)) &&
        ![...(this.#rules?.dataKeysFor(layer.id) ?? [])].some((key) => dataKeys.has(key)) &&
        !dataKeys.has(layer.collectionItem?.dataKey ?? '')
      )
        continue;
      const content = this.#layerEls.get(layer.id)?.firstElementChild as HTMLElement | null;
      if (content) content.style.opacity = String(opacity);
    }
  }

  async #animateBoundContent(dataKeys: Set<string>, phase: 'out' | 'in'): Promise<void> {
    if (dataKeys.size === 0) return;
    const animations: Animation[] = [];
    for (const layer of this.activeDescriptor.layers) {
      const bindings = layer.bindings ?? (layer.binding ? [layer.binding] : []);
      if (
        !bindings.some((binding) => dataKeys.has(binding.dataKey)) &&
        ![...(this.#rules?.dataKeysFor(layer.id) ?? [])].some((key) => dataKeys.has(key)) &&
        !dataKeys.has(layer.collectionItem?.dataKey ?? '')
      ) {
        continue;
      }
      const content = this.#layerEls.get(layer.id)?.firstElementChild as HTMLElement | null;
      if (!content) continue;
      const transition = layer.updateTransition ?? {
        style: 'inherit' as const,
        durationFrames: 0,
        distance: 24,
      };
      const style = transition.style === 'inherit' ? 'crossfade' : transition.style;
      const frames = transition.durationFrames || this.descriptor.updateTransitionFrames || 0;
      if (style === 'none' || frames <= 0) continue;
      const durationMs = (frames / this.descriptor.frameRate) * 500;
      const distance = transition.distance;
      const vector =
        style === 'slide-left'
          ? [-distance, 0]
          : style === 'slide-right'
            ? [distance, 0]
            : style === 'slide-up'
              ? [0, -distance]
              : style === 'slide-down'
                ? [0, distance]
                : [0, 0];
      const resting = { opacity: 1, transform: 'translate(0px, 0px)' };
      const shifted = {
        opacity: 0,
        transform: `translate(${vector[0]}px, ${vector[1]}px)`,
      };
      const animation = content.animate(phase === 'out' ? [resting, shifted] : [shifted, resting], {
        duration: durationMs,
        easing: 'ease-in-out',
        fill: 'forwards',
      });
      animations.push(animation);
    }
    this.#updateAnimations = animations;
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
    if (this.#updateAnimations === animations) this.#updateAnimations = [];
  }

  #stopLoopRendering(): void {
    if (this.#loopAnimationFrame !== null && typeof cancelAnimationFrame !== 'undefined') {
      this.#cancelFrame(this.#loopAnimationFrame);
    }
    this.#loopAnimationFrame = null;
    this.#activeLoopEpochs.clear();
  }

  #renderLoopSnapshot(clockMs: number, epochs = this.#activeLoopEpochs): void {
    const baseFrame = (this.#timeline?.time() ?? 0) * this.descriptor.frameRate;
    const states = new Map<string, ReturnType<typeof sampleCompiledLayerVisualState>>();
    for (const layer of this.activeDescriptor.layers) {
      const direct = this.#directLifecycleTransition;
      const directLayer = direct?.layers.get(layer.id);
      const directDistance = direct ? Math.abs(direct.targetFrame - direct.startFrame) : 0;
      const directProgress =
        !direct || directDistance === 0
          ? 1
          : Math.min(1, Math.abs(baseFrame - direct.startFrame) / directDistance);
      const epoch = epochs.get(layer.id);
      const elapsedFrames =
        epoch === undefined
          ? undefined
          : Math.max(0, ((clockMs - epoch) / 1000) * this.descriptor.frameRate);
      const state =
        direct && directLayer
          ? interpolateCompiledLayerVisualState(
              layer,
              directLayer.source,
              directLayer.target,
              directProgress,
              direct.targetFrame,
              this.#lastData,
            )
          : sampleCompiledLayerVisualState(layer, baseFrame, elapsedFrames, this.#lastData);
      if (direct && directLayer) state.expressionExitProgress = directProgress;
      const correction = this.#loopExitCorrection?.layers.get(layer.id);
      if (!direct && correction && this.#loopExitCorrection) {
        const distance = Math.abs(
          this.#loopExitCorrection.targetFrame - this.#loopExitCorrection.startFrame,
        );
        const progress =
          distance === 0
            ? 1
            : Math.min(1, Math.abs(baseFrame - this.#loopExitCorrection.startFrame) / distance);
        const remaining = 1 - progress;
        for (const [property, delta] of Object.entries(correction.transform) as [
          keyof LayerTransform,
          number,
        ][]) {
          state.transform[property] += delta * remaining;
        }
        for (const [property, delta] of Object.entries(correction.effects) as [
          (typeof EFFECT_ANIMATION_PROPERTIES)[number],
          number,
        ][]) {
          state.effects[property] += delta * remaining;
        }
        for (const [property, delta] of Object.entries(correction.stack))
          state.effects = withEffectParameter(
            state.effects,
            property,
            Number(effectParameterValue(state.effects, property)) + delta * remaining,
          );
        for (const [property, delta] of Object.entries(correction.paint) as [
          AnimatableLayerProperty,
          number,
        ][]) {
          const sampled = state.paintTracks[property]?.[0];
          if (sampled) sampled.value += delta * remaining;
          else if (remaining > 0 && parseShaderAnimationProperty(property)) {
            const value =
              getShaderAnimationValue(this.#resolveLayerElement(layer), property) +
              delta * remaining;
            state.paintTracks[property] = [
              { id: `${layer.id}:${property}:loop-exit`, frame: 0, value, easing: 'linear' },
            ];
          }
        }
        if (remaining > 0) {
          for (const [property, value] of Object.entries(correction.discreteShader) as [
            AnimatableLayerProperty,
            number,
          ][]) {
            state.paintTracks[property] = [
              { id: `${layer.id}:${property}:loop-exit`, frame: 0, value, easing: 'linear' },
            ];
          }
        }
      }
      state.effects = resolveBoundEffects(layer, this.#lastData, state.effects);
      states.set(layer.id, state);
    }
    applyCompiledAutoLayout(this.activeDescriptor, states, this.#lastData, this.#layerEls);
    applyCompiledMotionPaths(this.activeDescriptor, states);
    for (const layer of this.activeDescriptor.layers) {
      const element = this.#layerEls.get(layer.id);
      const state = states.get(layer.id);
      if (element && state) applyCompiledLayerVisualState(element, state);
    }
    applyCompiledMasks(this.activeDescriptor, this.#layerEls, states, this.#lastData);
  }

  #createDirectLifecycleTransition(
    startFrame: number,
    targetFrame: number,
    clockMs: number,
    epochs = this.#activeLoopEpochs,
    data = this.#lastData,
  ): DirectLifecycleTransition {
    const layers = new Map<
      string,
      DirectLifecycleTransition['layers'] extends Map<string, infer V> ? V : never
    >();
    for (const layer of this.activeDescriptor.layers) {
      const epoch = epochs.get(layer.id);
      const elapsedFrames =
        epoch === undefined
          ? undefined
          : Math.max(0, ((clockMs - epoch) / 1000) * this.descriptor.frameRate);
      layers.set(layer.id, {
        source: sampleCompiledLayerVisualState(layer, startFrame, elapsedFrames, data),
        target: sampleCompiledLayerVisualState(layer, targetFrame, undefined, data),
      });
    }
    return { startFrame, targetFrame, layers };
  }

  #renderDirectLifecycleTransition(transition: DirectLifecycleTransition, progress: number): void {
    const states = new Map<string, ReturnType<typeof sampleCompiledLayerVisualState>>();
    for (const layer of this.activeDescriptor.layers) {
      const resolved = transition.layers.get(layer.id);
      if (!resolved) continue;
      const state = interpolateCompiledLayerVisualState(
        layer,
        resolved.source,
        resolved.target,
        progress,
        transition.targetFrame,
        this.#lastData,
      );
      state.expressionExitProgress = Math.min(1, Math.max(0, progress));
      state.effects = resolveBoundEffects(layer, this.#lastData, state.effects);
      states.set(layer.id, state);
    }
    applyCompiledAutoLayout(this.activeDescriptor, states, this.#lastData, this.#layerEls);
    applyCompiledMotionPaths(this.activeDescriptor, states);
    for (const layer of this.activeDescriptor.layers) {
      const element = this.#layerEls.get(layer.id);
      const state = states.get(layer.id);
      if (element && state) applyCompiledLayerVisualState(element, state);
    }
    applyCompiledMasks(this.activeDescriptor, this.#layerEls, states, this.#lastData);
  }

  #beginDirectLifecycleTransition(targetFrame: number, clockMs: number): void {
    const startFrame = (this.#timeline?.time() ?? 0) * this.descriptor.frameRate;
    this.#loopExitCorrection = null;
    this.#directLifecycleTransition = this.#createDirectLifecycleTransition(
      startFrame,
      targetFrame,
      clockMs,
    );
  }

  #beginLoopExit(
    targetFrame: number,
    clockMs: number,
    shouldExit: (layer: CompiledGraphicDescriptor['layers'][number]) => boolean,
    baseFrame = (this.#timeline?.time() ?? 0) * this.descriptor.frameRate,
    epochs = this.#activeLoopEpochs,
    data = this.#lastData,
  ): void {
    this.#directLifecycleTransition = null;
    const layers = new Map<
      string,
      LoopExitCorrection['layers'] extends Map<string, infer V> ? V : never
    >();
    for (const layer of this.activeDescriptor.layers) {
      const epoch = epochs.get(layer.id);
      if (epoch === undefined || !layer.loop || !shouldExit(layer)) continue;
      const elapsed = Math.max(0, ((clockMs - epoch) / 1000) * this.descriptor.frameRate);
      const looped = sampleCompiledLayerVisualState(layer, baseFrame, elapsed, data);
      const base = sampleCompiledLayerVisualState(layer, baseFrame, undefined, data);
      const transform: Partial<LayerTransform> = {};
      const effects: Partial<Record<(typeof EFFECT_ANIMATION_PROPERTIES)[number], number>> = {};
      const paint: Partial<Record<AnimatableLayerProperty, number>> = {};
      const discreteShader: Partial<Record<AnimatableLayerProperty, number>> = {};
      const boundElement = this.#resolveLayerElement(layer, data);
      for (const property of Object.keys(layer.loop.tracks) as AnimatableLayerProperty[]) {
        if (!layer.loop.tracks[property]?.length) continue;
        if (TRANSFORM_ANIMATION_PROPERTIES.includes(property as keyof LayerTransform)) {
          const key = property as keyof LayerTransform;
          transform[key] =
            (looped.transform[key] ?? (key === 'scaleX' || key === 'scaleY' ? 1 : 0)) -
            (base.transform[key] ?? (key === 'scaleX' || key === 'scaleY' ? 1 : 0));
        } else if (EFFECT_ANIMATION_PROPERTIES.some((candidate) => candidate === property)) {
          const key = property as (typeof EFFECT_ANIMATION_PROPERTIES)[number];
          effects[key] = looped.effects[key] - base.effects[key];
        } else if (isGradientStopOffsetProperty(property) || property === 'strokeWidth') {
          paint[property] =
            (looped.paintTracks[property]?.[0]?.value ?? 0) -
            (base.paintTracks[property]?.[0]?.value ?? 0);
        } else if (shaderAnimationPropertySpec(boundElement, property)) {
          const fallback = getShaderAnimationValue(boundElement, property);
          const value = looped.paintTracks[property]?.[0]?.value ?? fallback;
          if (shaderAnimationPropertySpec(boundElement, property)!.discrete)
            discreteShader[property] = value;
          else paint[property] = value - (base.paintTracks[property]?.[0]?.value ?? fallback);
        }
      }
      const stack: Record<string, number> = {};
      for (const property of numericEffectProperties(layer.effects))
        if (layer.loop.tracks[property]?.length)
          stack[property] =
            Number(effectParameterValue(looped.effects, property)) -
            Number(effectParameterValue(base.effects, property));
      layers.set(layer.id, { transform, effects, paint, stack, discreteShader });
    }
    this.#loopExitCorrection =
      layers.size > 0 ? { startFrame: baseFrame, targetFrame, layers } : null;
  }

  #ensureLoopRendering(): void {
    if (
      this.#renderType !== 'realtime' ||
      this.#activeLoopEpochs.size === 0 ||
      this.#loopAnimationFrame !== null ||
      typeof requestAnimationFrame === 'undefined'
    ) {
      return;
    }
    const render = (now: number) => {
      this.#loopAnimationFrame = null;
      if (this.#activeLoopEpochs.size === 0 || this.#renderType !== 'realtime') return;
      this.#renderLoopSnapshot(now);
      this.#loopAnimationFrame = this.#requestFrame(render);
    };
    this.#loopAnimationFrame = this.#requestFrame(render);
  }

  #activateLoopsAtStep(step: number | undefined, epochMs: number, firstStep: boolean): void {
    const stepKeyframeId = step === undefined ? undefined : this.descriptor.stepKeyframeIds[step];
    for (const layer of this.activeDescriptor.layers) {
      const activation =
        layer.element.type === 'pattern' || layer.lighting
          ? { type: 'lifecycle' as const }
          : layer.loop?.activation;
      if (!activation) continue;
      if (activation.type === 'lifecycle') {
        if (firstStep || !this.#activeLoopEpochs.has(layer.id)) {
          this.#activeLoopEpochs.set(layer.id, epochMs);
        }
      } else if (activation.type === 'step' && activation.stepKeyframeId === stepKeyframeId) {
        this.#activeLoopEpochs.set(layer.id, epochMs);
      }
    }
    this.#ensureLoopRendering();
  }

  #deactivateStepLoops(): void {
    for (const layer of this.activeDescriptor.layers) {
      if (layer.loop?.activation.type === 'step') this.#activeLoopEpochs.delete(layer.id);
    }
  }

  #deactivateAllLoops(): void {
    this.#stopLoopRendering();
  }

  #documentFontsReady: Promise<void> = Promise.resolve();

  #buildDom(): void {
    const shadow = this.shadowRoot;
    if (!shadow) return;
    const descriptor = this.descriptor;
    const errors = scriptingErrors(descriptor);
    if (errors.length) throw new Error(errors.join('\n'));
    this.#documentFontsReady = registerDocumentFonts(this.ownerDocument, descriptor.fonts ?? []);
    const expanded = expandRuntimeCollections(descriptor);
    // This instance's own layer copies: rule output is published per layer object, and several
    // instances of one graphic may share the static descriptor.
    this.#renderDescriptor = {
      ...expanded,
      ...(descriptor.scripting ? { scripting: structuredClone(descriptor.scripting) } : {}),
      layers: expanded.layers.map((layer) => ({ ...layer })),
    };

    const renderDescriptor = this.activeDescriptor;
    this.#clearRuleTimers();
    this.#ruleFadingLayers.clear();
    this.#rules = new RuntimeVisualRules(renderDescriptor.layers, descriptor.frameRate);
    this.#rules.update(this.#lastData, Number.NEGATIVE_INFINITY);
    this.#rules.publish(Number.POSITIVE_INFINITY);
    for (const timer of this.#clickTimers.values()) clearTimeout(timer);
    this.#clickTimers.clear();
    for (const element of this.#layerEls.values()) disposeElementContent(element);
    this.#mediaCueRuntime?.dispose();
    this.#mediaCueRuntime = null;
    shadow.replaceChildren();
    this.#clearContentAnimationFrames();

    const style = document.createElement('style');
    const fontFaces = (descriptor.fonts ?? [])
      .map((font) => {
        const family = font.family.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
        const source = font.source.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
        const format =
          font.mimeType === 'font/woff2'
            ? 'woff2'
            : font.mimeType === 'font/woff'
              ? 'woff'
              : font.mimeType === 'font/otf'
                ? 'opentype'
                : 'truetype';
        return `@font-face { font-family: "${family}"; src: url("${source}") format("${format}"); font-style: ${font.style || 'normal'}; font-weight: ${font.weight || '100 900'}; font-display: block; }`;
      })
      .join('\n');
    style.textContent = `${fontFaces}\n:host { display: block; position: relative; overflow: hidden; isolation: isolate; }`;
    shadow.appendChild(style);

    const mediaCueHost = document.createElement('div');
    mediaCueHost.dataset.ografMediaCues = 'true';
    mediaCueHost.style.display = 'none';
    shadow.appendChild(mediaCueHost);
    this.#mediaCueRuntime = new MediaCueRuntime(
      mediaCueHost,
      descriptor,
      (cue, source, timestampMs) => this.#switchMediaCueVisual(cue, source, timestampMs),
    );

    this.style.width = `${descriptor.width}px`;
    this.style.height = `${descriptor.height}px`;
    this.style.backgroundColor = descriptor.backgroundColor;

    this.#layerEls.clear();
    for (const layer of renderDescriptor.layers) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      el.style.boxSizing = 'border-box';
      el.style.display = this.#visualRuleVisible(layer) ? '' : 'none';
      const pointerTriggers = pointerVisualRuleTriggers(layer);
      el.style.pointerEvents = pointerTriggers.size > 0 ? 'auto' : 'none';
      if (pointerTriggers.has('click') || pointerTriggers.has('double-click'))
        el.style.cursor = 'pointer';
      if (pointerTriggers.size > 0) {
        el.addEventListener('pointerenter', (event) => {
          if (event.pointerType !== 'touch') this.#pointerHover(layer, true);
        });
        el.addEventListener('pointerleave', (event) => {
          if (event.pointerType !== 'touch') this.#pointerHover(layer, false);
        });
        el.addEventListener('click', (event) => {
          if (event.detail > 1) return;
          if (pointerTriggers.has('double-click')) {
            const pending = this.#clickTimers.get(layer.id);
            if (pending) clearTimeout(pending);
            this.#clickTimers.set(
              layer.id,
              setTimeout(() => {
                this.#clickTimers.delete(layer.id);
                this.#triggerPointerRule(layer, 'click');
              }, 500),
            );
          } else {
            this.#triggerPointerRule(layer, 'click');
          }
        });
        el.addEventListener('dblclick', () => {
          const pending = this.#clickTimers.get(layer.id);
          if (pending) clearTimeout(pending);
          this.#clickTimers.delete(layer.id);
          this.#triggerPointerRule(layer, 'double-click');
        });
      }
      if (layer.collectionItem) {
        el.dataset.ografCollectionId = layer.collectionItem.collectionId;
        el.dataset.ografCollectionIndex = String(layer.collectionItem.slot);
        el.dataset.ografCollectionDataKey = layer.collectionItem.dataKey;
      }
      el.style.mixBlendMode =
        !layer.blendMode || layer.blendMode === 'normal' ? '' : layer.blendMode;
      const firstTransform = [...layer.keyframes].sort((a, b) => a.frame - b.frame)[0]?.transform;
      if (firstTransform) {
        el.style.width = `${firstTransform.width}px`;
        el.style.height = `${firstTransform.height}px`;
      }
      shadow.appendChild(el);
      renderElementContent(
        el,
        this.#resolveLayerElement(layer),
        0,
        contentOptions(layer, descriptor.frameRate),
      );
      applyLayerEffectsFilter(el, layer.effects, 0);
      this.#layerEls.set(layer.id, el);
    }

    this.#syncCollectionVisibility();

    this.#timeline?.kill();
    this.#timeline = buildRuntimeTimeline(renderDescriptor, this.#layerEls, () => this.#lastData);
  }

  #setContentRenderingMode(): void {
    const root = this.shadowRoot;
    if (root) setLottieDeterministicRendering(root, this.#renderType === 'non-realtime');
  }

  async #switchMediaCueVisual(
    cue: NonNullable<CompiledGraphicDescriptor['mediaCues']>[number],
    source: NonNullable<CompiledGraphicDescriptor['mediaCues']>[number]['sources'][number],
    timestampMs: number,
  ): Promise<void> {
    const targetLayerId = cue.visual.targetLayerId;
    if (!targetLayerId || (source.kind === 'clip' && source.mediaType === 'audio')) return;
    const layer = this.activeDescriptor.layers.find((candidate) => candidate.id === targetLayerId);
    const element = this.#layerEls.get(targetLayerId);
    if (!layer || !element || !('fill' in layer.element)) return;

    let outgoing: HTMLCanvasElement | null = null;
    const currentCanvas = element.querySelector<HTMLCanvasElement>(
      'canvas[data-ograf-media-canvas="true"]',
    );
    if (cue.transition.type === 'crossfade' && currentCanvas) {
      outgoing = element.ownerDocument.createElement('canvas');
      outgoing.width = currentCanvas.width;
      outgoing.height = currentCanvas.height;
      outgoing.getContext('2d')?.drawImage(currentCanvas, 0, 0);
      Object.assign(outgoing.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '20',
      });
    }

    const nextElement = {
      ...layer.element,
      fill: {
        type: 'media' as const,
        source:
          source.kind === 'clip'
            ? { kind: 'clip' as const, src: source.src }
            : {
                kind: 'live' as const,
                tag: source.tag,
                ...(source.fallback ? { fallback: source.fallback } : {}),
              },
        fit: cue.visual.fit,
        positionX: cue.visual.positionX,
        positionY: cue.visual.positionY,
        loop: cue.loop,
        speed: cue.speed,
        offsetMs: cue.trimStartMs,
        trimEndMs: cue.trimEndMs,
        timelineStartMs: timestampMs,
        muted: true as const,
      },
    };
    renderElementContent(
      element,
      nextElement,
      0,
      contentOptions(layer, this.activeDescriptor.frameRate),
    );
    await waitForElementContentReady(element);
    if (!outgoing) return;
    element.appendChild(outgoing);
    const durationMs =
      (Math.max(1, cue.transition.durationFrames) / this.descriptor.frameRate) * 1000;
    if (typeof outgoing.animate !== 'function') {
      outgoing.remove();
      return;
    }
    const animation = outgoing.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: durationMs,
      easing: 'linear',
      fill: 'forwards',
    });
    await animation.finished.catch(() => undefined);
    outgoing.remove();
  }

  async #awaitContentReady(): Promise<void> {
    const root = this.shadowRoot;
    await this.#documentFontsReady;
    if (root) await waitForElementContentReady(root);
    if (this.#contentPlaybackError) throw this.#contentPlaybackError;
  }

  #remountAnimatedCanvasContent(): void {
    for (const layer of this.activeDescriptor.layers) {
      if (
        !hasElementShaderPaint(layer.element) &&
        !hasElementMediaPaint(layer.element) &&
        (layer.element.type !== 'lottie' || !layer.element.animationData)
      )
        continue;
      const element = this.#layerEls.get(layer.id);
      if (!element) continue;
      renderElementContent(
        element,
        this.#resolveLayerElement(layer),
        0,
        contentOptions(layer, this.activeDescriptor.frameRate),
      );
    }
  }

  #startRealtimeContentAnimations(): void {
    this.#clearContentAnimationFrames();
    const layers = this.activeDescriptor.layers.filter(
      (layer) =>
        (layer.element.type === 'image-sequence' && layer.element.frames.length > 0) ||
        (layer.element.type === 'lottie' && !!layer.element.animationData) ||
        hasElementShaderPaint(layer.element) ||
        hasElementMediaPaint(layer.element) ||
        getEffectStack(layer.effects).some(
          (effect) => effect.type === 'shader' && effectEnabled(effect, layer.effects),
        ),
    );
    if (
      (layers.length === 0 && (this.activeDescriptor.mediaCues?.length ?? 0) === 0) ||
      typeof requestAnimationFrame === 'undefined'
    )
      return;
    const epoch = performance.now();
    const render = (now: number) => {
      this.#contentAnimationFrame = null;
      const elapsedMs = Math.max(0, now - epoch);
      try {
        this.#renderAnimatedContentAt(elapsedMs);
      } catch (error) {
        if (error instanceof ShaderContextLostError) {
          this.#contentAnimationFrame = this.#requestFrame(render);
          return;
        }
        this.#contentPlaybackError = error instanceof Error ? error : new Error(String(error));
        return;
      }
      const shouldContinue =
        (this.activeDescriptor.mediaCues?.length ?? 0) > 0 ||
        layers.some((layer) => {
          const element = layer.element;
          if (
            element.type === 'lottie' ||
            hasElementShaderPaint(element) ||
            hasElementMediaPaint(element) ||
            getEffectStack(layer.effects).some(
              (effect) => effect.type === 'shader' && effectEnabled(effect, layer.effects),
            )
          )
            return true;
          if (element.type !== 'image-sequence') return false;
          return (
            element.loop || elapsedMs / 1000 < element.frames.length / Math.max(1, element.fps)
          );
        });
      if (shouldContinue) this.#contentAnimationFrame = this.#requestFrame(render);
    };
    this.#contentAnimationFrame = this.#requestFrame(render);
  }

  #renderAnimatedContentAt(timestampMs: number): void {
    this.#mediaCueRuntime?.renderAtTime(timestampMs, { includeAudio: false });
    for (const layer of this.activeDescriptor.layers) {
      const shaderEffect = getEffectStack(layer.effects).some(
        (effect) => effect.type === 'shader' && effectEnabled(effect, layer.effects),
      );
      if (
        layer.element.type !== 'image-sequence' &&
        layer.element.type !== 'lottie' &&
        !hasElementShaderPaint(layer.element) &&
        !hasElementMediaPaint(layer.element) &&
        !shaderEffect
      )
        continue;
      const el = this.#layerEls.get(layer.id);
      if (!el) continue;
      // Shader uniforms belong to the mounted, data-resolved element. Frame ticks only advance
      // time; passing the authored descriptor here must never reset a live parameter binding.
      if (
        layer.element.type === 'image-sequence' ||
        layer.element.type === 'lottie' ||
        hasElementShaderPaint(layer.element) ||
        hasElementMediaPaint(layer.element)
      )
        renderAnimatedElementAtTime(el, layer.element, timestampMs);
      if (shaderEffect) {
        const state = sampleCompiledLayerVisualState(
          layer,
          (this.#timeline?.time() ?? 0) * this.descriptor.frameRate,
          undefined,
          this.#lastData,
        );
        applyLayerEffectsFilter(el, state.effects, timestampMs);
      }
    }
  }

  #refreshBoundLayers(): void {
    for (const layer of this.activeDescriptor.layers) {
      if (!layerHasRuntimeVisualInputs(layer) && !this.#rules?.targeted.has(layer.id)) continue;
      const el = this.#layerEls.get(layer.id);
      if (el) {
        const element = this.#resolveLayerElement(layer);
        const serialized = JSON.stringify(element);
        if (el.dataset.ografRenderedElement !== serialized) {
          renderElementContent(
            el,
            element,
            0,
            contentOptions(layer, this.activeDescriptor.frameRate),
          );
          setLottieDeterministicRendering(el, this.#renderType === 'non-realtime');
        }
        const state = sampleCompiledLayerVisualState(
          layer,
          (this.#timeline?.time() ?? 0) * this.descriptor.frameRate,
          undefined,
          this.#lastData,
        );
        applyLayerEffectsFilter(el, state.effects, (this.#timeline?.time() ?? 0) * 1000);
        applyAnimatedPaint(
          el,
          layer.animationTracks,
          (this.#timeline?.time() ?? 0) * this.descriptor.frameRate,
        );
        if (element.type === 'text') {
          renderTextAnimationAtFrame(
            el,
            element,
            (this.#timeline?.time() ?? 0) * this.activeDescriptor.frameRate,
          );
        }
        if (element.type === 'chart') {
          renderChartAnimationAtFrame(
            el,
            element,
            (this.#timeline?.time() ?? 0) * this.activeDescriptor.frameRate,
          );
        }
      }
    }
    this.#syncCollectionVisibility();
  }

  #syncCollectionVisibility(): void {
    const previousSlots = new Map<string, number>();
    for (const layer of this.activeDescriptor.layers) {
      const el = this.#layerEls.get(layer.id);
      const key = el?.dataset.ografCollectionKey;
      if (key && layer.collectionItem)
        previousSlots.set(
          `${layer.collectionItem.collectionId}\u0000${key}`,
          layer.collectionItem.slot,
        );
    }
    for (const layer of this.activeDescriptor.layers) {
      const el = this.#layerEls.get(layer.id);
      if (!el) continue;
      const active = isRuntimeCollectionLayerActive(layer, this.#lastData);
      el.style.display = this.#visualRuleVisible(layer) && active ? '' : 'none';
      const fade = visualRuleEffectFor(layer, this.#lastData)?.contentOpacity;
      const fadeContent = el.firstElementChild as HTMLElement | null;
      if (fade !== undefined) {
        if (fadeContent) fadeContent.style.opacity = String(fade);
        this.#ruleFadingLayers.add(layer.id);
      } else if (this.#ruleFadingLayers.delete(layer.id) && fadeContent)
        fadeContent.style.opacity = '';
      if (!layer.collectionItem || !active) {
        delete el.dataset.ografCollectionKey;
        continue;
      }
      const selection = runtimeCollectionItemSelection(layer, this.#lastData);
      if (!selection) continue;
      const previousSlot = previousSlots.get(
        `${layer.collectionItem.collectionId}\u0000${selection.key}`,
      );
      const previousKey = el.dataset.ografCollectionKey;
      el.dataset.ografCollectionKey = selection.key;
      if (previousSlot === undefined || previousSlot === layer.collectionItem.slot || !previousKey)
        continue;
      const content = el.firstElementChild as HTMLElement | null;
      const dx = layer.collectionItem.offsetPerItem.x * (previousSlot - layer.collectionItem.slot);
      const dy = layer.collectionItem.offsetPerItem.y * (previousSlot - layer.collectionItem.slot);
      content?.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.65 },
          { transform: 'translate(0px, 0px)', opacity: 1 },
        ],
        { duration: 240, easing: 'ease-out' },
      );
    }
  }

  #applyData(data: unknown, depth = 0): void {
    if (!data || typeof data !== 'object') return;
    const previousData = this.#lastData;
    const nextData = { ...this.#lastData, ...(data as Record<string, unknown>) };
    const fired = this.#rules?.dataChanged(previousData, nextData) ?? [];
    this.#lastData = nextData;
    this.#runRules(fired, depth);
  }

  #pointerHover(layer: CompiledGraphicDescriptor['layers'][number], hovered: boolean): void {
    if (this.#renderType !== 'realtime' || !this.#rules) return;
    this.#rules.hoverChanged(layer.id, hovered, this.#lastData);
    this.#triggerPointerRule(layer, hovered ? 'pointer-enter' : 'pointer-leave');
  }

  #triggerPointerRule(
    layer: CompiledGraphicDescriptor['layers'][number],
    trigger: 'click' | 'double-click' | 'pointer-enter' | 'pointer-leave',
  ): void {
    if (this.#renderType !== 'realtime' || !this.#rules) return;
    this.#runRules(this.#rules.eventFired(trigger, this.#lastData, { hostLayerId: layer.id }));
  }

  #runVisualRuleEventActions(triggered: VisualRuleAction[], depth = 0): void {
    const eventKeys = new Set<string>();
    for (const action of triggered) {
      const eventKey = JSON.stringify(action);
      if (eventKeys.has(eventKey)) continue;
      eventKeys.add(eventKey);
      if (action.type === 'custom-action' || action.type === 'shader-animation') {
        void this.#customActionUnlocked(
          { id: action.actionId, payload: {}, skipAnimation: false },
          depth + 1,
        );
        continue;
      }
      if (action.type !== 'play-sound' && action.type !== 'take-media') continue;
      const cue = this.activeDescriptor.mediaCues?.find(
        (candidate) => candidate.id === action.cueId,
      );
      if (!cue) continue;
      const sourceId =
        action.type === 'take-media' && action.sourceId ? action.sourceId : cue.activeSourceId;
      void this.#mediaCueRuntime?.take(cue.id, sourceId, (this.#timeline?.time() ?? 0) * 1000);
    }
  }

  #replaceData(data: unknown): void {
    const nextData =
      data && typeof data === 'object' ? { ...(data as Record<string, unknown>) } : {};
    this.#validateShaderData(nextData);
    this.#clearRuleTimers();
    this.#rules?.reset();
    this.#lastData = nextData;
    this.#rules?.update(nextData, Number.NEGATIVE_INFINITY);
    this.#rules?.publish(Number.POSITIVE_INFINITY);
    this.#refreshBoundLayers();
  }

  #validateShaderData(data: Record<string, unknown>): void {
    for (const layer of this.activeDescriptor.layers) {
      const element = resolveBoundElement(layer, data);
      for (const { paint } of getElementShaderPaints(element)) resolveShaderParameters(paint);
    }
  }

  async #seekToKeyframeId(
    keyframeId: string | null,
    skipAnimation?: boolean,
    durationSeconds?: number,
    includeAudio = true,
  ): Promise<void> {
    const keyframe = this.descriptor.keyframes.find((k) => k.id === keyframeId);
    const tl = this.#timeline;
    if (!keyframe || !tl) return;
    const targetSeconds = keyframe.frame / this.descriptor.frameRate;
    this.#activeTween?.kill();
    this.#activeTween = null;
    if (skipAnimation) {
      this.#loopExitCorrection = null;
      this.#directLifecycleTransition = null;
      tl.seek(targetSeconds, true);
      if (includeAudio) this.#mediaCueRuntime?.renderAtTime(targetSeconds * 1000);
    } else {
      await new Promise<void>((resolve) => {
        const finish = () => {
          this.#activeTween = null;
          this.#loopExitCorrection = null;
          this.#directLifecycleTransition = null;
          this.#renderLoopSnapshot(
            typeof performance !== 'undefined' ? performance.now() : Date.now(),
          );
          if (includeAudio) this.#mediaCueRuntime?.renderAtTime(targetSeconds * 1000);
          resolve();
        };
        this.#activeTween = tl.tweenTo(targetSeconds, {
          ...(durationSeconds !== undefined ? { duration: durationSeconds, ease: 'none' } : {}),
          onUpdate: () => {
            this.#renderLoopSnapshot(
              typeof performance !== 'undefined' ? performance.now() : Date.now(),
            );
            if (includeAudio) this.#mediaCueRuntime?.renderAtTime(tl.time() * 1000);
          },
          onComplete: finish,
          onInterrupt: finish,
        });
      });
    }
  }

  async load(params: LoadParams): Promise<ReturnPayload | undefined> {
    return this.#serializeOperation(() => this.#loadUnlocked(params));
  }

  async #loadUnlocked(params: LoadParams): Promise<ReturnPayload | undefined> {
    try {
      for (const timer of this.#clickTimers.values()) clearTimeout(timer);
      this.#clickTimers.clear();
      this.#clearRuleTimers();
      this.#cancelUpdateAnimations();
      this.#stopLoopRendering();
      this.#clearContentAnimationFrames();
      this.#clearTextAnimationFrames();
      this.#clearChartAnimationFrames();
      this.#contentPlaybackError = null;
      this.#mediaCueRuntime?.reset();
      this.#renderType = params.renderType;
      if (!this.#timeline) this.#buildDom();
      this.#replaceData(params.data);
      this.#remountAnimatedCanvasContent();
      this.#setContentRenderingMode();
      this.#renderAnimatedContentAt(0);
      await this.#awaitContentReady();
      this.#renderAnimatedContentAt(0);
      this.#schedule = [];
      this.#scheduleBaseData = { ...this.#lastData };
      this.#currentStep = undefined;
      this.#directLifecycleTransition = null;
      await this.#seekToKeyframeId(this.descriptor.startKeyframeId, true, undefined, false);
      this.#renderLoopSnapshot(0, new Map());
      await this.#awaitContentReady();
      if (this.#renderType === 'realtime') this.#startRealtimeContentAnimations();
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  async dispose(): Promise<ReturnPayload | undefined> {
    return this.#serializeOperation(() => this.#disposeUnlocked());
  }

  async #disposeUnlocked(): Promise<ReturnPayload | undefined> {
    try {
      this.#timeline?.kill();
      this.#timeline = null;
      this.#activeTween?.kill();
      this.#activeTween = null;
      this.#clearContentAnimationFrames();
      this.#clearTextAnimationFrames();
      this.#clearChartAnimationFrames();
      this.#stopLoopRendering();
      this.#cancelUpdateAnimations();
      this.#schedule = [];
      this.#directLifecycleTransition = null;
      for (const timer of this.#clickTimers.values()) clearTimeout(timer);
      this.#clickTimers.clear();
      this.#clearRuleTimers();
      for (const element of this.#layerEls.values()) disposeElementContent(element);
      this.#layerEls.clear();
      this.#mediaCueRuntime?.dispose();
      this.#mediaCueRuntime = null;
      this.#renderDescriptor = null;
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  async updateAction(params: UpdateActionParams): Promise<ReturnPayload | undefined> {
    if ((this.descriptor.updateInterruption ?? 'queue') === 'replace') {
      const generation = ++this.#updateGeneration;
      this.#cancelUpdateAnimations();
      return this.#updateActionUnlocked(params, generation);
    }
    return this.#serializeOperation(() =>
      this.#updateActionUnlocked(params, ++this.#updateGeneration),
    );
  }

  async #updateActionUnlocked(
    params: UpdateActionParams,
    generation = this.#updateGeneration,
  ): Promise<ReturnPayload | undefined> {
    try {
      await this.#awaitContentReady();
      if (params.data && typeof params.data === 'object') {
        this.#validateShaderData({
          ...this.#lastData,
          ...(params.data as Record<string, unknown>),
        });
      }
      this.#cancelUpdateAnimations();
      const keys = this.#changedBindingKeys(params.data);
      const changedTextKeys = new Set(
        params.data && typeof params.data === 'object'
          ? Object.entries(params.data as Record<string, unknown>)
              .filter(([key, value]) => !Object.is(this.#lastData[key], value))
              .map(([key]) => key)
          : [],
      );
      const hasTransition = this.activeDescriptor.layers.some((layer) => {
        const transition = layer.updateTransition;
        return (
          (transition?.style ?? 'inherit') !== 'none' &&
          ((transition?.durationFrames ?? 0) > 0 ||
            (this.descriptor.updateTransitionFrames ?? 0) > 0)
        );
      });
      if (params.skipAnimation || !hasTransition || keys.size === 0) {
        this.#applyData(params.data);
        if (!params.skipAnimation) this.#replayUpdatedText(changedTextKeys);
        this.#startChartAnimations(Boolean(params.skipAnimation), changedTextKeys);
        await this.#awaitContentReady();
        return { statusCode: 200 };
      }
      await this.#animateBoundContent(keys, 'out');
      if (generation !== this.#updateGeneration) return { statusCode: 200 };
      this.#applyData(params.data);
      this.#replayUpdatedText(changedTextKeys);
      this.#startChartAnimations(false, changedTextKeys);
      await this.#awaitContentReady();
      await this.#animateBoundContent(keys, 'in');
      if (generation !== this.#updateGeneration) return { statusCode: 200 };
      await this.#awaitContentReady();
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  #resolvePlayTarget(currentStep: number | undefined, params: PlayActionParams) {
    return resolvePlayTarget(
      this.descriptor.stepKeyframeIds,
      this.descriptor.startKeyframeId,
      this.descriptor.endKeyframeId,
      currentStep,
      params,
    );
  }

  async playAction(params: PlayActionParams): Promise<PlayActionReturnPayload> {
    this.#mediaCueRuntime?.resumeBlocked();
    return this.#serializeOperation(() => this.#playActionUnlocked(params));
  }

  async #playActionUnlocked(params: PlayActionParams): Promise<PlayActionReturnPayload> {
    try {
      await this.#awaitContentReady();
      const previousStep = this.#currentStep;
      if (
        previousStep === undefined &&
        this.#timeline &&
        this.#timeline.time() >= this.#timeline.duration() - 0.000_001
      ) {
        // A new IN after completing OUT is a new playout cycle, so one-shot sounds may arm again.
        this.#mediaCueRuntime?.reset();
      }
      const target = this.#resolvePlayTarget(this.#currentStep, params);
      const targetFrame =
        this.descriptor.keyframes.find((keyframe) => keyframe.id === target.keyframeId)?.frame ?? 0;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const exitsToEnd =
        previousStep !== undefined && target.keyframeId === this.descriptor.endKeyframeId;
      if (previousStep === undefined && target.currentStep !== undefined)
        this.#startChartAnimations(Boolean(params.skipAnimation));
      if (exitsToEnd) this.#beginDirectLifecycleTransition(targetFrame, now);
      else {
        this.#beginLoopExit(
          targetFrame,
          now,
          (layer) => target.currentStep === undefined || layer.loop?.activation.type === 'step',
        );
      }
      this.#deactivateStepLoops();
      if (target.currentStep === undefined) {
        this.#deactivateAllLoops();
        this.#fireLifecycleRules('stop');
      }
      const exitDurationSeconds = exitsToEnd
        ? (this.descriptor.transitions.find(
            (transition) => transition.toKeyframeId === this.descriptor.endKeyframeId,
          )?.durationFrames ?? 0) / this.descriptor.frameRate
        : undefined;
      await this.#seekToKeyframeId(target.keyframeId, params.skipAnimation, exitDurationSeconds);
      await this.#awaitContentReady();
      this.#currentStep = target.currentStep;
      if (this.#currentStep !== undefined) {
        this.#activateLoopsAtStep(
          this.#currentStep,
          typeof performance !== 'undefined' ? performance.now() : Date.now(),
          previousStep === undefined,
        );
        if (previousStep === undefined) this.#fireLifecycleRules('play');
        this.#fireLifecycleRules('step', this.descriptor.stepKeyframeIds[this.#currentStep]);
      }
      return {
        statusCode: 200,
        ...(this.#currentStep !== undefined ? { currentStep: this.#currentStep } : {}),
      };
    } catch (err) {
      return {
        ...errorPayload(err),
        ...(this.#currentStep !== undefined ? { currentStep: this.#currentStep } : {}),
      };
    }
  }

  async stopAction(params: StopActionParams): Promise<ReturnPayload | undefined> {
    return this.#serializeOperation(() => this.#stopActionUnlocked(params));
  }

  async #stopActionUnlocked(params: StopActionParams): Promise<ReturnPayload | undefined> {
    try {
      await this.#awaitContentReady();
      const targetFrame =
        this.descriptor.keyframes.find((keyframe) => keyframe.id === this.descriptor.endKeyframeId)
          ?.frame ?? 0;
      this.#beginDirectLifecycleTransition(
        targetFrame,
        typeof performance !== 'undefined' ? performance.now() : Date.now(),
      );
      this.#deactivateAllLoops();
      this.#fireLifecycleRules('stop');
      const durationSeconds =
        (this.descriptor.transitions.find(
          (transition) => transition.toKeyframeId === this.descriptor.endKeyframeId,
        )?.durationFrames ?? 0) / this.descriptor.frameRate;
      await this.#seekToKeyframeId(
        this.descriptor.endKeyframeId,
        params.skipAnimation,
        durationSeconds,
      );
      await this.#awaitContentReady();
      this.#currentStep = undefined;
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  async customAction(params: CustomActionParams): Promise<ReturnPayload | undefined> {
    return this.#serializeOperation(() => this.#customActionUnlocked(params));
  }

  async #customActionUnlocked(
    params: CustomActionParams,
    ruleDepth = 0,
  ): Promise<ReturnPayload | undefined> {
    try {
      const action = this.descriptor.customActions.find((candidate) => candidate.id === params.id);
      if (!action) {
        return { statusCode: 404, statusMessage: `Unknown customAction id: "${params.id}"` };
      }
      await this.#awaitContentReady();
      if (params.payload && typeof params.payload === 'object') {
        this.#validateShaderData({
          ...this.#lastData,
          ...(params.payload as Record<string, unknown>),
        });
        const chartKeys = new Set(
          Object.entries(params.payload as Record<string, unknown>)
            .filter(([key, value]) => !Object.is(this.#lastData[key], value))
            .map(([key]) => key),
        );
        this.#applyData(params.payload, ruleDepth);
        this.#startChartAnimations(Boolean(params.skipAnimation), chartKeys);
        await this.#awaitContentReady();
      }
      // A rule that runs this custom action may be answered by rules again, but not endlessly.
      if (ruleDepth < MAX_RULE_CUSTOM_ACTION_DEPTH)
        this.#fireLifecycleRules('custom-action', params.id, ruleDepth);

      const layers = this.activeDescriptor.layers.filter(
        (layer) =>
          layer.loop?.activation.type === 'customAction' &&
          layer.loop.activation.customActionId === params.id,
      );
      const textLayers = this.activeDescriptor.layers.filter(
        (layer) =>
          layer.element.type === 'text' &&
          normalizeTextAnimation(layer.element.textAnimation).type !== 'none' &&
          normalizeTextAnimation(layer.element.textAnimation).customActionId === params.id,
      );
      const epoch = typeof performance !== 'undefined' ? performance.now() : Date.now();
      await this.#mediaCueRuntime?.triggerCustomAction(params.id, params.payload);
      if (!params.skipAnimation && textLayers.length > 0) {
        const textLayerIds = new Set(textLayers.map((layer) => layer.id));
        this.#triggerTextAnimationReplays((layer) => textLayerIds.has(layer.id), epoch);
      }
      if (
        params.skipAnimation ||
        (layers.length === 0 && textLayers.length === 0) ||
        action.durationFrames <= 0
      ) {
        return { statusCode: 200 };
      }

      for (const layer of layers) this.#activeLoopEpochs.set(layer.id, epoch);
      this.#renderLoopSnapshot(epoch);
      this.#ensureLoopRendering();
      const durationMs = (action.durationFrames / this.descriptor.frameRate) * 1000;
      await new Promise<void>((resolve) => {
        const owner = this.ownerDocument?.defaultView;
        if (owner) owner.setTimeout(resolve, durationMs);
        else setTimeout(resolve, durationMs);
      });
      for (const layer of layers) {
        if (this.#activeLoopEpochs.get(layer.id) === epoch) {
          this.#activeLoopEpochs.delete(layer.id);
        }
      }
      this.#renderLoopSnapshot(typeof performance !== 'undefined' ? performance.now() : Date.now());
      await this.#awaitContentReady();
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  /**
   * Re-derives the full logical state (keyframe position + bound data) implied by every scheduled
   * action at or before `timestamp`, from the `#scheduleBaseData`/keyframe-0 baseline forward —
   * NOT an incremental cursor. Replaying the full prefix every call (rather than only newly-passed
   * entries) is what makes scrubbing backward correct: a key set by an action that's since fallen
   * out of the qualifying prefix reverts to the baseline instead of staying stuck at its old value.
   */
  #applySchedule(timestamp: number): void {
    const due = this.#schedule.filter((a) => a.timestamp <= timestamp);
    this.#directLifecycleTransition = null;
    this.#loopExitCorrection = null;
    for (const host of this.#layerEls.values()) delete host.dataset.ografChartAnimationFrame;

    let step: number | undefined;
    let targetKeyframeId = this.descriptor.startKeyframeId;
    let data: Record<string, unknown> = { ...this.#scheduleBaseData };
    let displayData: Record<string, unknown> = { ...data };
    let updateOpacity = 1;
    let updateKeys = new Set<string>();
    let dataAnimation:
      | {
          startTimestamp: number;
          durationMs: number;
          oldData: Record<string, unknown>;
          newData: Record<string, unknown>;
          keys: Set<string>;
        }
      | undefined;
    const keyframeSeconds = (keyframeId: string) =>
      (this.descriptor.keyframes.find((keyframe) => keyframe.id === keyframeId)?.frame ?? 0) /
      this.descriptor.frameRate;
    let positionSeconds = keyframeSeconds(this.descriptor.startKeyframeId);
    let animation:
      | {
          startTimestamp: number;
          startSeconds: number;
          targetSeconds: number;
          durationMs: number;
          directTransition?: DirectLifecycleTransition;
        }
      | undefined;
    let directSample: { transition: DirectLifecycleTransition; progress: number } | undefined;
    let stepArrivalTimestamp: number | undefined;
    let lifecycleEpoch: number | undefined;
    const customActionEpochs = new Map<string, number>();
    const textAnimationEpochs = new Map<string, number>();
    const chartAnimationEpochs = new Map<string, { timestamp: number; skip: boolean }>();

    // Rule state is rebuilt from the schedule on every seek, like data and loop epochs: data
    // changes, lifecycle events and delayed rules are queued at their OGraf time and replayed in
    // order, so delays and rule transitions land on the same frame however the playhead arrives.
    const rules = this.#rules;
    this.#clearRuleTimers();
    rules?.reset();
    let ruleData: Record<string, unknown> = { ...this.#scheduleBaseData };
    rules?.update(ruleData, Number.NEGATIVE_INFINITY);
    type PendingRuleWork =
      | { kind: 'data'; previous: Record<string, unknown>; current: Record<string, unknown> }
      | { kind: 'event'; trigger: 'play' | 'step' | 'stop' | 'custom-action'; eventId?: string }
      | { kind: 'rule'; fired: FiredRuntimeVisualRule };
    const pendingRules: Array<{ at: number; order: number; work: PendingRuleWork }> = [];
    let pendingOrder = 0;
    const queueRuleWork = (at: number, work: PendingRuleWork) =>
      pendingRules.push({ at, order: pendingOrder++, work });
    const flushRules = (until: number): void => {
      if (!rules) return;
      for (;;) {
        let next = -1;
        for (let index = 0; index < pendingRules.length; index++) {
          const entry = pendingRules[index]!;
          const best = pendingRules[next];
          if (
            entry.at <= until &&
            (!best || entry.at < best.at || (entry.at === best.at && entry.order < best.order))
          )
            next = index;
        }
        if (next < 0) return;
        const [{ at, work }] = pendingRules.splice(next, 1) as [(typeof pendingRules)[number]];
        if (work.kind === 'data') {
          ruleData = work.current;
          for (const fired of rules.dataChanged(work.previous, work.current))
            queueRuleWork(at + rules.delayMs(fired), { kind: 'rule', fired });
        } else if (work.kind === 'event') {
          for (const fired of rules.eventFired(
            work.trigger,
            ruleData,
            work.eventId === undefined ? {} : { eventId: work.eventId },
          ))
            queueRuleWork(at + rules.delayMs(fired), { kind: 'rule', fired });
        } else rules.run(work.fired);
        rules.update(ruleData, at);
      }
    };

    const loopEpochsAt = (atTimestamp: number): Map<string, number> => {
      const epochs = new Map<string, number>();
      const stepKeyframeId = step === undefined ? undefined : this.descriptor.stepKeyframeIds[step];
      for (const layer of this.activeDescriptor.layers) {
        const activation =
          layer.element.type === 'pattern' || layer.lighting
            ? { type: 'lifecycle' as const }
            : layer.loop?.activation;
        if (
          activation?.type === 'lifecycle' &&
          lifecycleEpoch !== undefined &&
          atTimestamp >= lifecycleEpoch
        )
          epochs.set(layer.id, lifecycleEpoch);
        else if (
          activation?.type === 'step' &&
          !animation &&
          stepArrivalTimestamp !== undefined &&
          atTimestamp >= stepArrivalTimestamp &&
          activation.stepKeyframeId === stepKeyframeId
        )
          epochs.set(layer.id, stepArrivalTimestamp);
        else if (activation?.type === 'customAction' && layer.loop) {
          const epoch = customActionEpochs.get(activation.customActionId);
          const durationMs =
            ((layer.loop.durationFrames * (layer.loop.repeatCount ?? 1)) /
              this.descriptor.frameRate) *
            1000;
          if (epoch !== undefined && atTimestamp >= epoch && atTimestamp - epoch < durationMs) {
            epochs.set(layer.id, epoch);
          }
        }
      }
      return epochs;
    };

    const advanceTo = (atTimestamp: number): number => {
      if (!animation) return positionSeconds;
      const progress = Math.min(
        1,
        Math.max(0, (atTimestamp - animation.startTimestamp) / animation.durationMs),
      );
      directSample = animation.directTransition
        ? { transition: animation.directTransition, progress }
        : undefined;
      positionSeconds =
        animation.startSeconds + (animation.targetSeconds - animation.startSeconds) * progress;
      if (progress >= 1) {
        animation = undefined;
        directSample = undefined;
      }
      return positionSeconds;
    };

    const advanceDataTo = (atTimestamp: number): void => {
      if (!dataAnimation) {
        updateOpacity = 1;
        updateKeys = new Set();
        return;
      }
      const progress = Math.min(
        1,
        Math.max(0, (atTimestamp - dataAnimation.startTimestamp) / dataAnimation.durationMs),
      );
      displayData = progress < 0.5 ? dataAnimation.oldData : dataAnimation.newData;
      updateOpacity = progress < 0.5 ? 1 - progress * 2 : (progress - 0.5) * 2;
      updateKeys = dataAnimation.keys;
      if (progress >= 1) {
        displayData = dataAnimation.newData;
        updateOpacity = 1;
        updateKeys = new Set();
        dataAnimation = undefined;
      }
    };

    for (const scheduled of due) {
      flushRules(scheduled.timestamp);
      advanceTo(scheduled.timestamp);
      advanceDataTo(scheduled.timestamp);
      const { type, params } = scheduled.action;
      if (type === 'updateAction') {
        const updateParams = params as UpdateActionParams;
        if (updateParams.data && typeof updateParams.data === 'object') {
          const updatePatch = updateParams.data as Record<string, unknown>;
          const changedKeys = new Set(
            Object.keys(updatePatch).filter((key) => !Object.is(data[key], updatePatch[key])),
          );
          if (dataAnimation) {
            displayData = { ...data };
            updateOpacity = 1;
            updateKeys = new Set();
            dataAnimation = undefined;
          }
          const previousRuleData = data;
          data = { ...data, ...(updateParams.data as Record<string, unknown>) };
          for (const layer of this.activeDescriptor.layers) {
            if (layer.element.type !== 'chart') continue;
            const chartAnimation = normalizeChartAnimation(layer.element.animation);
            if (
              chartAnimation.type === 'none' ||
              !chartAnimation.replayOnUpdate ||
              !(layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
                (binding) => binding.targetProperty === 'data' && changedKeys.has(binding.dataKey),
              )
            )
              continue;
            const transition = layer.updateTransition;
            const transitionFrames =
              updateParams.skipAnimation || transition?.style === 'none'
                ? 0
                : transition?.durationFrames || this.descriptor.updateTransitionFrames || 0;
            chartAnimationEpochs.set(layer.id, {
              timestamp:
                scheduled.timestamp + (transitionFrames / this.activeDescriptor.frameRate) * 500,
              skip: Boolean(updateParams.skipAnimation),
            });
          }
          if (!updateParams.skipAnimation) {
            for (const layer of this.activeDescriptor.layers) {
              if (layer.element.type !== 'text') continue;
              const textAnimation = normalizeTextAnimation(layer.element.textAnimation);
              if (
                textAnimation.type !== 'none' &&
                textAnimation.replayOnUpdate &&
                (layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
                  (binding) =>
                    binding.targetProperty === 'content' && changedKeys.has(binding.dataKey),
                )
              ) {
                const transition = layer.updateTransition ?? {
                  style: 'inherit' as const,
                  durationFrames: 0,
                  distance: 24,
                };
                const transitionFrames =
                  transition.style === 'none'
                    ? 0
                    : transition.durationFrames || this.descriptor.updateTransitionFrames || 0;
                textAnimationEpochs.set(
                  layer.id,
                  scheduled.timestamp + (transitionFrames / this.activeDescriptor.frameRate) * 500,
                );
              }
            }
          }
          const durationMs =
            ((this.descriptor.updateTransitionFrames ?? 0) / this.descriptor.frameRate) * 1000;
          const keys = this.#changedBindingKeys(updateParams.data);
          if (updateParams.skipAnimation || durationMs <= 0 || keys.size === 0) {
            displayData = { ...data };
            queueRuleWork(scheduled.timestamp, {
              kind: 'data',
              previous: previousRuleData,
              current: data,
            });
          } else {
            dataAnimation = {
              startTimestamp: scheduled.timestamp,
              durationMs,
              oldData: { ...displayData },
              newData: { ...data },
              keys,
            };
            queueRuleWork(scheduled.timestamp + durationMs / 2, {
              kind: 'data',
              previous: previousRuleData,
              current: data,
            });
          }
        }
      } else if (type === 'playAction') {
        const playParams = params as PlayActionParams;
        const previousStep = step;
        const outgoingEpochs = loopEpochsAt(scheduled.timestamp);
        const target = this.#resolvePlayTarget(step, playParams);
        if (previousStep === undefined && target.currentStep !== undefined) {
          for (const layer of this.activeDescriptor.layers) {
            if (
              layer.element.type === 'chart' &&
              normalizeChartAnimation(layer.element.animation).type !== 'none'
            )
              chartAnimationEpochs.set(layer.id, {
                timestamp: scheduled.timestamp,
                skip: Boolean(playParams.skipAnimation),
              });
          }
        }
        step = target.currentStep;
        targetKeyframeId = target.keyframeId;
        const targetSeconds = keyframeSeconds(targetKeyframeId);
        const exitsToEnd =
          previousStep !== undefined && targetKeyframeId === this.descriptor.endKeyframeId;
        const durationMs = exitsToEnd
          ? ((this.descriptor.transitions.find(
              (transition) => transition.toKeyframeId === this.descriptor.endKeyframeId,
            )?.durationFrames ?? 0) /
              this.descriptor.frameRate) *
            1000
          : Math.abs(targetSeconds - positionSeconds) * 1000;
        if (!exitsToEnd) {
          this.#beginLoopExit(
            targetSeconds * this.descriptor.frameRate,
            scheduled.timestamp,
            (layer) => target.currentStep === undefined || layer.loop?.activation.type === 'step',
            positionSeconds * this.descriptor.frameRate,
            outgoingEpochs,
            displayData,
          );
        } else this.#loopExitCorrection = null;
        animation =
          playParams.skipAnimation || durationMs === 0
            ? undefined
            : {
                startTimestamp: scheduled.timestamp,
                startSeconds: positionSeconds,
                targetSeconds,
                durationMs,
                ...(exitsToEnd
                  ? {
                      directTransition: this.#createDirectLifecycleTransition(
                        positionSeconds * this.descriptor.frameRate,
                        targetSeconds * this.descriptor.frameRate,
                        scheduled.timestamp,
                        outgoingEpochs,
                        displayData,
                      ),
                    }
                  : {}),
              };
        directSample = undefined;
        if (!animation) positionSeconds = targetSeconds;
        if (target.currentStep === undefined) {
          lifecycleEpoch = undefined;
          stepArrivalTimestamp = undefined;
          queueRuleWork(scheduled.timestamp, { kind: 'event', trigger: 'stop' });
        } else {
          const arrival = scheduled.timestamp + (animation?.durationMs ?? 0);
          stepArrivalTimestamp = arrival;
          lifecycleEpoch ??= arrival;
          if (previousStep === undefined)
            queueRuleWork(arrival, { kind: 'event', trigger: 'play' });
          const stepKeyframeId = this.descriptor.stepKeyframeIds[target.currentStep];
          queueRuleWork(arrival, {
            kind: 'event',
            trigger: 'step',
            ...(stepKeyframeId === undefined ? {} : { eventId: stepKeyframeId }),
          });
        }
      } else if (type === 'stopAction') {
        const stopParams = params as StopActionParams;
        const outgoingEpochs = loopEpochsAt(scheduled.timestamp);
        this.#loopExitCorrection = null;
        step = undefined;
        targetKeyframeId = this.descriptor.endKeyframeId;
        const targetSeconds = keyframeSeconds(targetKeyframeId);
        const durationMs =
          ((this.descriptor.transitions.find(
            (transition) => transition.toKeyframeId === this.descriptor.endKeyframeId,
          )?.durationFrames ?? 0) /
            this.descriptor.frameRate) *
          1000;
        animation =
          stopParams.skipAnimation || durationMs === 0
            ? undefined
            : {
                startTimestamp: scheduled.timestamp,
                startSeconds: positionSeconds,
                targetSeconds,
                durationMs,
                directTransition: this.#createDirectLifecycleTransition(
                  positionSeconds * this.descriptor.frameRate,
                  targetSeconds * this.descriptor.frameRate,
                  scheduled.timestamp,
                  outgoingEpochs,
                  displayData,
                ),
              };
        directSample = undefined;
        if (!animation) positionSeconds = targetSeconds;
        lifecycleEpoch = undefined;
        stepArrivalTimestamp = undefined;
        queueRuleWork(scheduled.timestamp, { kind: 'event', trigger: 'stop' });
      } else if (type === 'customAction') {
        const customParams = params as CustomActionParams;
        if (customParams.payload && typeof customParams.payload === 'object') {
          dataAnimation = undefined;
          updateOpacity = 1;
          updateKeys = new Set();
          const previousRuleData = data;
          data = { ...data, ...(customParams.payload as Record<string, unknown>) };
          const changedKeys = new Set(
            Object.entries(customParams.payload as Record<string, unknown>)
              .filter(([key, value]) => !Object.is(previousRuleData[key], value))
              .map(([key]) => key),
          );
          for (const layer of this.activeDescriptor.layers) {
            if (layer.element.type !== 'chart') continue;
            const chartAnimation = normalizeChartAnimation(layer.element.animation);
            if (
              chartAnimation.type !== 'none' &&
              chartAnimation.replayOnUpdate &&
              (layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
                (binding) => binding.targetProperty === 'data' && changedKeys.has(binding.dataKey),
              )
            )
              chartAnimationEpochs.set(layer.id, {
                timestamp: scheduled.timestamp,
                skip: Boolean(customParams.skipAnimation),
              });
          }
          displayData = { ...data };
          queueRuleWork(scheduled.timestamp, {
            kind: 'data',
            previous: previousRuleData,
            current: data,
          });
        }
        queueRuleWork(scheduled.timestamp, {
          kind: 'event',
          trigger: 'custom-action',
          eventId: customParams.id,
        });
        if (!customParams.skipAnimation) {
          customActionEpochs.set(customParams.id, scheduled.timestamp);
          for (const layer of this.activeDescriptor.layers) {
            if (layer.element.type !== 'text') continue;
            const textAnimation = normalizeTextAnimation(layer.element.textAnimation);
            if (textAnimation.type !== 'none' && textAnimation.customActionId === customParams.id) {
              textAnimationEpochs.set(layer.id, scheduled.timestamp);
            }
          }
        }
      }
    }

    advanceDataTo(timestamp);
    flushRules(timestamp);
    rules?.publish(timestamp);
    this.#lastData = displayData;
    this.#refreshBoundLayers();
    this.#setBoundContentOpacity(updateKeys, updateOpacity);
    this.#currentStep = step;
    advanceTo(timestamp);
    this.#timeline?.seek(positionSeconds, true);
    const epochs = loopEpochsAt(timestamp);
    if (directSample) {
      this.#renderDirectLifecycleTransition(directSample.transition, directSample.progress);
    } else {
      this.#renderLoopSnapshot(timestamp, epochs);
    }
    for (const layer of this.activeDescriptor.layers) {
      if (layer.element.type !== 'text') continue;
      const host = this.#layerEls.get(layer.id);
      const element = this.#resolveLayerElement(layer, displayData);
      if (!host || element.type !== 'text') continue;
      const epoch = textAnimationEpochs.get(layer.id);
      const frame =
        epoch === undefined
          ? positionSeconds * this.activeDescriptor.frameRate
          : Math.max(0, ((timestamp - epoch) / 1000) * this.activeDescriptor.frameRate);
      host.dataset.ografTextAnimationFrame = String(frame);
      renderTextAnimationAtFrame(host, element, frame);
    }
    for (const layer of this.activeDescriptor.layers) {
      if (layer.element.type !== 'chart') continue;
      const host = this.#layerEls.get(layer.id);
      const element = this.#resolveLayerElement(layer, displayData);
      if (!host || element.type !== 'chart') continue;
      const epoch = chartAnimationEpochs.get(layer.id);
      const frame =
        epoch === undefined
          ? positionSeconds * this.activeDescriptor.frameRate
          : epoch.skip
            ? chartAnimationEndFrame(element)
            : Math.max(0, ((timestamp - epoch.timestamp) / 1000) * this.activeDescriptor.frameRate);
      host.dataset.ografChartAnimationFrame = String(frame);
      renderChartAnimationAtFrame(host, element, frame);
    }
  }

  async goToTime(params: GoToTimeParams): Promise<ReturnPayload | undefined> {
    return this.#serializeOperation(() => this.#goToTimeUnlocked(params));
  }

  async #goToTimeUnlocked(params: GoToTimeParams): Promise<ReturnPayload | undefined> {
    try {
      this.#clearContentAnimationFrames();
      this.#stopLoopRendering();
      this.#clearChartAnimationFrames();
      this.#timeline?.pause();
      this.#activeTween?.kill();
      this.#activeTween = null;
      this.#directLifecycleTransition = null;
      this.#loopExitCorrection = null;
      this.#timeline?.seek(params.timestamp / 1000, true);
      this.#mediaCueRuntime?.reset();
      this.#mediaCueRuntime?.renderAtTime(params.timestamp);
      if (this.#schedule.length > 0) this.#applySchedule(params.timestamp);
      else this.#renderLoopSnapshot(params.timestamp, new Map());
      this.#renderAnimatedContentAt(params.timestamp);
      await this.#awaitContentReady();
      this.#renderAnimatedContentAt(params.timestamp);
      if (this.#schedule.length > 0) this.#applySchedule(params.timestamp);
      else this.#renderLoopSnapshot(params.timestamp, new Map());
      await this.#awaitContentReady();
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  async setActionsSchedule(params: SetActionsScheduleParams): Promise<ReturnPayload | undefined> {
    return this.#serializeOperation(() => this.#setActionsScheduleUnlocked(params));
  }

  async #setActionsScheduleUnlocked(
    params: SetActionsScheduleParams,
  ): Promise<ReturnPayload | undefined> {
    try {
      this.#schedule = [...params.schedule].sort((a, b) => a.timestamp - b.timestamp);
      this.#clearChartAnimationFrames();
      this.#scheduleBaseData = { ...this.#lastData };
      if (this.#schedule.length === 0) {
        for (const host of this.#layerEls.values()) delete host.dataset.ografTextAnimationFrame;
      }
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }
}
