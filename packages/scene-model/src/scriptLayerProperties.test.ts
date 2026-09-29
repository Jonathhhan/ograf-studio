import { describe, expect, it } from 'vitest';
import { scriptLayerReference } from './scriptLayerProperties';
import { createLayerOfKind } from './factory';
import { createShaderPaint } from './shader';
import { createDefaultTransform, createTextLayer, createRectangleElement } from './factory';
import {
  resolveExpressionTransforms,
  type ExpressionLayerState,
  type ExpressionDiagnostic,
} from './expressionTransforms';
import { expressionDataScope } from './expressions';

function fixture(): ExpressionLayerState {
  const text = createTextLayer();
  return {
    id: 'title',
    name: 'Title',
    transform: createDefaultTransform(),
    expressions: { x: '20' },
    scriptVisuals: {
      element: text.element,
      effects: text.effects,
      isVisible: true,
      blendMode: 'normal',
    },
  };
}
function run(layer: ExpressionLayerState, source: string, apiVersion = 1) {
  const diagnostics: ExpressionDiagnostic[] = [];
  const result = resolveExpressionTransforms(
    [layer],
    expressionDataScope({ title: 'Arabic' }),
    diagnostics,
    apiVersion,
    { enabled: true, source, modules: [] },
  );
  return { result: result.get(layer.id)!, diagnostics };
}
describe('composition script visual properties', () => {
  it('writes text, typography, effects and visibility after expressions without mutating authored data', () => {
    const layer = fixture();
    const before = structuredClone(layer);
    const { result, diagnostics } = run(
      layer,
      `const title = layer('Title'); title.content = data.title; title.fontSize = 72; title.textAlign = 'right'; title.effects.blur = 4; title.isVisible = false; title.blendMode = 'multiply'; title.x += 5; title.transformOriginX = 0;`,
    );
    expect(diagnostics).toEqual([]);
    expect(result).toMatchObject({
      x: 25,
      transformOriginX: 0,
      scriptVisuals: {
        element: { content: 'Arabic', fontSize: 72, textAlign: 'right' },
        effects: { blur: 4 },
        isVisible: false,
        blendMode: 'multiply',
      },
    });
    expect(layer).toEqual(before);
    expect(run(layer, '').result.scriptVisuals).toBeUndefined();
  });
  it('supports nested gradient edits and exposes the layer-specific property list', () => {
    const layer = fixture();
    layer.scriptVisuals!.element = createRectangleElement({
      fill: {
        type: 'linear',
        angle: 0,
        stops: [
          { offset: 0, opacity: 1, color: '#000000' },
          { offset: 1, opacity: 1, color: '#ffffff' },
        ],
      },
    });
    const { result, diagnostics } = run(
      layer,
      `const box = layerById('title'); if (!box.properties().includes('borderRadius')) throw Error('missing property'); box.fill.stops[0].color = '#ff0000'; box.borderRadius.topLeft = 25;`,
    );
    expect(diagnostics).toEqual([]);
    expect(result.scriptVisuals?.element).toMatchObject({
      fill: { stops: [{ color: '#ff0000' }, { color: '#ffffff' }] },
      borderRadius: { topLeft: 25 },
    });
  });
  it.each([
    `title.fontSize = '72'`,
    `title.fontSize = Infinity`,
    `title.textAlign = 'sideways'`,
    `title.effects = { blur: 5 }`,
    `title.element.type = 'image'`,
    `title.typo = 5`,
    `title.content = 'new'; throw Error('failure')`,
    `title.effects.blur = 5; return Promise.resolve()`,
    `Object.defineProperty(title.effects, 'blur', { value: 10 })`,
  ])('rolls back the entire script for invalid writes: %s', (source) => {
    const { result, diagnostics } = run(
      fixture(),
      `const title = layer('Title'); title.x = 999; ${source}`,
    );
    expect(diagnostics).toHaveLength(1);
    expect(result.x).toBe(20);
    expect(result.scriptVisuals).toBeUndefined();
  });
  it('does not expose visual setters to property expressions', () => {
    const layer = fixture();
    layer.expressions = { x: `layer('Title').fontSize = 99; return 1;` };
    const { result, diagnostics } = run(layer, '');
    expect(diagnostics).toHaveLength(1);
    expect(result.scriptVisuals).toBeUndefined();
  });
});

