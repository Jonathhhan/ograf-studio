import type { Element } from './types';
import { inspectShaderSource, resolveShaderParameters, getElementShaderPaint } from './shader';
import { isGradientPaint } from './paint';
import { normalizeShaderParameterValue, shaderColorToHex } from './shaderParameters';

const NUMERIC_TEXT_PROPERTIES = new Set([
  'fontSize',
  'fontWeight',
  'strokeWidth',
  'lineHeight',
  'letterSpacing',
  'baselineShift',
  'minFontSize',
]);

/** Immutable data overrides, shared by Studio, diagnostic capture and exported runtime. */
export function applyElementDataValue(element: Element, property: string, value: unknown): Element {
  if (property === 'dropShadowColor' || property.startsWith('effects.')) return element;
  const shaderTarget = /^(?:(fill|strokePaint)\.)?parameters\.(.+)$/.exec(property);
  const slot = shaderTarget?.[1] === 'strokePaint' ? 'stroke' : 'fill';
  const shader = getElementShaderPaint(element, slot);
  if (shaderTarget && !shader)
    throw new Error(`Shader parameter binding "${property}" requires a shader paint.`);
  if (shader && shaderTarget) {
    const name = shaderTarget[2]!;
    const definition = inspectShaderSource(shader.fragmentSource).parameters.find(
      (parameter) => parameter.name === name,
    );
    if (!definition) throw new Error(`Unknown shader parameter "${name}".`);
    let normalized = normalizeShaderParameterValue(definition, value);
    const authored = resolveShaderParameters(shader)[name];
    // GDD hex defaults quantize to 8 bits; retain exact authored channels for that default.
    if (
      definition.control === 'color' &&
      Array.isArray(authored) &&
      typeof value === 'string' &&
      shaderColorToHex(authored).toLowerCase() === value.toLowerCase()
    )
      normalized = authored;
    const fill = { ...shader, parameters: { ...shader.parameters, [name]: normalized } };
    if (slot === 'stroke' && element.type === 'text') return { ...element, strokePaint: fill };
    if (element.type === 'shader') return fill;
    if (!('fill' in element))
      throw new Error(`Shader parameter binding "${property}" requires a paintable object.`);
    return { ...element, fill };
  }
  const stop = /^fill\.stops\[(0|[1-9]\d*)\]\.color$/.exec(property);
  if (stop) {
    if (!('fill' in element) || !isGradientPaint(element.fill)) return element;
    const index = Number(stop[1]);
    if (!element.fill.stops[index]) return element;
    return {
      ...element,
      fill: {
        ...element.fill,
        stops: element.fill.stops.map((s, i) => (i === index ? { ...s, color: String(value) } : s)),
      },
    } as Element;
  }
  if (element.type === 'text' && property === 'color') {
    return {
      ...element,
      color: String(value),
      ...(typeof element.fill === 'string' ? { fill: String(value) } : {}),
    };
  }
  if (element.type === 'text' && property === 'content') {
    return { ...element, content: String(value), runs: [] };
  }
  if (element.type === 'text' && NUMERIC_TEXT_PROPERTIES.has(property)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? ({ ...element, [property]: numeric } as Element) : element;
  }
  return {
    ...element,
    [property]: property === 'fill' && value && typeof value === 'object' ? value : String(value),
  } as Element;
}

/** The value `applyElementDataValue` would replace; `undefined` when the element lacks it. */
export function readElementDataValue(element: Element, property: string): unknown {
  if (property === 'dropShadowColor' || property.startsWith('effects.')) return undefined;
  const shaderTarget = /^(?:(fill|strokePaint)\.)?parameters\.(.+)$/.exec(property);
  if (shaderTarget) {
    const shader = getElementShaderPaint(
      element,
      shaderTarget[1] === 'strokePaint' ? 'stroke' : 'fill',
    );
    return shader ? resolveShaderParameters(shader)[shaderTarget[2]!] : undefined;
  }
  const stop = /^fill\.stops\[(0|[1-9]\d*)\]\.color$/.exec(property);
  if (stop)
    return 'fill' in element && isGradientPaint(element.fill)
      ? element.fill.stops[Number(stop[1])]?.color
      : undefined;
  return (element as unknown as Record<string, unknown>)[property];
}
