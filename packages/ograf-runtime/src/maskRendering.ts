import { resolveWorldTransforms, worldTransformMatrix } from '@ograf-editor/scene-model';
import { renderPatternAtElapsed } from './patternRendering';
import { applyScriptElement, resolveBoundElement, applyAnimatedPaint } from './renderElement';
import { applyScriptEffects } from './effectCompositing';
import {
  layerMaskSvg,
  patternRows,
  patternRowOffset,
  type Element,
  type MaskRenderLayer,
  type MaskRenderState,
  type ExpressionDiagnostic,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import { isRuntimeCollectionLayerActive } from './runtimeCollections';
import { applyCompiledClipPaths, applyCompiledLayerTransform } from './loopRendering';
import { resolveFrameExpressions } from './expressionRendering';

const mounted = new WeakMap<HTMLElement, { svg: SVGSVGElement; id: string; markup: string }>();
let nextId = 0;
const scripted = new WeakSet<HTMLElement>();
const sourceCache = new WeakMap<HTMLElement, { serialized: string; element: Element }>();

/** Shared by Studio, PNG capture and playout; called after every layer's pose and paint resolve. */
export function applyCompiledMasks(
  descriptor: CompiledGraphicDescriptor,
  elements: Map<string, HTMLElement>,
  states: Map<string, MaskRenderState>,
  data?: Record<string, unknown>,
  onDiagnostics?: (diagnostics: ExpressionDiagnostic[]) => void,
): void {
  // Text measurement runs after data/font updates. Use its live box before
  // resolving scripts, clipping and masks, without changing authored keyframes.
  states = new Map(states);
  for (const layer of descriptor.layers) {
    if (layer.element.type !== 'text' || layer.element.autoFit !== 'auto-size') continue;
    const state = states.get(layer.id);
    const element = elements.get(layer.id);
    const host = element?.firstElementChild?.classList.contains('layer-content-host')
      ? (element.firstElementChild as HTMLElement)
      : element;
    if (!state || !host) continue;
    const width = Number.parseFloat(host.style.width);
    const height = Number.parseFloat(host.style.height);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
      states.set(layer.id, { ...state, transform: { ...state.transform, width, height } });
  }
  const diagnostics: ExpressionDiagnostic[] | undefined = onDiagnostics ? [] : undefined;
  states = resolveFrameExpressions(descriptor, states, data, diagnostics);
  if (diagnostics) onDiagnostics?.(diagnostics);
  for (const layer of descriptor.layers) {
    const target = elements.get(layer.id);
    const state = states.get(layer.id);
    if ((layer.expressions || descriptor.scripting?.enabled) && target && state)
      applyCompiledLayerTransform(target, state.transform);
    if (target && state && (state.scriptVisuals || scripted.has(target))) {
      const host = target.firstElementChild?.classList.contains('layer-content-host')
        ? (target.firstElementChild as HTMLElement)
        : target;
      const visuals = state.scriptVisuals;
      const element = visuals?.element ?? resolveBoundElement(layer, data ?? {});
      applyScriptElement(host, element, Boolean(visuals));
      applyScriptEffects(target, visuals?.effects ?? state.effects, Boolean(visuals));
      applyAnimatedPaint(target, state.paintTracks, state.paintFrame);
      if (state.patternFrame !== undefined) renderPatternAtElapsed(target, state.patternFrame);
      const active = !data || isRuntimeCollectionLayerActive(layer, data);
      target.style.display = (visuals?.isVisible ?? layer.isVisible) && active ? '' : 'none';
      target.style.mixBlendMode = visuals?.blendMode ?? layer.blendMode ?? 'normal';
      if (element.type === 'text' && element.autoFit === 'auto-size') {
        const width = Number.parseFloat(host.style.width),
          height = Number.parseFloat(host.style.height);
        if (width > 0 && height > 0) state.transform = { ...state.transform, width, height };
      }
      if (visuals) {
        scripted.add(target);
        state.effects = visuals.effects;
        state.paintTracks = {};
      } else scripted.delete(target);
    }
  }
  const hasAffine =
    descriptor.layers.some((l) => l.transformParentId) ||
    [...states.values()].some(
      (s) =>
        (s.transform.scaleX ?? 1) !== 1 ||
        (s.transform.scaleY ?? 1) !== 1 ||
        (s.transform.skewX ?? 0) !== 0,
    );
  if (hasAffine) {
    const worlds = resolveWorldTransforms(
      descriptor.layers,
      new Map([...states].map(([id, s]) => [id, s.transform])),
    );
    for (const [id, pose] of worlds) {
      const state = states.get(id)!;
      state.transform = pose;
      const target = elements.get(id);
      if (target) {
        if (target.dataset) target.dataset.ografAffine = 'true';
        target.style.transformOrigin = '0 0';
        target.style.transform = 'matrix(' + worldTransformMatrix(pose).join(',') + ')';
      }
    }
  }
  applyCompiledClipPaths(descriptor, elements, states);
  const hasMasks = descriptor.layers.some((layer) => layer.mask);
  const sources = new Map<string, MaskRenderLayer>();
  for (const layer of descriptor.layers) {
    const element = elements.get(layer.id);
    if (element) element.style.visibility = layer.isMaskOnly ? 'hidden' : '';
    if (!hasMasks) continue;
    const host = element?.firstElementChild?.classList.contains('layer-content-host')
      ? (element.firstElementChild as HTMLElement)
      : element;
    const serialized = host?.dataset.ografRenderedElement;
    let resolvedElement = layer.element;
    if (host && serialized) {
      let cached = sourceCache.get(host);
      if (cached?.serialized !== serialized) {
        cached = { serialized, element: JSON.parse(serialized) as Element };
        sourceCache.set(host, cached);
      }
      resolvedElement = cached!.element;
    }
    sources.set(layer.id, {
      ...layer,
      element: resolvedElement,
      isVisible:
        (states.get(layer.id)?.scriptVisuals?.isVisible ?? layer.isVisible) &&
        (!data || isRuntimeCollectionLayerActive(layer, data)),
    });
  }
  for (const layer of descriptor.layers) {
    const target = elements.get(layer.id);
    if (!target) continue;
    let entry = mounted.get(target);
    if (!layer.mask) {
      if (entry) {
        target.style.maskImage = '';
        target.style.maskMode = '';
        target.style.maskRepeat = '';
        entry.svg.remove();
        mounted.delete(target);
        delete target.dataset.ografLayerMaskId;
      }
      continue;
    }
    if (!entry) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('data-ograf-runtime-auxiliary', 'true');
      Object.assign(svg.style, {
        position: 'absolute',
        width: '0',
        height: '0',
        pointerEvents: 'none',
      });
      entry = { svg, id: `ograf-layer-mask-${nextId++}`, markup: '' };
      mounted.set(target, entry);
    }
    if (entry.svg.parentNode !== target) target.appendChild(entry.svg);
    target.dataset.ografLayerMaskId = entry.id;
    const geometryStates = new Map(
      [...states].map(([id, state]) => [
        id,
        state.patternFrame === undefined ? state : { ...state, patternFrame: 0 },
      ]),
    );
    const markup = layerMaskSvg(layer.id, sources, geometryStates, entry.id);
    if (markup !== entry.markup) {
      entry.svg.innerHTML = `<defs>${markup}</defs>`;
      entry.markup = markup;
    }
    for (const svg of entry.svg.querySelectorAll<SVGSVGElement>('[data-ograf-pattern-source]')) {
      const sourceId = svg.dataset.ografPatternSource!,
        source = sources.get(sourceId),
        state = states.get(sourceId);
      if (source?.element.type === 'pattern' && source.element.definition && state) {
        for (const row of patternRows(source.element.definition))
          svg
            .querySelector(`[data-ograf-pattern-row="${row.row}"]`)
            ?.setAttribute(
              'x',
              String(patternRowOffset(source.element.definition, row, state.patternFrame ?? 0)),
            );
      }
    }
    target.style.maskImage = `url("#${entry.id}")`;
    target.style.maskMode = layer.mask.inverted ? 'luminance' : 'alpha';
    target.style.maskRepeat = 'no-repeat';
  }
}
