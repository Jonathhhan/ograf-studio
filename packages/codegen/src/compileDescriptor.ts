import { migrateShaderElement, migrateShaderBindingTarget } from '@ograf-editor/scene-model';
import {
  computeKeyframeFrames,
  compositionWithShaderParameterFields,
  getResolvedLayerAnimationTracks,
  normalizeLayerAutoLayout,
  normalizeTextAnimation,
  resolveElementAssetReferences,
  resolveAssetValue,
  resolvePatternElement,
  type Composition,
  type VisualRuleCondition,
} from '@ograf-editor/scene-model';
import type {
  CompiledGraphicDescriptor,
  CompiledKeyframe,
  CompiledLayer,
  CompiledPaintOrderEntry,
  CompiledRuntimeCollection,
  CompiledVisualRuleCondition,
} from '@ograf-editor/ograf-types';

export type {
  CompiledGraphicDescriptor,
  CompiledKeyframe,
  CompiledLayer,
} from '@ograf-editor/ograf-types';

/**
 * Project/Composition -> CompiledGraphicDescriptor. Resolves each layer binding's `fieldId` to the
 * field's `key` (the name the runtime `data` payload actually uses), and drops guide layers
 * (design-time-only, excluded from anything that ships).
 */
export function compileDescriptor(
  composition: Composition,
  options: { includeGuides?: boolean } = {},
): CompiledGraphicDescriptor {
  composition = compositionWithShaderParameterFields(composition);
  const keyframeFrames = computeKeyframeFrames(composition);
  const frameByKeyframeId = new Map(keyframeFrames.map((k) => [k.keyframeId, k.frame]));
  const fieldKeyById = new Map(composition.dataFields.map((f) => [f.id, f.key]));

  const keyframes: CompiledKeyframe[] = composition.keyframes.map((keyframe) => ({
    id: keyframe.id,
    frame: frameByKeyframeId.get(keyframe.id) ?? 0,
    role: keyframe.role,
  }));

  const startKeyframeId = keyframes.find((keyframe) => keyframe.role === 'start')?.id;
  const endKeyframeId = keyframes.find((keyframe) => keyframe.role === 'end')?.id;
  if (!startKeyframeId || !endKeyframeId) {
    throw new Error('Composition must contain exactly one explicit start and end keyframe.');
  }
  const stepKeyframeIds = keyframes
    .filter((keyframe) => keyframe.role === 'step')
    .map((keyframe) => keyframe.id);

  const compiledLayerIds = new Set(
    composition.layers
      .filter((layer) => options.includeGuides || !layer.isGuide)
      .map((layer) => layer.id),
  );
  const compileRuleCondition = (
    condition: VisualRuleCondition,
  ): CompiledVisualRuleCondition | null => {
    const dataKey = fieldKeyById.get(condition.fieldId);
    if (dataKey === undefined) return null;
    const compareDataKey = condition.compareFieldId
      ? fieldKeyById.get(condition.compareFieldId)
      : undefined;
    return {
      dataKey,
      sourcePath: [...condition.sourcePath],
      operator: condition.operator,
      ...(condition.value !== undefined ? { value: structuredClone(condition.value) } : {}),
      ...(compareDataKey !== undefined
        ? { compareDataKey, compareSourcePath: [...(condition.compareSourcePath ?? [])] }
        : {}),
      ...(condition.ignoreCase ? { ignoreCase: true } : {}),
    };
  };

  const compileLayer = (layer: Composition['layers'][number]): CompiledLayer => {
    const autoLayout = normalizeLayerAutoLayout(layer.autoLayout);
    const animationTracks = getResolvedLayerAnimationTracks(layer);
    const clipParent = layer.parentId
      ? composition.layers.find(
          (candidate) => candidate.id === layer.parentId && candidate.clipChildren,
        )
      : undefined;
    const layoutParent = layer.parentId
      ? composition.layers.find(
          (candidate) =>
            candidate.id === layer.parentId &&
            normalizeLayerAutoLayout(candidate.autoLayout).direction !== 'none',
        )
      : undefined;
    const mediaCue = composition.mediaCues.find(
      (candidate) => candidate.visual.targetLayerId === layer.id,
    );
    const activeMediaSource = mediaCue?.sources.find(
      (source) => source.id === mediaCue.activeSourceId,
    );
    const mediaTriggerFrame =
      mediaCue?.trigger.type === 'timeline'
        ? mediaCue.trigger.startFrame
        : mediaCue?.trigger.type === 'lifecycle'
          ? (frameByKeyframeId.get(mediaCue.trigger.keyframeId) ?? 0)
          : 0;
    const element =
      mediaCue &&
      activeMediaSource &&
      !(activeMediaSource.kind === 'clip' && activeMediaSource.mediaType === 'audio') &&
      'fill' in layer.element
        ? {
            ...layer.element,
            fill: {
              type: 'media' as const,
              source:
                activeMediaSource.kind === 'clip'
                  ? { kind: 'clip' as const, src: activeMediaSource.src }
                  : {
                      kind: 'live' as const,
                      tag: activeMediaSource.tag,
                      ...(activeMediaSource.fallback
                        ? { fallback: activeMediaSource.fallback }
                        : {}),
                    },
              fit: mediaCue.visual.fit,
              positionX: mediaCue.visual.positionX,
              positionY: mediaCue.visual.positionY,
              loop: mediaCue.loop,
              speed: mediaCue.speed,
              offsetMs: mediaCue.trimStartMs,
              trimEndMs: mediaCue.trimEndMs,
              timelineStartMs: (mediaTriggerFrame / composition.frameRate) * 1000,
              muted: true as const,
            },
          }
        : layer.element;
    return {
      id: layer.id,
      isVisible: layer.isVisible,
      blendMode: layer.blendMode,
      element: resolvePatternElement(
        resolveElementAssetReferences(migrateShaderElement(element), composition.assets),
        composition.patterns,
      ),
      effects: layer.effects,
      ...(layer.lighting
        ? {
            lighting: {
              ...layer.lighting,
              definition: structuredClone(
                composition.patterns.find((p) => p.id === layer.lighting!.patternId)!,
              ),
            },
          }
        : {}),
      keyframes: layer.keyframes.map((keyframe) => ({
        id: keyframe.id,
        frame: keyframe.frame,
        transform: keyframe.transform,
        easing: keyframe.easing,
      })),
      animationTracks: Object.fromEntries(
        Object.entries(animationTracks).map(([property, keyframes]) => [
          property,
          keyframes?.map((keyframe) => ({ ...keyframe })) ?? [],
        ]),
      ),
      loop: layer.loop
        ? {
            ...layer.loop,
            activation: { ...layer.loop.activation },
            tracks: Object.fromEntries(
              Object.entries(layer.loop.tracks).map(([property, keys]) => [
                property,
                keys?.map((key) => ({
                  ...key,
                  ...(key.curve ? { curve: { ...key.curve } } : {}),
                })) ?? [],
              ]),
            ),
          }
        : null,
      bindings: layer.bindings.flatMap((binding) => {
        const dataKey = fieldKeyById.get(binding.fieldId);
        return dataKey === undefined
          ? []
          : [
              {
                dataKey,
                targetProperty: migrateShaderBindingTarget(binding.targetProperty),
                ...(binding.sourcePath?.length ? { sourcePath: [...binding.sourcePath] } : {}),
                ...(binding.valueMap ? { valueMap: structuredClone(binding.valueMap) } : {}),
              },
            ];
      }),
      visualRules: (layer.visualRules ?? []).flatMap((rule) => {
        const isData = !rule.trigger || rule.trigger === 'data';
        const primary = compileRuleCondition(rule);
        if (isData && !primary) return [];
        const conditions = (rule.conditions ?? []).flatMap((condition) => {
          const compiled = compileRuleCondition(condition);
          return compiled ? [compiled] : [];
        });
        const actions = structuredClone(rule.actions).filter(
          (action) =>
            !('targetLayerId' in action) ||
            !action.targetLayerId ||
            compiledLayerIds.has(action.targetLayerId),
        );
        if (actions.length === 0) return [];
        return [
          {
            id: rule.id,
            name: rule.name,
            enabled: rule.enabled,
            ...(rule.trigger ? { trigger: rule.trigger } : {}),
            ...(primary && isData
              ? primary
              : { dataKey: '', sourcePath: [], operator: rule.operator }),
            ...(conditions.length ? { conditions } : {}),
            ...(rule.match ? { match: rule.match } : {}),
            ...(rule.eventId ? { eventId: rule.eventId } : {}),
            ...(rule.delayFrames ? { delayFrames: rule.delayFrames } : {}),
            actions,
          },
        ];
      }),
      clipParentId: clipParent?.id ?? null,
      layoutParentId: layoutParent?.id ?? null,
      autoLayout,
      updateTransition: structuredClone(
        layer.updateTransition ?? { style: 'inherit', durationFrames: 0, distance: 24 },
      ),
      motionPath:
        layer.motionPath &&
        composition.layers.some((candidate) => candidate.id === layer.motionPath!.sourceLayerId)
          ? structuredClone(layer.motionPath)
          : null,
      isMaskOnly: layer.isMaskOnly,
      mask: layer.mask ? { ...layer.mask } : null,
    };
  };

  const prototypeOwnerByLayerId = new Map<string, string>();
  for (const collection of composition.runtimeCollections) {
    for (const layerId of collection.prototypeLayerIds) {
      prototypeOwnerByLayerId.set(layerId, collection.id);
    }
  }

  const layers: CompiledLayer[] = composition.layers
    .filter(
      (layer) =>
        (options.includeGuides || !layer.isGuide) && !prototypeOwnerByLayerId.has(layer.id),
    )
    .map(compileLayer);

  const collections: CompiledRuntimeCollection[] = composition.runtimeCollections.map(
    (collection) => {
      const dataKey = fieldKeyById.get(collection.fieldId);
      if (!dataKey) throw new Error(`Runtime collection field is missing: ${collection.fieldId}`);
      const prototypeLayers = collection.prototypeLayerIds.map((layerId) => {
        const layer = composition.layers.find((candidate) => candidate.id === layerId);
        if (!layer) throw new Error(`Runtime collection prototype layer is missing: ${layerId}`);
        return compileLayer(layer);
      });
      return {
        id: collection.id,
        name: collection.name,
        dataKey,
        prototypeGroupId:
          composition.layers.find((layer) => layer.id === collection.prototypeLayerIds[0])
            ?.groupId ?? null,
        prototypeLayers,
        offsetPerItem: { ...collection.offsetPerItem },
        capacity: collection.capacity,
        overflow: collection.overflow,
        itemKeyPath: [...(collection.itemKeyPath ?? [])],
        sortPath: [...(collection.sortPath ?? [])],
        sortDirection: collection.sortDirection ?? 'none',
        pageSize: collection.pageSize ?? 0,
        page: collection.page ?? 0,
      };
    },
  );

  const paintOrder: CompiledPaintOrderEntry[] = [];
  const emittedCollections = new Set<string>();
  for (const layer of composition.layers) {
    if (!options.includeGuides && layer.isGuide) continue;
    const collectionId = prototypeOwnerByLayerId.get(layer.id);
    if (collectionId) {
      if (!emittedCollections.has(collectionId)) {
        paintOrder.push({ type: 'collection', id: collectionId });
        emittedCollections.add(collectionId);
      }
    } else {
      paintOrder.push({ type: 'layer', id: layer.id });
    }
  }

  return {
    width: composition.width,
    height: composition.height,
    backgroundColor: composition.backgroundColor,
    frameRate: composition.frameRate,
    updateTransitionFrames: composition.updateTransitionFrames,
    updateInterruption: composition.updateInterruption ?? 'queue',
    fonts: composition.assets
      .filter((asset) => asset.kind === 'font')
      .map((asset) => ({
        family: asset.fontFamily || asset.name.replace(/\.[^.]+$/, ''),
        source: `asset:${asset.id}`,
        mimeType: asset.mimeType,
        weight: asset.fontWeight || '100 900',
        style: asset.fontStyle || 'normal',
      })),
    mediaCues: composition.mediaCues.map((cue) => ({
      ...structuredClone(cue),
      sources: cue.sources.map((source) =>
        source.kind === 'clip'
          ? { ...source, src: resolveAssetValue(source.src, composition.assets) }
          : {
              ...source,
              ...(source.fallback
                ? { fallback: resolveAssetValue(source.fallback, composition.assets) }
                : {}),
            },
      ),
    })),
    layers,
    collections,
    paintOrder,
    keyframes,
    transitions: composition.transitions.map((t) => ({
      fromKeyframeId: t.fromKeyframeId,
      toKeyframeId: t.toKeyframeId,
      durationFrames: t.durationFrames,
      easing: t.easing,
    })),
    stepKeyframeIds,
    stepCount: stepKeyframeIds.length,
    startKeyframeId,
    endKeyframeId,
    customActions: composition.customActions.map((action) => ({
      id: action.actionId,
      name: action.name,
      durationFrames: Math.max(
        composition.layers.reduce((longest, layer) => {
          if (layer.element.type === 'text') {
            const textAnimation = normalizeTextAnimation(layer.element.textAnimation);
            if (textAnimation.type !== 'none' && textAnimation.customActionId === action.actionId) {
              longest = Math.max(longest, textAnimation.durationFrames);
            }
          }
          const loop = layer.loop;
          if (
            loop?.activation.type !== 'customAction' ||
            loop.activation.customActionId !== action.actionId
          ) {
            return longest;
          }
          return Math.max(longest, loop.durationFrames * (loop.repeatCount ?? 1));
        }, 0),
        ...composition.mediaCues
          .filter(
            (cue) =>
              cue.trigger.type === 'customAction' && cue.trigger.actionId === action.actionId,
          )
          .map((cue) => cue.transition.durationFrames),
        ...composition.mediaCues
          .filter(
            (cue) =>
              cue.trigger.type === 'customAction' && cue.trigger.actionId === action.actionId,
          )
          .map((cue) => cue.durationFrames ?? 0),
      ),
    })),
  };
}
