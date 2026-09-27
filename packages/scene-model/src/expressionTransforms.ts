import { evaluateExpression, type ExpressionScope, type ExpressionLogLevel } from './expressions';
import type { Layer, LayerTransform } from './types';

export const EXPRESSION_PROPERTIES = ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const;
type ExpressionProperty = (typeof EXPRESSION_PROPERTIES)[number];

export interface ExpressionDiagnostic {
  layerId: string;
  property: ExpressionProperty;
  source: string;
  message: string;
  kind?: 'log';
  level?: ExpressionLogLevel;
  frame?: number;
  count?: number;
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
): Map<string, LayerTransform> {
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
  let logCount = 0;
  const values = new Map<string, number>();
  const visiting = new Set<string>();
  const failures = new Map<string, unknown>();
  const referenceDescriptors = new Map<string | undefined, PropertyDescriptorMap>();
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
    if (!expression || layer.expressionsEnabled?.[property] === false)
      return layer.transform[property];
    if (visiting.has(key)) throw new Error('Circular expression dependency: ' + key);
    if (visiting.size >= 128) throw new Error('Expression dependency chain is too deep.');
    visiting.add(key);
    try {
      // Bare names and layer() share the same item-local lookup rules.
      let references = referenceDescriptors.get(layer.referenceScope);
      if (!references) {
        references = Object.create(null) as PropertyDescriptorMap;
        const local =
          layer.referenceScope === undefined ? undefined : byScope.get(layer.referenceScope);
        for (const name of new Set([...byName.keys(), ...(local?.keys() ?? [])])) {
          for (const property of EXPRESSION_PROPERTIES) {
            references[name + '.' + property] = {
              configurable: true,
              get: () => resolveLayer(layer, name, property),
            };
          }
        }
        referenceDescriptors.set(layer.referenceScope, references);
      }
      const context = Object.create(null, references) as ExpressionScope;
      // Define instead of assigning so a layer named "data" cannot intercept data.x, for example.
      for (const [name, value] of Object.entries({
        ...scope,
        ...layer.scope,
        ...layer.transform,
      })) {
        Object.defineProperty(context, name, { value, configurable: true });
      }
      const value = evaluateExpression(
        expression,
        context,
        (name, property) => resolveLayer(layer, name, property),
        {
          apiVersion,
          resolveLayerById: (targetId, targetProperty) => {
            const target =
              referenceIds.get(layer.referenceScope)?.get(targetId) ??
              referenceIds.get(undefined)?.get(targetId);
            if (!target) throw new Error('Unknown layer ID: ' + targetId);
            if (!(EXPRESSION_PROPERTIES as readonly string[]).includes(targetProperty))
              throw new Error('Unknown layer property: ' + targetProperty);
            return resolve(target.id, targetProperty as ExpressionProperty);
          },
          ...(diagnostics
            ? {
                onLog: (level: ExpressionLogLevel, args: unknown[]) => {
                  // Bound capture and serialization work even when a script logs in a loop.
                  if (logCount++ >= 100) return;
                  const message = args
                    .slice(0, 20)
                    .map((arg) => {
                      try {
                        return (
                          typeof arg === 'string' ? arg : (JSON.stringify(arg) ?? String(arg))
                        ).slice(0, 2000);
                      } catch {
                        return '[unserializable value]';
                      }
                    })
                    .join(' ')
                    .slice(0, 4000);
                  const previous = diagnostics.find(
                    (entry) =>
                      entry.kind === 'log' &&
                      entry.layerId === id &&
                      entry.property === property &&
                      entry.level === level &&
                      entry.message === message,
                  );
                  if (previous) {
                    previous.count = (previous.count ?? 1) + 1;
                    return;
                  }
                  diagnostics.push({
                    layerId: id,
                    property,
                    source: expression,
                    message,
                    kind: 'log',
                    level,
                    frame: Number(context.frame ?? 0),
                    count: 1,
                  });
                },
              }
            : {}),
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
  return new Map(
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
}
