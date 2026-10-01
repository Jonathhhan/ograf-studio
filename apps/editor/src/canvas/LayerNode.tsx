import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  applyElementDataValue,
  getLayerEffectsAtFrame,
  effectEnabled,
  getEffectStack,
  hasElementMediaPaint,
  hasElementShaderPaint,
  shaderParameterTarget,
  type Element,
  type Asset,
  type FieldDefinition,
  type Layer,
  type LayerTransform,
  type TilingPattern,
} from '@ograf-editor/scene-model';
import {
  applyLayerEffectsFilter,
  disposeLayerEffects,
  applyAnimatedPaint,
  disposeElementContent,
  lottieBackingSizeForLayer,
  shaderBackingSizeForLayer,
  shaderStrokePaddingForLayer,
  updateShaderPaintUniforms,
  updateShaderParameters,
  renderAnimatedElementAtTime,
  renderElementContent,
  setLottieDeterministicRendering,
  waitForElementContentReady,
} from '@ograf-editor/ograf-runtime';
import {
  editorVisualRuleEffects,
  resolveEffectiveElement,
  resolveEffectiveEffects,
  resolveEffectiveVisibility,
} from '../state/dataBinding';
import { useActiveComposition } from '../state/projectStore';
import { useTestDataStore } from '../state/testDataStore';
import { useTimelineStore } from '../state/timelineStore';
import type { ShaderPreviewClock } from './shaderPreviewClock';
import { useShaderParameterPreviewStore } from '../state/shaderParameterPreviewStore';
import {
  inlineTextEditTarget,
  inlineTextValue,
  placeInlineTextCaret,
  type InlineTextCaretPoint,
} from './inlineTextEditing';
import './LayerNode.css';

interface LayerNodeProps {
  layer: Layer;
  pose: LayerTransform;
  isSelected: boolean;
  onSelect: (additive: boolean) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  assets: Asset[];
  dataFields: FieldDefinition[];
  clipPath?: string;
  compositionFrameRate: number;
  shaderPreviewClock: ShaderPreviewClock;
  patterns: TilingPattern[];
  onCommitInlineText: (layer: Layer, value: string) => void;
  onInlineTextEditingChange: (
    layerId: string,
    editing: boolean,
    caretPoint?: InlineTextCaretPoint,
  ) => void;
  allowInlineTextEditing: boolean;
  editingInlineText: boolean;
  inlineTextCaretPoint?: InlineTextCaretPoint;
  onPreviewInlineText: (layer: Layer, value: string) => void;
}

/**
 * Editor-only affordance: what to show when an element has no renderable content yet. The runtime
 * correctly renders nothing in these cases (an unset image must not draw a grey box on air), so
 * this is deliberately layered *on top of* the shared renderer rather than being a divergent
 * branch inside it.
 */
function emptyContentLabel(element: Element): string | null {
  if (element.type === 'image' && !element.src) return 'Image';
  if (element.type === 'image-sequence' && element.frames.length === 0) return 'Sequence';
  if (element.type === 'lottie' && !element.animationData) return 'Lottie';
  if (element.type === 'audio' && !element.src) return 'Audio';
  return null;
}

