import type { Layer, LayerExpressionProperty } from './types';

type ExpressionLayer = {
  expressions?: Layer['expressions'];
  expressionsEnabled?: Layer['expressionsEnabled'];
};

export function expressionFieldForProperty(property: string): LayerExpressionProperty | undefined {
  if (property === 'x' || property === 'y') return 'position';
  if (property === 'width' || property === 'height') return 'size';
  if (property === 'transformOriginX' || property === 'transformOriginY') return 'transformOrigin';
  if (property === 'rotation' || property === 'opacity') return property;
  return undefined;
}

export function hasActiveTransformExpression(layer: ExpressionLayer, property: string): boolean {
  const field = expressionFieldForProperty(property);
  const target =
    field && layer.expressions?.[field]?.trim() ? field : (property as LayerExpressionProperty);
  return (
    Boolean(layer.expressions?.[target]?.trim()) && layer.expressionsEnabled?.[target] !== false
  );
}
