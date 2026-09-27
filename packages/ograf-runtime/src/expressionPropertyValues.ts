import {
  getLayerExpressionProperties,
  TRANSFORM_ANIMATION_PROPERTIES,
  EFFECT_ANIMATION_PROPERTIES,
  effectParameterValue,
  parseEffectProperty,
  parseShaderAnimationProperty,
  getShaderAnimationValue,
  gradientStopIndexForProperty,
  isGradientPaint,
  getTrackValueAtFrame,
  withEffectParameter,
  type AnimatableLayerProperty,
  type MaskRenderState,
  type LayerTransform,
  type ExpressionValues,
} from '@ograf-editor/scene-model';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
import { resolveBoundElement } from './renderElement';

/** Resolve the same canonical numeric paths used by animation, including unkeyed paint. */
export function expressionPropertyValues(
  layer: CompiledLayer,
  state: MaskRenderState,
  data: Record<string, unknown>,
): Partial<Record<AnimatableLayerProperty, number>> {
  const element = resolveBoundElement(layer, data);
  return Object.fromEntries(
    getLayerExpressionProperties({ ...layer, element, loop: layer.loop ?? null }).map(
      (property) => {
        if (TRANSFORM_ANIMATION_PROPERTIES.includes(property as keyof LayerTransform))
          return [property, state.transform[property as keyof LayerTransform]];
        if (parseEffectProperty(property))
          return [property, Number(effectParameterValue(state.effects, property))];
        if (EFFECT_ANIMATION_PROPERTIES.some((key) => key === property))
          return [
            property,
            state.effects[property as (typeof EFFECT_ANIMATION_PROPERTIES)[number]],
          ];
        let fallback = 0;
        if (parseShaderAnimationProperty(property))
          fallback = getShaderAnimationValue(element, property);
        else if (property === 'strokeWidth' && element.type === 'text')
          fallback = element.strokeWidth;
        else {
          const stop = gradientStopIndexForProperty(property);
          const fill = 'fill' in element ? element.fill : undefined;
          if (stop !== null && isGradientPaint(fill)) fallback = fill.stops[stop]!.offset;
        }
        return [
          property,
          getTrackValueAtFrame(state.paintTracks[property] ?? [], state.paintFrame, fallback),
        ];
      },
    ),
  );
}

export function applyExpressionPropertyValues(
  state: MaskRenderState,
  values: ExpressionValues,
  original: Partial<Record<AnimatableLayerProperty, number>>,
): MaskRenderState {
  const transform = { ...state.transform };
  for (const property of TRANSFORM_ANIMATION_PROPERTIES) transform[property] = values[property];
  let effects = state.effects;
  let paintTracks = state.paintTracks;
  for (const [key, value] of Object.entries(values)) {
    const property = key as AnimatableLayerProperty;
    if (
      value === original[property] ||
      TRANSFORM_ANIMATION_PROPERTIES.includes(property as keyof LayerTransform)
    )
      continue;
    if (parseEffectProperty(property)) effects = withEffectParameter(effects, property, value);
    else if (EFFECT_ANIMATION_PROPERTIES.some((key) => key === property))
      effects = { ...effects, [property]: value };
    else
      paintTracks = {
        ...paintTracks,
        [property]: [
          { id: `expression:${property}`, frame: state.paintFrame, value, easing: 'linear' },
        ],
      };
  }
  return { ...state, transform, effects, paintTracks };
}