export function LayerNode({
  layer,
  pose: transform,
  isSelected,
  onSelect,
  registerRef,
  assets,
  dataFields,
  clipPath,
  compositionFrameRate,
  shaderPreviewClock,
  patterns,
  onCommitInlineText,
  onInlineTextEditingChange,
  allowInlineTextEditing,
  editingInlineText,
  inlineTextCaretPoint,
  onPreviewInlineText,
}: LayerNodeProps) {
  const testValues = useTestDataStore((s) => s.values);
  const ruleOverrides = useTestDataStore((s) => s.visualRuleStateOverrides);
  const compositionLayers = useActiveComposition().layers;
  // Rules on any layer may drive this one; one shared evaluation serves every canvas node.
  const ruleEffect = editorVisualRuleEffects(
    compositionLayers,
    dataFields,
    testValues,
    ruleOverrides,
  ).get(layer.id);
  const contentRef = useRef<HTMLDivElement>(null);
  const readinessGeneration = useRef(0);
  const [contentError, setContentError] = useState<string | null>(null);
  const inlineTarget = inlineTextEditTarget(layer, dataFields);
  const initialInlineText = useRef('');
  const finishingInlineText = useRef(false);

  const lastEffectiveElement = useRef<Element>(layer.element);
  const resolvedContent = useMemo(() => {
    try {
      const next = resolveEffectiveElement(
        layer,
        testValues,
        assets,
        dataFields,
        patterns,
        ruleEffect,
      );
      lastEffectiveElement.current = next;
      return { element: next, error: null };
    } catch (error) {
      return {
        element: lastEffectiveElement.current,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [assets, dataFields, layer, testValues, patterns, ruleEffect]);
  const element = resolvedContent.element;
  const effectiveVisible = resolveEffectiveVisibility(layer, testValues, dataFields, ruleEffect);
  const hasShaderPaint = hasElementShaderPaint(element);
  const hasMediaPaint = hasElementMediaPaint(element);
  const lottieBackingSize = useMemo(() => lottieBackingSizeForLayer(layer), [layer]);
  const shaderBackingSize = useMemo(() => shaderBackingSizeForLayer(layer), [layer]);
  const shaderStrokePadding = useMemo(() => shaderStrokePaddingForLayer(layer), [layer]);
  const watchContentReadiness = useCallback((host: HTMLElement) => {
    const generation = ++readinessGeneration.current;
    void waitForElementContentReady(host).then(
      () => {
        if (readinessGeneration.current === generation) setContentError(null);
      },
      (error: unknown) => {
        if (readinessGeneration.current === generation) {
          setContentError(error instanceof Error ? error.message : String(error));
        }
      },
    );
  }, []);

  useLayoutEffect(() => {
    if (!editingInlineText) return;
    const text = contentRef.current?.firstElementChild as HTMLElement | null;
    if (!text) return;
    initialInlineText.current =
      element.type === 'text'
        ? element.runs.length
          ? element.runs.map((run) => run.text).join('')
          : element.content
        : text.innerText;
    text.textContent = initialInlineText.current;
    text.contentEditable = 'plaintext-only';
    text.spellcheck = false;
    text.dataset.inlineTextEditor = 'true';
    const finish = (commit: boolean) => {
      if (finishingInlineText.current) return;
      finishingInlineText.current = true;
      if (commit) onCommitInlineText(layer, inlineTextValue(text));
      else text.innerText = initialInlineText.current;
      onInlineTextEditingChange(layer.id, false);
      text.blur();
      finishingInlineText.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        finish(true);
      }
    };
    const onBlur = () => finish(true);
    const onInput = () => onPreviewInlineText(layer, inlineTextValue(text));
    const stop = (event: Event) => event.stopPropagation();
    text.addEventListener('keydown', onKeyDown);
    text.addEventListener('blur', onBlur);
    text.addEventListener('input', onInput);
    text.addEventListener('mousedown', stop);
    text.addEventListener('dblclick', stop);
    text.focus();
    placeInlineTextCaret(text, inlineTextCaretPoint);
    return () => {
      text.removeEventListener('keydown', onKeyDown);
      text.removeEventListener('blur', onBlur);
      text.removeEventListener('input', onInput);
      text.removeEventListener('mousedown', stop);
      text.removeEventListener('dblclick', stop);
      text.removeAttribute('contenteditable');
      delete text.dataset.inlineTextEditor;
    };
  }, [
    editingInlineText,
    element,
    layer,
    onCommitInlineText,
    onInlineTextEditingChange,
    onPreviewInlineText,
    inlineTextCaretPoint,
  ]);

  // THE canvas render path — deliberately the exact same `renderElementContent` the OGraf runtime
  // uses for both the preview harness and every exported package, so the design canvas cannot
  // drift from broadcast output. (It previously had its own parallel JSX switch, which had already
  // silently diverged: images rendered `object-fit: fill` here but `contain` at runtime.)
  // Hooks must run unconditionally, so this sits above the `isVisible` early return; the ref is
  // null when hidden and the effect simply no-ops.
  useLayoutEffect(() => {
    if (editingInlineText) return;
    const host = contentRef.current;
    if (host) {
      renderElementContent(host, element, 0, {
        frameRate: compositionFrameRate,
        ...(element.type === 'lottie' ? { lottieBackingSize } : {}),
        ...(hasShaderPaint || hasMediaPaint ? { shaderBackingSize, shaderStrokePadding } : {}),
      });
      applyAnimatedPaint(host, layer.animationTracks, useTimelineStore.getState().currentFrame);
      if (element.type === 'lottie' || hasShaderPaint || hasMediaPaint) watchContentReadiness(host);
      else setContentError(null);
    }
    return () => {
      readinessGeneration.current += 1;
    };
  }, [
    compositionFrameRate,
    element,
    hasShaderPaint,
    hasMediaPaint,
    layer.animationTracks,
    effectiveVisible,
    lottieBackingSize,
    shaderBackingSize,
    shaderStrokePadding,
    watchContentReadiness,
    editingInlineText,
  ]);

  useLayoutEffect(() => {
    const host = contentRef.current?.parentElement;
    return () => {
      if (host) disposeLayerEffects(host);
    };
  }, [effectiveVisible]);

  useLayoutEffect(() => {
    const host = contentRef.current;
    if (!host || !hasShaderPaint) return;
    let previewing = false;
    const applyPreview = (
      preview: ReturnType<typeof useShaderParameterPreviewStore.getState>['preview'],
    ) => {
      if (preview?.layerId === layer.id) {
        const previewElement = applyElementDataValue(
          element,
          shaderParameterTarget(preview.name, preview.slot),
          preview.value,
        );
        const updated =
          previewElement.type === 'shader'
            ? updateShaderParameters(host, previewElement, shaderBackingSize)
            : updateShaderPaintUniforms(host, previewElement);
        if (!updated) throw new Error('The shader preview renderer is not mounted.');
        previewing = true;
      } else if (previewing) {
        renderElementContent(host, element, 0, {
          frameRate: compositionFrameRate,
          shaderBackingSize,
          shaderStrokePadding,
        });
        applyAnimatedPaint(host, layer.animationTracks, useTimelineStore.getState().currentFrame);
        previewing = false;
      }
    };
    applyPreview(useShaderParameterPreviewStore.getState().preview);
    return useShaderParameterPreviewStore.subscribe((state) => applyPreview(state.preview));
  }, [
    compositionFrameRate,
    element,
    hasShaderPaint,
    layer.animationTracks,
    layer.id,
    shaderBackingSize,
    shaderStrokePadding,
  ]);

  // Value-only shader edits reuse the mounted GPU program. Release it only when the host leaves
  // the canvas; renderElementContent handles source/type/backing changes itself.
  useLayoutEffect(() => {
    const host = contentRef.current;
    return () => {
      if (host) disposeElementContent(host);
    };
  }, [effectiveVisible]);

  useLayoutEffect(() => {
    if (hasShaderPaint || hasMediaPaint) {
      let animationFrame: number | null = null;
      const render = () => {
        animationFrame = null;
        const host = contentRef.current;
        if (!host) return;
        try {
          if (element.type === 'lottie')
            setLottieDeterministicRendering(host, !shaderPreviewClock.running);
          // The master timeline and Stage's local-loop sampler own animated uniforms. This
          // independent clock advances iTime only, so a held loop's values are never replaced.
          renderAnimatedElementAtTime(host, element, shaderPreviewClock.sample(performance.now()));
          if (!shaderPreviewClock.running && !hasMediaPaint) watchContentReadiness(host);
        } catch (error) {
          setContentError(error instanceof Error ? error.message : String(error));
          // A restored context can resume itself. Compilation/draw failures await a source edit.
          if (!(error instanceof Error) || error.name !== 'ShaderContextLostError') return;
        }
        if (shaderPreviewClock.running || hasMediaPaint)
          animationFrame = requestAnimationFrame(render);
      };
      const sync = () => {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        render();
      };
      const unsubscribe = shaderPreviewClock.subscribe(sync);
      sync();
      return () => {
        unsubscribe();
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      };
    }
    const renderAtFrame = (frame: number, playing: boolean) => {
      const host = contentRef.current;
      if (host) {
        try {
          setLottieDeterministicRendering(host, !playing);
          renderAnimatedElementAtTime(host, element, (frame / compositionFrameRate) * 1000);
          if (element.type === 'lottie') watchContentReadiness(host);
        } catch (error) {
          setContentError(error instanceof Error ? error.message : String(error));
        }
      }
    };
    const initialState = useTimelineStore.getState();
    renderAtFrame(initialState.currentFrame, initialState.isPlaying);
    let previousFrame = initialState.currentFrame;
    let previousPlaying = initialState.isPlaying;
    return useTimelineStore.subscribe((state) => {
      if (state.currentFrame === previousFrame && state.isPlaying === previousPlaying) return;
      previousFrame = state.currentFrame;
      previousPlaying = state.isPlaying;
      renderAtFrame(state.currentFrame, state.isPlaying);
    });
  }, [
    compositionFrameRate,
    element,
    hasShaderPaint,
    hasMediaPaint,
    effectiveVisible,
    lottieBackingSize,
    shaderBackingSize,
    shaderPreviewClock,
    watchContentReadiness,
  ]);

  useLayoutEffect(() => {
    const host = contentRef.current?.parentElement;
    if (!host) return;
    const effects = resolveEffectiveEffects(
      layer,
      getLayerEffectsAtFrame(layer, useTimelineStore.getState().currentFrame),
      testValues,
      dataFields,
      ruleEffect,
    );
    const shaderEffect = getEffectStack(effects).some(
      (effect) => effect.type === 'shader' && effectEnabled(effect, effects),
    );
    const apply = () =>
      applyLayerEffectsFilter(host, effects, shaderPreviewClock.sample(performance.now()));
    apply();
    if (!shaderEffect) return;
    let animationFrame: number | null = null;
    const render = () => {
      animationFrame = null;
      apply();
      if (shaderPreviewClock.running || hasMediaPaint)
        animationFrame = requestAnimationFrame(render);
    };
    const sync = () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      render();
    };
    const unsubscribe = shaderPreviewClock.subscribe(sync);
    return () => {
      unsubscribe();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    };
  }, [
    layer,
    testValues,
    dataFields,
    ruleEffect,
    transform.width,
    transform.height,
    shaderPreviewClock,
    hasMediaPaint,
  ]);

  if (!effectiveVisible) return null;

  const style: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: transform.width,
    height: transform.height,
    opacity: transform.opacity,
    visibility: layer.isMaskOnly ? 'hidden' : undefined,
    mixBlendMode: layer.blendMode === 'normal' ? undefined : layer.blendMode,
    transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg)`,
    transformOrigin: `${transform.transformOriginX * 100}% ${transform.transformOriginY * 100}%`,
    clipPath,
  };

  const placeholder = emptyContentLabel(element);
  const visibleError = resolvedContent.error ?? (hasShaderPaint ? null : contentError);

  return (
    <div
      ref={registerRef}
      data-layer-id={layer.id}
      className={[
        'layer-node',
        isSelected && 'selected',
        editingInlineText && 'inline-text-editing',
        layer.isGuide && 'guide',
        layer.isLocked && 'locked',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (editingInlineText) return;
        onSelect(e.ctrlKey || e.metaKey);
      }}
      onDoubleClick={(event) => {
        if (!allowInlineTextEditing || !inlineTarget || editingInlineText) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect(false);
        onInlineTextEditingChange(layer.id, true, { x: event.clientX, y: event.clientY });
      }}
      style={style}
    >
      <div className="layer-content-host" ref={contentRef} />
      {editingInlineText && inlineTarget?.type === 'test-data' ? (
        <div className="layer-inline-text-badge">Editing field: {inlineTarget.label}</div>
      ) : null}
      {visibleError ? (
        <div className="layer-content-placeholder" title={visibleError} role="alert">
          Render error: {visibleError}
        </div>
      ) : (
        placeholder && <div className="layer-content-placeholder">{placeholder}</div>
      )}
    </div>
  );
}
