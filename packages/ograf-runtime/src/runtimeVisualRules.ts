import {
  applyElementDataValue,
  visualRuleMatches,
  visualRuleValue,
} from '@ograf-editor/scene-model';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
import type { VisualRuleAction, VisualRuleTrigger } from '@ograf-editor/scene-model';

export interface VisualRuleStateOverride {
  properties: Record<string, unknown>;
  visibility?: boolean;
}

const EVENT_OPERATORS = new Set(['changed', 'increased', 'decreased']);

/** Whether runtime data can change this layer's rendered content or visibility. */
export function layerHasRuntimeVisualInputs(layer: CompiledLayer): boolean {
  const bindings = layer.bindings ?? (layer.binding ? [layer.binding] : []);
  return (
    bindings.length > 0 || (layer.visualRules?.length ?? 0) > 0 || Boolean(layer.collectionItem)
  );
}

export function matchingVisualRules(
  layer: CompiledLayer,
  currentData: Record<string, unknown>,
  previousData?: Record<string, unknown>,
) {
  return (layer.visualRules ?? []).filter((rule) => {
    if (!rule.enabled || (rule.trigger && rule.trigger !== 'data')) return false;
    const current = visualRuleValue(currentData[rule.dataKey], rule.sourcePath);
    const previous = previousData
      ? visualRuleValue(previousData[rule.dataKey], rule.sourcePath)
      : undefined;
    return visualRuleMatches(rule.operator, current, rule.value, previous);
  });
}

/** Pointer triggers are discrete events, independent of the OGraf data-field contract. */
export function pointerVisualRuleActions(
  layer: CompiledLayer,
  trigger: Exclude<VisualRuleTrigger, 'data'>,
): VisualRuleAction[] {
  return (layer.visualRules ?? [])
    .filter((rule) => rule.enabled && rule.trigger === trigger)
    .flatMap((rule) => rule.actions);
}

export function resolveVisualRuleElement(
  layer: CompiledLayer,
  data: Record<string, unknown>,
  element = layer.element,
) {
  let resolved = element;
  for (const rule of matchingVisualRules(layer, data)) {
    for (const action of rule.actions) {
      if (action.type === 'property') {
        resolved = applyElementDataValue(resolved, action.targetProperty, action.value);
      }
    }
  }
  return resolved;
}

export function visualRuleLayerVisible(
  layer: CompiledLayer,
  data: Record<string, unknown>,
): boolean {
  let visible = layer.isVisible;
  for (const rule of matchingVisualRules(layer, data)) {
    for (const action of rule.actions) {
      if (action.type === 'visibility') visible = action.visible;
    }
  }
  return visible;
}

export function triggeredVisualRuleActions(
  layer: CompiledLayer,
  currentData: Record<string, unknown>,
  previousData: Record<string, unknown>,
): Array<
  Extract<
    import('@ograf-editor/scene-model').VisualRuleAction,
    | { type: 'custom-action' }
    | { type: 'play-sound' }
    | { type: 'take-media' }
    | { type: 'shader-animation' }
  >
> {
  return matchingVisualRules(layer, currentData, previousData).flatMap((rule) => {
    const previous = visualRuleValue(previousData[rule.dataKey], rule.sourcePath);
    const entered = ['changed', 'increased', 'decreased'].includes(rule.operator)
      ? true
      : !visualRuleMatches(rule.operator, previous, rule.value);
    if (!entered) return [];
    return rule.actions.filter(
      (
        action,
      ): action is Extract<
        import('@ograf-editor/scene-model').VisualRuleAction,
        | { type: 'custom-action' }
        | { type: 'play-sound' }
        | { type: 'take-media' }
        | { type: 'shader-animation' }
      > =>
        action.type === 'custom-action' ||
        action.type === 'play-sound' ||
        action.type === 'take-media' ||
        action.type === 'shader-animation',
    );
  });
}

/**
 * Event rules are edges, while paint and visibility are states. Preserve the last visual state
 * produced by an event until a later event replaces the same property. This makes pairs such as
 * "score increased -> green" and "score decreased -> red" useful in both preview and playout.
 */
export function updateVisualRuleStateOverride(
  layer: CompiledLayer,
  currentData: Record<string, unknown>,
  previousData: Record<string, unknown>,
  current?: VisualRuleStateOverride,
): VisualRuleStateOverride | undefined {
  let next = current;
  for (const rule of matchingVisualRules(layer, currentData, previousData)) {
    if (!EVENT_OPERATORS.has(rule.operator)) continue;
    for (const action of rule.actions) {
      if (action.type === 'property') {
        next = {
          properties: { ...next?.properties, [action.targetProperty]: action.value },
          ...(next?.visibility === undefined ? undefined : { visibility: next.visibility }),
        };
      } else if (action.type === 'visibility') {
        next = { properties: { ...next?.properties }, visibility: action.visible };
      }
    }
  }
  return next;
}
