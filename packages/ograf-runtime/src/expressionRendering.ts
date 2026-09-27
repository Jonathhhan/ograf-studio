import {
  resolveExpressionTransforms,
  expressionDataScope,
  expressionTimelineScope,
  type MaskRenderState,
  type ExpressionDiagnostic,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';

/** Resolve individual property dependencies, with measured auto-size boxes as the base pose. */
export function resolveFrameExpressions(
  descriptor: CompiledGraphicDescriptor,
  states: Map<string, MaskRenderState>,
  elements?: Map<string, HTMLElement>,
  data: Record<string, unknown> = {},
  diagnostics?: ExpressionDiagnostic[],
): Map<string, MaskRenderState> {
  if (!descriptor.layers.some((layer) => layer.expressions)) return new Map(states);
  const base = new Map(states);
  for (const layer of descriptor.layers) {
    const state = base.get(layer.id);
    const element = elements?.get(layer.id);
    if (
      !state ||
      !element ||
      layer.element.type !== 'text' ||
      layer.element.autoFit !== 'auto-size'
    )
      continue;
    const host = element.firstElementChild?.classList.contains('layer-content-host')
      ? (element.firstElementChild as HTMLElement)
      : element;
    const width = Number.parseFloat(host.style.width),
      height = Number.parseFloat(host.style.height);
    if (Number.isFinite(width) && Number.isFinite(height) && width >= 0 && height >= 0) {
      base.set(layer.id, { ...state, transform: { ...state.transform, width, height } });
    }
  }
  const transforms = resolveExpressionTransforms(
    descriptor.layers.flatMap((layer) => {
      const state = base.get(layer.id);
      if (!state) return [];
      const expressionState = state as MaskRenderState & {
        expressionFrame?: number;
        expressionExitProgress?: number;
      };
      const frame = expressionState.expressionFrame ?? 0;
      return [
        {
          ...layer,
          ...(layer.collectionItem
            ? {
                prototypeLayerId: layer.collectionItem.prototypeLayerId,
                referenceScope: JSON.stringify([
                  layer.collectionItem.collectionId,
                  layer.collectionItem.index,
                ]),
              }
            : {}),
          transform: state.transform,
          scope: {
            frame,
            time: frame / descriptor.frameRate,
            ...expressionTimelineScope(descriptor.keyframes, frame),
            ...(expressionState.expressionExitProgress === undefined
              ? {}
              : {
                  'timeline.exitProgress': expressionState.expressionExitProgress,
                }),
          },
        },
      ];
    }),
    {
      'comp.width': descriptor.width,
      'comp.height': descriptor.height,
      ...expressionDataScope(data),
      ...expressionTimelineScope(descriptor.keyframes),
    },
    diagnostics,
    descriptor.expressionApiVersion,
  );
  return new Map(
    [...base].map(([id, state]) => [
      id,
      { ...state, transform: transforms.get(id) ?? state.transform },
    ]),
  );
}
