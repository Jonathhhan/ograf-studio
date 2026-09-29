import {
  scriptLayerReference,
  textExpressionReference,
  type ScriptLayerVisuals,
  type ScriptLayerTransform,
} from './scriptLayerProperties';
import {
  evaluateExpression,
  sampledProperty,
  sourceRectMethod,
  evaluateCompositionScript,
  EXPRESSION_PROPERTIES,
  type ExpressionScope,
  type ExpressionLayerSampling,
  type ExpressionRect,
  type ExpressionValue,
} from './expressions';
import { isScriptVectorName, readScriptVector } from './scriptVectors';
import { expressionFieldForProperty } from './expressionFields';
import { scriptModules } from './scriptModules';
import type { CompositionScripting, Layer, LayerTransform, LayerExpressionProperty } from './types';

export { EXPRESSION_PROPERTIES } from './expressions';
type ExpressionProperty = (typeof EXPRESSION_PROPERTIES)[number];

export interface ExpressionDiagnostic {
  layerId: string;
  property: LayerExpressionProperty | 'script';
  source: string;
  message: string;
}

export interface ExpressionLayerState {
  id: string;
  name?: string;
  transform: LayerTransform;
  scriptVisuals?: ScriptLayerVisuals;
  sampleTransform?: (seconds: number) => LayerTransform;
  /** Authored visual state at an arbitrary time, before text expressions are applied. */
  sampleScriptVisualsAtTime?: (seconds: number) => ScriptLayerVisuals;
  sourceRectAtTime?: (seconds: number, includeExtents: boolean) => ExpressionRect;
  sourceRectAtTimeWithVisuals?: (
    seconds: number,
    includeExtents: boolean,
    visuals: ScriptLayerVisuals,
    transform?: LayerTransform,
  ) => ExpressionRect;
  /** Authored identity of a layer expanded into a collection item. */
  prototypeLayerId?: string;
  expressions?: Layer['expressions'];
  expressionsEnabled?: Layer['expressionsEnabled'];
  scope?: ExpressionScope;
  /** Runtime collection item identity; references prefer siblings in this scope. */
  referenceScope?: string;
}

