import {
  resolveExpressionTransforms,
  expressionDataScope,
  expressionTimelineScope,
  type MaskRenderState,
  type ExpressionDiagnostic,
} from '@ograf-editor/scene-model';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';

/** Apply scripts to the sampled frame before transforms and masks are rendered. */
export function resolveFrameExpressions(
  descriptor: CompiledGraphicDescriptor,
  states: Map<string, MaskRenderState>,
  data: Record<string, unknown> = {},
  diagnostics?: ExpressionDiagnostic[],
): Map<string, MaskRenderState> {
  if (!descriptor.scripting?.enabled && !descriptor.layers.some((layer) => layer.expressions))
    return new Map(states);
  const clock = [...states.values()][0] as
    (MaskRenderState & { expressionFrame?: number; expressionExitProgress?: number }) | undefined;
  const frame = clock?.expressionFrame ?? 0;
  const transforms = resolveExpressionTransforms(
    descriptor.layers.flatMap((layer) => {
      const state = states.get(layer.id);
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
      frame,
      time: frame / descriptor.frameRate,
      'comp.width': descriptor.width,
      'comp.height': descriptor.height,
      ...expressionDataScope(data),
      ...expressionTimelineScope(descriptor.keyframes, frame),
      ...(clock?.expressionExitProgress === undefined
        ? {}
        : { 'timeline.exitProgress': clock.expressionExitProgress }),
    },
    diagnostics,
    descriptor.expressionApiVersion,
    descriptor.scripting,
  );
  return new Map(
    [...states].map(([id, state]) => [
      id,
      { ...state, transform: transforms.get(id) ?? state.transform },
    ]),
  );
}
