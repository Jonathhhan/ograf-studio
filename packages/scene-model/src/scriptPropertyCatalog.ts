import type { Element } from './types';

export interface ScriptPropertyDefinition {
  type: 'number' | 'string' | 'boolean' | 'object' | 'array' | 'paint' | 'function';
  readOnly?: boolean;
  nullable?: boolean;
  shaderOnly?: boolean;
  values?: readonly string[];
  description?: string;
}
const number: ScriptPropertyDefinition = { type: 'number' };
const string: ScriptPropertyDefinition = { type: 'string' };
const object: ScriptPropertyDefinition = { type: 'object' };
const paint: ScriptPropertyDefinition = { type: 'paint' };
const shaderPaint: ScriptPropertyDefinition = {
  type: 'paint',
  shaderOnly: true,
  description: 'Shader paint; other paint types are not supported here.',
};
const choice = (...values: string[]): ScriptPropertyDefinition => ({ type: 'string', values });

/** Shared by script access, validation, property reference and editor completion. */
export const SCRIPT_ELEMENT_CATALOG: Record<
  Element['type'],
  Record<string, ScriptPropertyDefinition>
> = {
  text: {
    content: string,
    color: string,
    fill: paint,
    strokeColor: string,
    strokePaint: shaderPaint,
    strokeWidth: number,
    fontFamily: string,
    fontSize: number,
    fontWeight: number,
    textAlign: choice('left', 'center', 'right'),
    direction: choice('auto', 'ltr', 'rtl'),
    lineHeight: number,
    letterSpacing: number,
    textTransform: choice('none', 'uppercase', 'lowercase', 'capitalize'),
    verticalAlign: choice('top', 'middle', 'bottom'),
    baselineShift: number,
    minFontSize: number,
    overflowPolicy: choice('visible', 'clip', 'ellipsis'),
    autoFit: choice('auto-size', 'shrink-to-fit', 'fit-to-width', 'squeeze', 'fixed'),
  },
  rectangle: { fill: paint, strokeColor: string, strokeWidth: number, borderRadius: object },
  ellipse: { fill: paint, strokeColor: string, strokeWidth: number },
  path: {
    d: string,
    fill: paint,
    fillRule: choice('nonzero', 'evenodd'),
    strokeColor: string,
    strokeWidth: number,
    viewBoxWidth: number,
    viewBoxHeight: number,
    overflow: choice('visible'),
  },
  image: { src: { ...string, nullable: true }, fill: shaderPaint },
  'image-sequence': {
    frames: { type: 'array' },
    fps: number,
    loop: { type: 'boolean' },
    fill: shaderPaint,
  },
  lottie: { animationData: { ...object, nullable: true }, speed: number, fill: shaderPaint },
  pattern: { fill: paint, strokeColor: string, strokeWidth: number, definition: object },
  shader: {
    name: string,
    fragmentSource: string,
    speed: number,
    resolutionScale: number,
    parameters: object,
    inputImage: object,
  },
};

export const SCRIPT_ELEMENT_PROPERTIES = Object.fromEntries(
  Object.entries(SCRIPT_ELEMENT_CATALOG).map(([type, properties]) => [
    type,
    Object.keys(properties),
  ]),
) as unknown as Record<Element['type'], readonly string[]>;

export const SCRIPT_TRANSFORM_CATALOG = {
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  opacity: number,
  transformOriginX: number,
  transformOriginY: number,
};
export const SCRIPT_EFFECT_CATALOG: Record<string, ScriptPropertyDefinition> = {
  blur: number,
  dropShadowEnabled: { type: 'boolean' },
  dropShadowColor: string,
  dropShadowOpacity: number,
  dropShadowOffsetX: number,
  dropShadowOffsetY: number,
  dropShadowBlur: number,
  stack: { type: 'array' },
};
export const SCRIPT_VISUAL_CATALOG: Record<string, ScriptPropertyDefinition> = {
  isVisible: { type: 'boolean' },
  blendMode: choice(
    'normal',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
    'color-dodge',
    'color-burn',
    'hard-light',
    'soft-light',
    'difference',
    'exclusion',
  ),
  element: {
    type: 'object',
    readOnly: true,
    description: 'Read-only reference; supported members are writable.',
  },
  effects: object,
};
const sampling: Record<string, ScriptPropertyDefinition> = {
  property: {
    type: 'function',
    readOnly: true,
    description: 'property(name): value and authored valueAtTime(seconds).',
  },
  sourceRectAtTime: {
    type: 'function',
    readOnly: true,
    description:
      'Local source bounds at the requested time after text expressions and before composition-script writes.',
  },
};

export function scriptLayerPropertyCatalog(
  type: Element['type'],
  mode: 'expression' | 'composition',
): Record<string, ScriptPropertyDefinition> {
  const properties: Record<string, ScriptPropertyDefinition> = {};
  for (const [key, spec] of Object.entries(SCRIPT_TRANSFORM_CATALOG)) {
    if (mode === 'expression' && key.startsWith('transformOrigin')) continue;
    properties[key] = { ...spec, readOnly: mode === 'expression' };
  }
  if (mode === 'composition') {
    Object.assign(properties, SCRIPT_VISUAL_CATALOG);
    for (const [key, spec] of Object.entries(SCRIPT_ELEMENT_CATALOG[type]))
      if (key !== 'name') properties[key] = spec;
    properties.type = { ...string, readOnly: true };
    properties.properties = {
      type: 'function',
      readOnly: true,
      description: 'List available top-level properties.',
    };
  }
  const vectors: Record<string, ScriptPropertyDefinition> = {};
  Object.assign(vectors, {
    position: {
      type: 'array',
      readOnly: mode === 'expression',
      description: '[x, y] in pixels. Indices 0 and 1 alias x and y.',
    },
    size: {
      type: 'array',
      readOnly: mode === 'expression',
      description: '[width, height] in pixels. Changes layout; this is not visual scaling.',
    },
    transformOrigin: {
      type: 'array',
      readOnly: mode === 'expression',
      description: 'Normalized pivot in the layer bounds: [0, 1] for each axis.',
    },
  });
  return {
    ...properties,
    ...vectors,
    id: { ...string, readOnly: true },
    name: { ...string, readOnly: true },
    ...sampling,
  };
}
