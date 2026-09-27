import { getLayerAnimatableProperties, gradientStopIndexForProperty } from './layerAnimation';
import { isGradientPaint } from './paint';
import type { AnimatableLayerProperty, Layer } from './types';
import { parseShaderAnimationProperty, normalizeShaderAnimationValue } from './shaderAnimation';
import { effectParameterSpec } from './effectStack';

/** Keep script reads consistent with the numeric constraints applied by the renderer. */
export function normalizeExpressionPropertyValue(
  layer: Pick<Layer, 'element' | 'effects'>,
  property: AnimatableLayerProperty,
  value: number,
): number {
  if (parseShaderAnimationProperty(property))
    return normalizeShaderAnimationValue(layer.element, property, value);
  const effect = effectParameterSpec(layer.effects, property);
  if (effect) return Math.max(effect.min ?? -Infinity, Math.min(effect.max ?? Infinity, value));
  if (gradientStopIndexForProperty(property) !== null || property === 'dropShadowOpacity')
    return Math.max(0, Math.min(1, value));
  if (property === 'strokeWidth' || property === 'blur' || property === 'dropShadowBlur')
    return Math.max(0, value);
  return value;
}

/** Only existing numeric animation targets are exposed; stale authored expressions stay editable. */
export function getLayerExpressionProperties(
  layer: Pick<Layer, 'element' | 'effects' | 'animationTracks' | 'loop'>,
): AnimatableLayerProperty[] {
  return getLayerAnimatableProperties(layer).filter((property) => {
    const stop = gradientStopIndexForProperty(property);
    if (stop === null) return true;
    const fill = 'fill' in layer.element ? layer.element.fill : undefined;
    return isGradientPaint(fill) && Boolean(fill.stops[stop]);
  });
}

export const EXPRESSION_GROUPS = ['Transform', 'Text', 'Appearance', 'Effects'] as const;
export function expressionPropertyGroup(property: string): (typeof EXPRESSION_GROUPS)[number] {
  if (property === 'strokeWidth') return 'Text';
  if (property.startsWith('fill.') || property.startsWith('strokePaint.')) return 'Appearance';
  if (property === 'blur' || property.startsWith('dropShadow') || property.startsWith('effects.'))
    return 'Effects';
  return 'Transform';
}
