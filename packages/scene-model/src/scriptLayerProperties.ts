import {
  SCRIPT_ELEMENT_CATALOG,
  SCRIPT_ELEMENT_PROPERTIES,
  SCRIPT_VISUAL_CATALOG,
  SCRIPT_EFFECT_CATALOG,
  SCRIPT_TRANSFORM_CATALOG,
} from './scriptPropertyCatalog';
import { getPaintAtFrame, getTrackValueAtFrame } from './layerAnimation';
import { EFFECT_CATALOG } from './effectStack';
import { defineScriptVectors, SCRIPT_VECTOR_NAMES } from './scriptVectors';
import { sampleShaderAnimationTracks } from './shaderAnimation';
import type {
  Element,
  LayerAnimationTracks,
  LayerEffects,
  LayerTransform,
  TextElement,
  BlendMode,
} from './types';

/** The rendered properties of a layer, after data binding and animation sampling. */
export interface ScriptLayerVisuals {
  element: Element;
  effects: LayerEffects;
  isVisible: boolean;
  blendMode: BlendMode;
}
export type ScriptLayerTransform = LayerTransform & { scriptVisuals?: ScriptLayerVisuals };

/** One place to sample paint for scripts, browser rendering and SVG capture. */
export function sampleScriptElement(
  element: Element,
  tracks: LayerAnimationTracks,
  frame: number,
): Element {
  let sampled = sampleShaderAnimationTracks(element, tracks, frame);
  if ('fill' in sampled && sampled.fill !== undefined)
    sampled = { ...sampled, fill: getPaintAtFrame(sampled.fill, tracks, frame) } as Element;
  if (sampled.type === 'text' && tracks.strokeWidth?.length)
    sampled = {
      ...sampled,
      strokeWidth: getTrackValueAtFrame(tracks.strokeWidth, frame, sampled.strokeWidth),
    };
  return sampled;
}

const forbidden = new Set(['__proto__', 'constructor', 'prototype']);

/** Reject non-JSON values rather than letting a script leak functions, cycles or non-finite values into rendering. */
function jsonCopy(value: unknown, seen = new Set<object>()): any {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value))
    throw new Error('Script property values must be finite, acyclic JSON data.');
  seen.add(value);
  const copy: any = Array.isArray(value) ? [] : {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined && !Array.isArray(value)) continue;
    if (forbidden.has(key)) throw new Error('Unsupported script property: ' + key);
    copy[key] = jsonCopy(child, seen);
  }
  seen.delete(value);
  return copy;
}
function requireType(value: unknown, type: string, key: string): void {
  if (typeof value !== type || (type === 'number' && !Number.isFinite(value)))
    throw new Error(key + ' must be a finite ' + type + '.');
}
function validatePaint(value: any): void {
  if (typeof value === 'string') return;
  if (!value || typeof value !== 'object')
    throw new Error('Paint must be a colour string, gradient or shader.');
  if (value.type === 'shader') {
    requireType(value.fragmentSource, 'string', 'fragmentSource');
    requireType(value.speed, 'number', 'speed');
    requireType(value.resolutionScale, 'number', 'resolutionScale');
    if (
      !value.parameters ||
      typeof value.parameters !== 'object' ||
      Array.isArray(value.parameters)
    )
      throw new Error('Shader parameters must be an object.');
    return;
  }
  if (
    !['linear', 'radial', 'conic'].includes(value.type) ||
    !Array.isArray(value.stops) ||
    value.stops.length < 2
  )
    throw new Error('A gradient needs a valid type and at least two stops.');
  requireType(value.angle, 'number', 'angle');
  for (const stop of value.stops) {
    requireType(stop.offset, 'number', 'offset');
    requireType(stop.opacity, 'number', 'opacity');
    requireType(stop.color, 'string', 'color');
  }
}
function validateStructure(value: any, base: any, path: string): void {
  if (base === null || base === undefined) return;
  if (typeof base !== 'object') {
    requireType(value, typeof base, path);
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) !== Array.isArray(base))
    throw new Error(path + ' has an invalid structure.');
  if (Array.isArray(base)) {
    if (base.length) for (const child of value) validateStructure(child, base[0], path + '[]');
  } else
    for (const [key, child] of Object.entries(base)) {
      if (!Object.hasOwn(value, key)) throw new Error(path + '.' + key + ' is required.');
      validateStructure(value[key], child, path + '.' + key);
    }
}
export function validateScriptElement(element: Element): void {
  const values = element as unknown as Record<string, unknown>;
  for (const key of SCRIPT_ELEMENT_PROPERTIES[element.type]) {
    const value = values[key];
    if (value === undefined) continue;
    const spec = SCRIPT_ELEMENT_CATALOG[element.type][key]!;
    if (value === null && spec.nullable) continue;
    if (spec.values) {
      if (!spec.values.includes(value as string)) throw new Error('Invalid ' + key + ': ' + value);
    } else if (spec.type === 'number') requireType(value, 'number', key);
    else if (spec.type === 'paint') {
      validatePaint(value);
      if (spec.shaderOnly && (value as any)?.type !== 'shader')
        throw new Error(key + ' requires a shader paint for this layer.');
    } else if (key === 'frames') {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
        throw new Error('frames must contain image URL strings.');
    } else if (key === 'loop') requireType(value, 'boolean', key);
    else if (spec.type === 'object') {
      if (
        !(key === 'animationData' && value === null) &&
        (!value || typeof value !== 'object' || Array.isArray(value))
      )
        throw new Error(key + ' must be an object.');
    } else if (!(key === 'src' && value === null)) requireType(value, 'string', key);
  }
  if (element.type === 'rectangle')
    for (const key of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const)
      requireType(element.borderRadius[key], 'number', 'borderRadius.' + key);
  if (element.type === 'shader') validatePaint(element);
}