/** Shared by SVG previews and the browser runtime; inputs are sampled, pre-expression poses. */
export function resolveExpressionTransforms(
  layers: readonly ExpressionLayerState[],
  scope: ExpressionScope,
  diagnostics?: ExpressionDiagnostic[],
  apiVersion = 1,
  scripting?: CompositionScripting,
  sampleScopeAtTime?: (seconds: number) => ExpressionScope,
): Map<string, ScriptLayerTransform> {
  let modules: Record<string, object> = Object.create(null);
  try {
    modules = scriptModules(scripting, apiVersion);
  } catch (error) {
    diagnostics?.push({
      layerId: '',
      property: 'script',
      source: '',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const byName = new Map<string, ExpressionLayerState | null>();
  const byScope = new Map<string, Map<string, ExpressionLayerState | null>>();
  for (const layer of layers) {
    let names = byName;
    if (layer.referenceScope !== undefined) {
      names = byScope.get(layer.referenceScope) ?? new Map();
      byScope.set(layer.referenceScope, names);
    }
    if (layer.name) names.set(layer.name, names.has(layer.name) ? null : layer);
  }
  const referenceIds = new Map<string | undefined, Map<string, ExpressionLayerState>>();
  for (const layer of layers) {
    const ids = referenceIds.get(layer.referenceScope) ?? new Map();
    ids.set(layer.prototypeLayerId ?? layer.id, layer);
    referenceIds.set(layer.referenceScope, ids);
  }
  const contexts = new Map<string, ExpressionScope>();
  const values = new Map<string, ExpressionValue>();
  const visiting = new Set<string>();
  const failures = new Map<string, unknown>();
  const findLayer = (
    owner: ExpressionLayerState,
    reference: string,
    byIdentity = false,
  ): ExpressionLayerState => {
    if (byIdentity) {
      const target =
        referenceIds.get(owner.referenceScope)?.get(reference) ??
        referenceIds.get(undefined)?.get(reference);
      if (!target) throw new Error('Unknown layer ID: ' + reference);
      return target;
    }
    const local =
      owner.referenceScope === undefined ? undefined : byScope.get(owner.referenceScope);
    const target = local?.has(reference) ? local.get(reference) : byName.get(reference);
    if (target === null) throw new Error('Ambiguous layer name: ' + reference);
    if (!target) throw new Error('Unknown layer: ' + reference);
    return target;
  };
  const metadata = (layer: ExpressionLayerState) => ({ id: layer.id, name: layer.name ?? '' });
  // Share authored samples across expressions and the composition script, but never across
  // evaluations: data, fonts and authored values may have changed even at the same time.
  const samplers = new Map<ExpressionLayerState, ExpressionLayerSampling>();
  const sampling = (layer: ExpressionLayerState): ExpressionLayerSampling => {
    const existing = samplers.get(layer);
    if (existing) return existing;
    const transforms = new Map<number, LayerTransform>();
    const bounds = new Map<number, Map<boolean, ExpressionRect>>();
    const styledSamples = new Map<number, ScriptLayerVisuals>();
    const sampler: ExpressionLayerSampling = {
      transformAtTime: (seconds) => {
        if (!layer.sampleTransform) throw new Error('Time sampling is unavailable for this layer.');
        let transform = transforms.get(seconds);
        if (!transform) {
          transform = { ...layer.sampleTransform(seconds) };
          transforms.set(seconds, transform);
        }
        return transform;
      },
      valueAtTime: (property, seconds) => {
        return sampler.transformAtTime!(seconds)[property as keyof LayerTransform];
      },
      sourceRectAtTime: (seconds, includeExtents) => {
        const visuals = styledVisuals.get(layer.id);
        if (visuals && layer.sourceRectAtTimeWithVisuals) {
          let sampled = styledSamples.get(seconds);
          if (!sampled) {
            const base = layer.sampleScriptVisualsAtTime?.(seconds);
            if (base) {
              sampled = styleTextVisuals(layer, base, seconds);
              styledSamples.set(seconds, sampled);
            }
          }
          return layer.sourceRectAtTimeWithVisuals(
            seconds,
            includeExtents,
            sampled ? styleTextVisuals(layer, sampled, seconds) : visuals,
            layer.sampleTransform ? sampler.transformAtTime?.(seconds) : undefined,
          );
        }
        if (!layer.sourceRectAtTime)
          throw new Error('Content bounds are unavailable for this layer.');
        let atTime = bounds.get(seconds);
        if (!atTime) bounds.set(seconds, (atTime = new Map()));
        let rect = atTime.get(includeExtents);
        if (!rect) {
          rect = Object.freeze({ ...layer.sourceRectAtTime(seconds, includeExtents) });
          atTime.set(includeExtents, rect);
        }
        return rect;
      },
    };
    samplers.set(layer, sampler);
    return sampler;
  };
  const contextFor = (layer: ExpressionLayerState): ExpressionScope => {
    let context = contexts.get(layer.id);
    if (!context) {
      context = Object.create(null) as ExpressionScope;
      for (const [name, value] of Object.entries({
        ...scope,
        ...layer.scope,
        ...layer.transform,
      }))
        Object.defineProperty(context, name, { value, configurable: true, enumerable: true });
      contexts.set(layer.id, context);
    }
    return context;
  };
  const resolve = (id: string, property: LayerExpressionProperty): ExpressionValue => {
    const key = id + ':' + property;
    if (values.has(key)) return values.get(key)!;
    if (failures.has(key)) throw failures.get(key);
    const layer = byId.get(id)!;
    const expression = layer.expressions?.[property];
    const authored = isScriptVectorName(property)
      ? readScriptVector(
          property,
          (component) => layer.transform[component as keyof LayerTransform],
        )
      : layer.transform[property as keyof LayerTransform];
    if (!expression?.trim() || layer.expressionsEnabled?.[property] === false) return authored;
    if (visiting.has(key)) {
      const path = [...visiting, key];
      const start = path.indexOf(key);
      const labels = path.slice(start).map((entry) => {
        const split = entry.lastIndexOf(':');
        const target = byId.get(entry.slice(0, split));
        return (target?.name || target?.id || entry.slice(0, split)) + '.' + entry.slice(split + 1);
      });
      throw new Error('Circular expression dependency: ' + labels.join(' -> '));
    }
    if (visiting.size >= 128) throw new Error('Expression dependency chain is too deep.');
    visiting.add(key);
    try {
      const context = contextFor(layer);
      const options = {
        apiVersion,
        modules,
        expressionSources: layer.expressions!,
        currentLayer: metadata(layer),
        currentSampling: sampling(layer),
        resolveLayerSampling: (reference: string, byId: boolean) =>
          sampling(findLayer(layer, reference, byId)),
        currentProperty: { name: property, value: authored, layerId: layer.id },
        resolveLayerMetadata: (reference: string, byId: boolean) =>
          metadata(findLayer(layer, reference, byId)),
        resolveLayerById: (targetId: string, targetProperty: string) =>
          readReference(findLayer(layer, targetId, true), targetProperty),
      };
      const resolver = (name: string, component: string) =>
        readReference(findLayer(layer, name), component);
      const value = isScriptVectorName(property)
        ? evaluateExpression(expression, context, resolver, { ...options, resultType: 'vector' })
        : evaluateExpression(expression, context, resolver, options);
      if (
        property === 'transformOrigin' &&
        (value as readonly [number, number]).some((component) => component < 0 || component > 1)
      )
        throw new Error('transformOrigin components must be between 0 and 1.');
      values.set(key, value);
      return value;
    } catch (error) {
      failures.set(key, error);
      throw error;
    } finally {
      visiting.delete(key);
    }
  };
  const readReference = (layer: ExpressionLayerState, property: string): number => {
    const field = expressionFieldForProperty(property);
    if (field && isScriptVectorName(field) && layer.expressions?.[field]?.trim()) {
      const vector = resolve(layer.id, field) as readonly [number, number];
      const axis =
        property === 'x' || property === 'width' || property === 'transformOriginX' ? 0 : 1;
      return vector[axis];
    }
    return property === 'transformOriginX' || property === 'transformOriginY'
      ? layer.transform[property]
      : (resolve(layer.id, property as ExpressionProperty) as number);
  };
  function styleTextVisuals(
    layer: ExpressionLayerState,
    visuals: ScriptLayerVisuals,
    seconds: number,
  ): ScriptLayerVisuals {
    const source = layer.expressions?.text?.trim();
    if (!source || layer.expressionsEnabled?.text === false) return visuals;
    if (visuals.element.type !== 'text') throw new Error('Text expressions require a text layer.');
    const entry = textExpressionReference(visuals.element);
    const text = entry.text;
    const sampledScope = sampleScopeAtTime?.(seconds) ?? { ...scope, time: seconds };
    const context = Object.assign(
      Object.create(null),
      sampledScope,
      layer.scope,
      layer.sampleTransform?.(seconds) ?? layer.transform,
    ) as ExpressionScope;
    evaluateExpression(
      source,
      context,
      (name, property) => readReference(findLayer(layer, name), property),
      {
        apiVersion,
        modules,
        expressionSources: layer.expressions!,
        currentLayer: metadata(layer),
        currentProperty: { name: 'text', value: text, layerId: layer.id },
        text,
        resultType: 'text',
      },
    );
    return { ...visuals, element: entry.finish() };
  }
  const styledVisuals = new Map<string, ScriptLayerVisuals>();
  for (const layer of layers) {
    const source = layer.expressions?.text?.trim();
    if (!source || layer.expressionsEnabled?.text === false) continue;
    try {
      if (layer.scriptVisuals?.element.type !== 'text')
        throw new Error('Text expressions require a text layer.');
      styledVisuals.set(
        layer.id,
        styleTextVisuals(
          layer,
          layer.scriptVisuals,
          typeof scope.time === 'number' ? scope.time : 0,
        ),
      );
    } catch (error) {
      diagnostics?.push({
        layerId: layer.id,
        property: 'text',
        source,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const result = new Map(
    layers.map((layer) => {
      const transform = { ...layer.transform };
      const scriptVisuals = styledVisuals.get(layer.id);
      const reported = new Set<LayerExpressionProperty>();
      for (const property of [
        ...EXPRESSION_PROPERTIES,
        'transformOriginX',
        'transformOriginY',
      ] as const) {
        const field = expressionFieldForProperty(property)!;
        const target = layer.expressions?.[field]?.trim()
          ? field
          : (property as LayerExpressionProperty);
        try {
          transform[property] = readReference(layer, property);
        } catch (error) {
          // Failed properties and their dependents keep the sampled pose; unrelated ones still run.
          if (reported.has(target)) continue;
          reported.add(target);
          diagnostics?.push({
            layerId: layer.id,
            property: target,
            source: layer.expressions?.[target] ?? '',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return [layer.id, scriptVisuals ? { ...transform, scriptVisuals } : transform];
    }),
  );
  if (!scripting?.enabled) return result;
  if (typeof scripting.enabled !== 'boolean' || typeof scripting.source !== 'string') {
    diagnostics?.push({
      layerId: '',
      property: 'script',
      source: '',
      message: 'Invalid scripting settings: enabled must be a boolean and source must be a string.',
    });
    return result;
  }
  if (!scripting.source.trim()) return result;
  // A transaction prevents failed scripts (including late async writes) from changing a frame.
  const draft = new Map<string, ScriptLayerTransform>(
    [...result].map(([id, transform]) => [id, { ...transform }]),
  );
  let active = true;
  const names = new Map<string, string | null>();
  for (const layer of layers)
    if (layer.name) names.set(layer.name, names.has(layer.name) ? null : layer.id);
  const find = (name: string, byIdentity = false) => {
    const id = byIdentity ? name : names.get(name);
    if (id === null) throw new Error('Ambiguous layer name: ' + name);
    const transform = id === undefined ? undefined : draft.get(id);
    if (!transform) throw new Error('Unknown layer ' + (byIdentity ? 'ID: ' : 'name: ') + name);
    return transform;
  };
  const references = new Map<string, ReturnType<typeof scriptLayerReference>>();
  const reference = (name: string, byIdentity: boolean) => {
    const transform = find(name, byIdentity);
    const id = byIdentity ? name : names.get(name)!;
    let entry = references.get(id!);
    if (!entry) {
      const layer = byId.get(id!)!;
      const sample = sampling(layer);
      entry = scriptLayerReference(
        transform,
        styledVisuals.get(layer.id) ?? layer.scriptVisuals,
        metadata(layer),
        () => {
          if (!active)
            throw new Error(
              'Layer writes are only valid during the synchronous composition script.',
            );
        },
        {
          property: (property: string) =>
            sampledProperty(
              (name) => transform[name as ExpressionProperty],
              property,
              () => sample,
              apiVersion,
            ),
          sourceRectAtTime: sourceRectMethod(
            () => sample,
            typeof scope.time === 'number' ? scope.time : 0,
          ),
        },
        apiVersion,
        (seconds, includeExtents, visuals) => {
          const at = seconds ?? (typeof scope.time === 'number' ? scope.time : 0);
          const extents = includeExtents ?? false;
          if (typeof at !== 'number' || !Number.isFinite(at))
            throw new Error('Sample time must be finite seconds.');
          if (typeof extents !== 'boolean') throw new Error('includeExtents must be a boolean.');
          const currentVisuals = styledVisuals.get(layer.id) ?? layer.scriptVisuals;
          const pose =
            at === (typeof scope.time === 'number' ? scope.time : 0)
              ? transform
              : layer.sampleTransform
                ? sample.transformAtTime?.(at)
                : undefined;
          if (visuals && layer.sourceRectAtTimeWithVisuals)
            return layer.sourceRectAtTimeWithVisuals(at, extents, visuals, pose);
          if (currentVisuals && layer.sourceRectAtTimeWithVisuals)
            return layer.sourceRectAtTimeWithVisuals(at, extents, currentVisuals, pose);
          return sample.sourceRectAtTime(at, extents);
        },
      );
      references.set(id!, entry);
    }
    return entry.reference;
  };
  try {
    evaluateCompositionScript(
      scripting.source,
      scope,
      (name, property) => find(name)[property as ExpressionProperty],
      {
        apiVersion,
        modules,
        resolveLayerSampling: (reference, byIdentity) => {
          find(reference, byIdentity);
          const id = byIdentity ? reference : names.get(reference)!;
          return sampling(byId.get(id!)!);
        },
        resolveLayerMetadata: (reference, byIdentity) => {
          find(reference, byIdentity);
          const id = byIdentity ? reference : names.get(reference)!;
          return metadata(byId.get(id!)!);
        },
        resolveLayerById: (id, property) => find(id, true)[property as ExpressionProperty],
        resolveScriptLayer: reference,
      },
    );
    for (const [id, entry] of references) {
      const visuals = entry.finish();
      if (visuals) draft.get(id)!.scriptVisuals = visuals;
    }
    return draft;
  } catch (error) {
    diagnostics?.push({
      layerId: '',
      property: 'script',
      source: scripting.source,
      message: error instanceof Error ? error.message : String(error),
    });
    return result;
  } finally {
    active = false;
  }
}
