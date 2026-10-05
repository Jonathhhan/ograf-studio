import type {
  CompiledGraphicDescriptor,
  CompiledLayer,
  CompiledRuntimeCollection,
} from '@ograf-editor/ograf-types';

function instanceId(collectionId: string, index: number, prototypeLayerId: string): string {
  return `${collectionId}::${index}::${prototypeLayerId}`;
}

function offsetLayer(
  collection: CompiledRuntimeCollection,
  prototype: CompiledLayer,
  slot: number,
  idByPrototypeId: Map<string, string>,
): CompiledLayer {
  const offsetX = collection.offsetPerItem.x * slot;
  const offsetY = collection.offsetPerItem.y * slot;
  const layer = structuredClone(prototype);
  layer.id = idByPrototypeId.get(prototype.id)!;
  layer.keyframes = layer.keyframes.map((keyframe) => ({
    ...keyframe,
    transform: {
      ...keyframe.transform,
      x: keyframe.transform.x + offsetX,
      y: keyframe.transform.y + offsetY,
    },
  }));
  for (const [property, offset] of [
    ['x', offsetX],
    ['y', offsetY],
  ] as const) {
    const keys = layer.animationTracks[property];
    if (keys)
      layer.animationTracks[property] = keys.map((key) => ({ ...key, value: key.value + offset }));
    const loopKeys = layer.loop?.tracks[property];
    if (loopKeys && layer.loop) {
      layer.loop.tracks[property] = loopKeys.map((key) => ({ ...key, value: key.value + offset }));
    }
  }
  layer.transformParentId = prototype.transformParentId
    ? (idByPrototypeId.get(prototype.transformParentId) ?? prototype.transformParentId)
    : null;
  layer.clipParentId = prototype.clipParentId
    ? (idByPrototypeId.get(prototype.clipParentId) ?? null)
    : null;
  layer.layoutParentId = prototype.layoutParentId
    ? (idByPrototypeId.get(prototype.layoutParentId) ?? null)
    : null;
  layer.mask = prototype.mask
    ? {
        ...prototype.mask,
        sourceLayerId:
          idByPrototypeId.get(prototype.mask.sourceLayerId) ?? prototype.mask.sourceLayerId,
      }
    : null;
  layer.motionPath = prototype.motionPath
    ? {
        ...prototype.motionPath,
        sourceLayerId:
          idByPrototypeId.get(prototype.motionPath.sourceLayerId) ??
          prototype.motionPath.sourceLayerId,
      }
    : null;
  layer.bindings = layer.bindings.map((binding) => ({ ...binding, itemIndex: slot }));
  // A row's rules drive that row's copies of sibling prototype layers.
  if (layer.visualRules)
    layer.visualRules = layer.visualRules.map((rule) => ({
      ...rule,
      actions: rule.actions.map((action) =>
        'targetLayerId' in action &&
        action.targetLayerId &&
        idByPrototypeId.has(action.targetLayerId)
          ? { ...action, targetLayerId: idByPrototypeId.get(action.targetLayerId)! }
          : action,
      ),
    }));
  layer.collectionItem = {
    collectionId: collection.id,
    dataKey: collection.dataKey,
    slot,
    capacity: collection.capacity,
    itemKeyPath: [...collection.itemKeyPath],
    sortPath: [...collection.sortPath],
    sortDirection: collection.sortDirection,
    pageSize: collection.pageSize,
    page: collection.page,
    offsetPerItem: { ...collection.offsetPerItem },
    prototypeLayerId: prototype.id,
    index: slot,
  };
  return layer;
}

function expandCollection(collection: CompiledRuntimeCollection): CompiledLayer[] {
  const result: CompiledLayer[] = [];
  for (let index = 0; index < collection.capacity; index++) {
    const idByPrototypeId = new Map(
      collection.prototypeLayers.map((layer) => [
        layer.id,
        instanceId(collection.id, index, layer.id),
      ]),
    );
    for (const prototype of collection.prototypeLayers) {
      result.push(offsetLayer(collection, prototype, index, idByPrototypeId));
    }
  }
  return result;
}

function valueAtPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function runtimeCollectionItemSelection(
  layer: CompiledLayer,
  data: Record<string, unknown>,
): { index: number; key: string } | null {
  const item = layer.collectionItem;
  if (!item) return null;
  const value = data[item.dataKey];
  if (!Array.isArray(value)) return null;
  const ordered = value.map((entry, index) => ({ entry, index }));
  if (item.sortDirection !== 'none' && item.sortPath.length > 0) {
    ordered.sort((left, right) => {
      const a = valueAtPath(left.entry, item.sortPath),
        b = valueAtPath(right.entry, item.sortPath);
      const comparison =
        typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });
      return (
        (item.sortDirection === 'descending' ? -comparison : comparison) || left.index - right.index
      );
    });
  }
  const pageSize = item.pageSize > 0 ? Math.min(item.pageSize, item.capacity) : item.capacity;
  const selected = ordered[item.page * pageSize + item.slot];
  if (!selected || item.slot >= pageSize) return null;
  const rawKey = item.itemKeyPath.length
    ? valueAtPath(selected.entry, item.itemKeyPath)
    : selected.index;
  return { index: selected.index, key: String(rawKey ?? selected.index) };
}

/** Pure bounded expansion shared by the packaged runtime and browser-authoritative capture. */
export function expandRuntimeCollections(
  descriptor: CompiledGraphicDescriptor,
): CompiledGraphicDescriptor {
  const collections = descriptor.collections ?? [];
  if (collections.length === 0) return descriptor;
  const layerById = new Map(descriptor.layers.map((layer) => [layer.id, layer]));
  const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
  const layers: CompiledLayer[] = [];
  const paintOrder = descriptor.paintOrder ?? [
    ...descriptor.layers.map((layer) => ({ type: 'layer' as const, id: layer.id })),
    ...collections.map((collection) => ({ type: 'collection' as const, id: collection.id })),
  ];
  for (const entry of paintOrder) {
    if (entry.type === 'layer') {
      const layer = layerById.get(entry.id);
      if (layer) layers.push(layer);
    } else {
      const collection = collectionById.get(entry.id);
      if (collection) layers.push(...expandCollection(collection));
    }
  }
  return { ...descriptor, layers };
}

export function isRuntimeCollectionLayerActive(
  layer: CompiledLayer,
  data: Record<string, unknown>,
): boolean {
  const item = layer.collectionItem;
  if (!item) return true;
  return runtimeCollectionItemSelection(layer, data) !== null;
}