const textSetterName = (property: string) => 'set' + property[0]!.toUpperCase() + property.slice(1);

/** A detached, transactional text view used while evaluating a text expression. */
export function textExpressionReference(
  element: TextElement,
  assertActive: () => void = () => undefined,
): { text: object; finish: () => TextElement } {
  let draft = jsonCopy(element) as TextElement;
  const text = Object.create(null) as Record<string, unknown>;
  const assign = (property: string, value: unknown) => {
    assertActive();
    const next = jsonCopy(draft) as TextElement;
    (next as unknown as Record<string, unknown>)[property] = jsonCopy(value);
    validateScriptElement(next);
    draft = next;
    return text;
  };
  for (const property of Object.keys(SCRIPT_ELEMENT_CATALOG.text)) {
    Object.defineProperty(text, property, {
      enumerable: true,
      get: () => draft[property as keyof TextElement],
      set: (value: unknown) => {
        assign(property, value);
      },
    });
    Object.defineProperty(text, textSetterName(property), {
      enumerable: true,
      value: (value: unknown) => assign(property, value),
    });
  }
  Object.defineProperty(text, 'text', {
    enumerable: true,
    get: () => draft.content,
  });
  Object.defineProperty(text, 'setText', {
    enumerable: true,
    value: (value: unknown) => assign('content', value),
  });
  Object.preventExtensions(text);
  return {
    text,
    finish: () => {
      validateScriptElement(draft);
      return draft;
    },
  };
}

