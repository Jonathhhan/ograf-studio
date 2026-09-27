import {
  evaluateExpression,
  evaluateCompositionScript,
  EXPRESSION_PROPERTIES,
  type ExpressionScope,
} from './expressions';
import { scriptModules } from './scriptModules';
import type { CompositionScripting, Layer, LayerTransform } from './types';

export { EXPRESSION_PROPERTIES } from './expressions';
type ExpressionProperty = (typeof EXPRESSION_PROPERTIES)[number];

export interface ExpressionDiagnostic {
  layerId: string;
  property: ExpressionProperty | 'script';
  source: string;
  message: string;
}

export interface ExpressionLayerState {
  id: string;
  name?: string;
  transform: LayerTransform;
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
): Map<string, LayerTransform> {
  let modules: Record<string, object> = Object.create(null);
  try {
    modules = scriptModules(scripting);
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
  const values = new Map<string, number>();
  const visiting = new Set<string>();
  const failures = new Map<string, unknown>();
  const resolveLayer = (owner: ExpressionLayerState, name: string, property: string): number => {
    const local =
      owner.referenceScope === undefined ? undefined : byScope.get(owner.referenceScope);
    const layer = local?.has(name) ? local.get(name) : byName.get(name);
    if (layer === null) throw new Error('Ambiguous layer name: ' + name);
    if (!layer) throw new Error('Unknown layer: ' + name);
    if (!(EXPRESSION_PROPERTIES as readonly string[]).includes(property))
      throw new Error('Unknown layer property: ' + property);
    return resolve(layer.id, property as ExpressionProperty);
  };
  const resolve = (id: string, property: ExpressionProperty): number => {
    const key = id + ':' + property;
    if (values.has(key)) return values.get(key)!;
    if (failures.has(key)) throw failures.get(key);
    const layer = byId.get(id)!;
    const expression = layer.expressions?.[property];
    if (!expression?.trim() || layer.expressionsEnabled?.[property] === false)
      return layer.transform[property];
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
      const context = Object.create(null) as ExpressionScope;
      for (const [name, value] of Object.entries({ ...scope, ...layer.scope, ...layer.transform }))
        Object.defineProperty(context, name, { value, configurable: true, enumerable: true });
      const local =
        layer.referenceScope === undefined ? undefined : byScope.get(layer.referenceScope);
      const value = evaluateExpression(
        expression,
        context,
        (name, property) => resolveLayer(layer, name, property),
        {
          apiVersion,
          modules,
          hasLayer: (name) => Boolean(local?.has(name) || byName.has(name)),
          resolveLayerById: (targetId, targetProperty) => {
            const target =
              referenceIds.get(layer.referenceScope)?.get(targetId) ??
              referenceIds.get(undefined)?.get(targetId);
            if (!target) throw new Error('Unknown layer ID: ' + targetId);
            if (!(EXPRESSION_PROPERTIES as readonly string[]).includes(targetProperty))
              throw new Error('Unknown layer property: ' + targetProperty);
            return resolve(target.id, targetProperty as ExpressionProperty);
          },
        },
      );
      values.set(key, value);
      return value;
    } catch (error) {
      failures.set(key, error);
      throw error;
    } finally {
      visiting.delete(key);
    }
  };
  const result = new Map(
    layers.map((layer) => {
      const transform = { ...layer.transform };
      for (const property of EXPRESSION_PROPERTIES) {
        try {
          transform[property] = resolve(layer.id, property);
        } catch (error) {
          // Failed properties and their dependents keep the sampled pose; unrelated ones still run.
          diagnostics?.push({
            layerId: layer.id,
            property,
            source: layer.expressions?.[property] ?? '',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return [layer.id, transform];
    }),
  );
  if (!scripting?.enabled || !scripting.source.trim()) return result;
  // A transaction prevents failed scripts (including late async writes) from changing a frame.
  const draft = new Map([...result].map(([id, transform]) => [id, { ...transform }]));
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
  const write = (name: string, property: string, value: number, byIdentity = false) => {
    if (!active)
      throw new Error('Layer writes are only valid during the synchronous composition script.');
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error(property + ' must be a finite number.');
    find(name, byIdentity)[property as ExpressionProperty] = value;
  };
  try {
    evaluateCompositionScript(
      scripting.source,
      scope,
      (name, property) => find(name)[property as ExpressionProperty],
      {
        apiVersion,
        modules,
        resolveLayerById: (id, property) => find(id, true)[property as ExpressionProperty],
        writeLayer: (name, property, value) => write(name, property, value),
        writeLayerById: (id, property, value) => write(id, property, value, true),
      },
    );
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