describe('text expressions', () => {
  it('applies chained detached setters and exposes readable OGraf fields', () => {
    const layer = fixture();
    layer.expressions = {
      text: `
        if (text.setFontSize(72) !== text) throw Error('setter did not chain');
        text.setText(data.title).setFontFamily('Inter').setLineHeight(1.4)
          .setLetterSpacing(2).setDirection('rtl').setColor('#f00').setFill('#0f0');
        if (text.fontSize !== 72 || text.direction !== 'rtl') throw Error('stale text');
        return text;
      `,
    };
    const before = structuredClone(layer);
    const { result, diagnostics } = run(layer, '');
    expect(diagnostics).toEqual([]);
    expect(result.scriptVisuals?.element).toMatchObject({
      type: 'text',
      content: 'Arabic',
      fontFamily: 'Inter',
      fontSize: 72,
      lineHeight: 1.4,
      letterSpacing: 2,
      direction: 'rtl',
      color: '#f00',
      fill: '#0f0',
    });
    expect(layer).toEqual(before);
  });

  it('commits neither text nor typography when evaluation fails', () => {
    const layer = fixture();
    layer.expressions = { text: "text.setText('Changed').setDirection('sideways')" };
    const { result, diagnostics } = run(layer, '');
    expect(diagnostics).toHaveLength(1);
    expect(result.scriptVisuals).toBeUndefined();
  });

  it('accepts a source-text string as the expression result', () => {
    const layer = fixture();
    layer.expressions = { text: "'Source text value'" };
    const { result, diagnostics } = run(layer, '');
    expect(diagnostics).toEqual([]);
    expect(result.scriptVisuals?.element).toMatchObject({ content: 'Source text value' });
  });

  it('keeps detached style mutations when the final result is a source-text string', () => {
    const layer = fixture();
    layer.expressions = {
      text: `text.setFontFamily('Inter');\nreturn 'rerer';`,
    };
    const { result, diagnostics } = run(layer, '');
    expect(diagnostics).toEqual([]);
    expect(result.scriptVisuals?.element).toMatchObject({
      content: 'rerer',
      fontFamily: 'Inter',
    });
  });

  it('commits setter-only expressions without an explicit return', () => {
    const layer = fixture();
    layer.expressions = { text: `text.setFontFamily('Inter');` };
    const { result, diagnostics } = run(layer, '');
    expect(diagnostics).toEqual([]);
    expect(result.scriptVisuals?.element).toMatchObject({
      content: 'Text',
      fontFamily: 'Inter',
    });
  });

  it('supports text expressions in API v1 and rejects non-text layers', () => {
    const text = fixture();
    text.expressions = { text: 'text.setFontSize(72)' };
    expect(run(text, '').diagnostics).toEqual([]);
    const rectangle = { ...fixture(), scriptVisuals: { ...fixture().scriptVisuals! } };
    rectangle.scriptVisuals!.element = createRectangleElement();
    rectangle.expressions = { text: 'text.setFontSize(72)' };
    expect(run(rectangle, '').diagnostics[0]?.message).toContain('text layer');
  });
});

it.each([
  ['image', `title.src = 'data:image/png;base64,AA==';`, { src: 'data:image/png;base64,AA==' }],
  [
    'image-sequence',
    `title.frames = ['a.png', 'b.png']; title.fps = 12; title.loop = false;`,
    { frames: ['a.png', 'b.png'], fps: 12, loop: false },
  ],
  ['lottie', `title.speed = 2; title.animationData = null;`, { speed: 2, animationData: null }],
  [
    'ellipse',
    `title.fill = '#123456'; title.strokeWidth = 3;`,
    { fill: '#123456', strokeWidth: 3 },
  ],
  [
    'path',
    `title.d = 'M0 0L10 10'; title.viewBoxWidth = 10;`,
    { d: 'M0 0L10 10', viewBoxWidth: 10 },
  ],
  ['pattern', `title.fill = '#123456';`, { fill: '#123456' }],
  [
    'shader',
    `title.element.name = 'New shader'; title.speed = 2;`,
    { name: 'New shader', speed: 2 },
  ],
] as const)('supports %s visual settings', (kind, source, expected) => {
  const layer = fixture();
  layer.scriptVisuals!.element =
    kind === 'shader' ? createShaderPaint() : createLayerOfKind(kind).element;
  const { result, diagnostics } = run(layer, `const title = layer('Title'); ${source}`);
  expect(diagnostics).toEqual([]);
  expect(result.scriptVisuals?.element).toMatchObject(expected);
});

it('guards retained nested references after evaluation and detaches committed values', () => {
  const layer = fixture();
  let active = true;
  const entry = scriptLayerReference(
    layer.transform,
    layer.scriptVisuals,
    { id: layer.id, name: 'Title' },
    () => {
      if (!active) throw Error('expired');
    },
    {},
  );
  const reference = entry.reference as { effects: { blur: number } };
  const retained = reference.effects;
  retained.blur = 3;
  const committed = entry.finish()!;
  active = false;
  expect(() => {
    retained.blur = 9;
  }).toThrow('expired');
  expect(committed.effects.blur).toBe(3);
  expect(layer.scriptVisuals!.effects.blur).toBe(0);
});