/** Mutable detached views. Every setter checks the transaction lifetime, including nested/retained references. */
export function scriptLayerReference(
  transform: LayerTransform,
  visuals: ScriptLayerVisuals | undefined,
  metadata: { id: string; name: string },
  assertActive: () => void,
  methods: Record<string, unknown>,
  measureSourceRect?: (
    seconds: number | undefined,
    includeExtents: boolean | undefined,
    visuals: ScriptLayerVisuals | undefined,
    applyVisualWrites: (sampledVisuals: ScriptLayerVisuals) => ScriptLayerVisuals,
    applyTransformWrites: (sampledTransform: LayerTransform) => LayerTransform,
  ) => object,
): { reference: object; finish: () => ScriptLayerVisuals | undefined } {
  let draft: ScriptLayerVisuals | undefined;
  const transformWrites: Partial<LayerTransform> = {};
  const applyTransformWrites = (sampledTransform: LayerTransform): LayerTransform => ({
    ...sampledTransform,
    ...transformWrites,
  });
  const visualWrites: Array<{ path: string[]; value: unknown }> = [];
  const recordWrite = (path: string[], value: unknown) => {
    visualWrites.push({ path, value: jsonCopy(value) });
  };
  const applyVisualWrites = (sampledVisuals: ScriptLayerVisuals): ScriptLayerVisuals => {
    const sampled = jsonCopy(sampledVisuals);
    for (const { path, value } of visualWrites) {
      let target: any = sampled;
      for (let index = 0; index < path.length - 1; index++) {
        const key = path[index]!;
        if (!target[key] || typeof target[key] !== 'object')
          target[key] = /^\d+$/.test(path[index + 1]!) ? [] : {};
        target = target[key];
      }
      target[path[path.length - 1]!] = jsonCopy(value);
    }
    return sampled;
  };
  const getDraft = () => {
    if (!visuals) throw new Error('Visual properties are unavailable for this layer.');
    return (draft ??= jsonCopy(visuals));
  };
  const proxies = new WeakMap<object, object>();
  const wrap = (value: any, path: string[] = []): any => {
    if (!value || typeof value !== 'object') return value;
    let proxy = proxies.get(value);
    if (!proxy) {
      proxy = new Proxy(value, {
        get: (target, key) => wrap(Reflect.get(target, key), [...path, String(key)]),
        set: (target, key, next) => {
          assertActive();
          if (
            typeof key !== 'string' ||
            forbidden.has(key) ||
            key === 'type' ||
            key === 'id' ||
            key === 'patternId'
          )
            throw new Error('Read-only property: ' + String(key));
          if (
            !Array.isArray(target) &&
            !Object.hasOwn(target, key) &&
            !(
              path.join('.') === 'element' &&
              SCRIPT_ELEMENT_PROPERTIES[visuals!.element.type].includes(key)
            ) &&
            !(path.join('.') === 'effects' && key === 'stack') &&
            !(
              /^effects\.stack\.\d+$/.test(path.join('.')) &&
              ['blendMode', 'blendOpacity'].includes(key)
            )
          )
            throw new Error('Unknown nested property: ' + key);
          const copied = jsonCopy(next);
          const written = Reflect.set(target, key, copied);
          // Retained references to a replaced object no longer belong to this draft.
          let current: any = draft;
          for (const component of path) current = current?.[component];
          if (written && current === target) recordWrite([...path, key], copied);
          return written;
        },
        deleteProperty: () => {
          throw new Error('Replace the property or array instead of deleting its members.');
        },
        defineProperty: () => {
          throw new Error('Script property descriptors are read-only.');
        },
        setPrototypeOf: () => false,
        preventExtensions: () => false,
      });
      proxies.set(value, proxy!);
    }
    return proxy;
  };
  const target = Object.create(null);
  defineScriptVectors(
    target,
    (property) => transform[property as keyof LayerTransform] ?? 0,
    (property, value) => {
      assertActive();
      transform[property as keyof LayerTransform] = value;
      transformWrites[property as keyof LayerTransform] = value;
    },
  );
  const define = (key: string, get: () => unknown, set?: (value: any) => void) =>
    Object.defineProperty(target, key, {
      enumerable: true,
      get,
      ...(set
        ? {
            set: (value: any) => {
              assertActive();
              set(value);
            },
          }
        : {}),
    });
  for (const key of Object.keys(SCRIPT_TRANSFORM_CATALOG) as (keyof LayerTransform)[])
    define(
      key,
      () => transform[key] ?? (key === 'scaleX' || key === 'scaleY' ? 1 : 0),
      (value) => {
        requireType(value, 'number', key);
        transform[key] = value;
        transformWrites[key] = value;
      },
    );
  if (visuals) {
    const elementFields = SCRIPT_ELEMENT_PROPERTIES[visuals.element.type];
    for (const key of elementFields.filter((key) => key !== 'name'))
      define(
        key,
        () => wrap((getDraft().element as any)[key], ['element', key]),
        (value) => {
          (getDraft().element as any)[key] = jsonCopy(value);
          recordWrite(['element', key], value);
        },
      );
    define('element', () => wrap(getDraft().element, ['element']));
    define(
      'effects',
      () => wrap(getDraft().effects, ['effects']),
      (value) => {
        getDraft().effects = jsonCopy(value);
        recordWrite(['effects'], value);
      },
    );
    define(
      'isVisible',
      () => getDraft().isVisible,
      (value) => {
        requireType(value, 'boolean', 'isVisible');
        getDraft().isVisible = value;
        recordWrite(['isVisible'], value);
      },
    );
    define(
      'blendMode',
      () => getDraft().blendMode,
      (value) => {
        if (!SCRIPT_VISUAL_CATALOG.blendMode!.values!.includes(value))
          throw new Error('Invalid blendMode.');
        getDraft().blendMode = value;
        recordWrite(['blendMode'], value);
      },
    );
    define('type', () => visuals.element.type);
  }
  if (measureSourceRect) {
    Object.defineProperty(target, 'sourceRectAtTime', {
      value: (seconds?: number, includeExtents?: boolean) => {
        assertActive();
        const currentVisuals = draft ?? visuals;
        if (currentVisuals?.element.type === 'text') {
          // A script may be midway through editing a gradient. Paint is irrelevant to
          // measurement; validate only the source/layout that the renderer will consume.
          const { fill: _fill, strokePaint: _strokePaint, ...layout } = currentVisuals.element;
          validateScriptElement({
            ...layout,
            fill: '#000000',
            color: '#000000',
            strokeColor: '#000000',
          });
        }
        const bounds = measureSourceRect(
          seconds,
          includeExtents,
          draft ?? visuals,
          applyVisualWrites,
          applyTransformWrites,
        );
        // A measurement is a snapshot, not a mutable renderer/cache object.
        return Object.freeze({ ...bounds });
      },
    });
  }
  for (const [key, value] of Object.entries({ ...metadata, ...methods }))
    if (!(measureSourceRect && key === 'sourceRectAtTime'))
      Object.defineProperty(target, key, { value });
  Object.defineProperty(target, 'properties', {
    value: () => [...Object.keys(target), ...SCRIPT_VECTOR_NAMES],
  });
  return {
    reference: Object.preventExtensions(target),
    finish: () => {
      if (!draft || JSON.stringify(draft) === JSON.stringify(visuals)) return undefined;
      validateScriptElement(draft.element);
      for (const key of ['definition', 'inputImage'] as const) {
        const before = (visuals!.element as any)[key],
          after = (draft.element as any)[key];
        if (before !== undefined) validateStructure(after, before, key);
      }
      if (draft.element.type === 'lottie' && draft.element.animationData) {
        const animation = draft.element.animationData;
        for (const key of ['fr', 'ip', 'op', 'w', 'h'] as const)
          requireType(animation[key], 'number', 'animationData.' + key);
        if (!Array.isArray(animation.layers))
          throw new Error('animationData.layers must be an array.');
      }
      for (const key of [
        'blur',
        'dropShadowEnabled',
        'dropShadowColor',
        'dropShadowOpacity',
        'dropShadowOffsetX',
        'dropShadowOffsetY',
        'dropShadowBlur',
      ])
        if (!Object.hasOwn(draft.effects, key)) throw new Error('effects.' + key + ' is required.');
      for (const [key, value] of Object.entries(draft.effects)) {
        if (key === 'stack') {
          if (!Array.isArray(value)) throw new Error('Effect stack must be an array.');
          for (const effect of value) {
            requireType(effect.id, 'string', 'effect.id');
            requireType(effect.enabled, 'boolean', 'effect.enabled');
            if (
              ![
                'blur',
                'drop-shadow',
                'glow',
                'brightness',
                'contrast',
                'saturate',
                'hue-rotate',
                'shader',
              ].includes(effect.type) ||
              !effect.params ||
              typeof effect.params !== 'object'
            )
              throw new Error('Invalid effect stack entry.');
            requireType(effect.name, 'string', 'effect.name');
            for (const [key, spec] of Object.entries(
              EFFECT_CATALOG[effect.type as keyof typeof EFFECT_CATALOG].params,
            ))
              requireType(effect.params[key], typeof spec.default, 'effects.params.' + key);
            if (effect.type === 'shader') validatePaint(effect.shader);
          }
        } else requireType(value, SCRIPT_EFFECT_CATALOG[key]?.type ?? 'number', 'effects.' + key);
      }
      return jsonCopy(draft);
    },
  };
}
