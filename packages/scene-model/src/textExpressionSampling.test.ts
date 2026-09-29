import { describe, expect, it, vi } from 'vitest';
import { createDefaultTransform, createTextLayer } from './factory';
import {
  resolveExpressionTransforms,
  type ExpressionDiagnostic,
  type ExpressionLayerState,
} from './expressionTransforms';

function textLayer(id: string, source: string): ExpressionLayerState {
  const authored = createTextLayer();
  const visuals = {
    element: { ...authored.element, content: 'Base' },
    effects: authored.effects,
    isVisible: true,
    blendMode: 'normal' as const,
  };
  return {
    id,
    name: id,
    transform: createDefaultTransform({ x: 20 }),
    scope: { time: 2, frame: 50, 'timeline.exitProgress': 1, item: 'local' },
    expressions: { text: source },
    scriptVisuals: visuals,
    sampleScriptVisualsAtTime: () => visuals,
    sampleTransform: (time) => createDefaultTransform({ x: time * 10 }),
    sourceRectAtTimeWithVisuals: (_time, _extents, value) => ({
      left: 0,
      top: 0,
      width: value.element.type === 'text' ? value.element.content.length : 0,
      height: value.element.type === 'text' ? value.element.fontSize : 0,
    }),
  };
}
function run(layers: ExpressionLayerState[], source = '') {
  const diagnostics: ExpressionDiagnostic[] = [];
  const values = resolveExpressionTransforms(
    layers,
    { time: 2, frame: 50 },
    diagnostics,
    1,
    { enabled: true, modules: [], source },
    (time) => ({ time, frame: time * 25, 'timeline.exitProgress': time / 2 }),
  );
  return { diagnostics, values };
}

describe('text expression sampling', () => {
  it('uses historical time/frame/timeline while retaining layer-specific scope', () => {
    const title = textLayer(
      'Title',
      "if (item !== 'local') throw Error('lost local scope'); return `${time}:${frame}:${timeline.exitProgress}`;",
    );
    const follower = textLayer('Follower', "'unused'");
    follower.expressions = { x: "layer('Title').sourceRectAtTime(0).width" };
    const { values, diagnostics } = run(
      [follower, title],
      "layer('Follower').y = layer('Title').sourceRectAtTime(0).width;",
    );
    expect(diagnostics).toEqual([]);
    expect(values.get('Title')?.scriptVisuals?.element).toMatchObject({ content: '2:50:1' });
    expect(values.get('Follower')).toMatchObject({ x: 5, y: 5 });
  });

  it('supports ID references, metadata, sampled properties and authored self bounds in text expressions', () => {
    const title = textLayer(
      'Title',
      `
      if (layerById('Other').name !== 'Other') throw Error('missing metadata');
      return [layerById('Other').x, thisLayer.property('x').valueAtTime(1),
        layer('Other').property('x').valueAtTime(0), sourceRectAtTime().width,
        thisLayer.sourceRectAtTime(0).width, layerById('Title').sourceRectAtTime(0).width].join(',');
    `,
    );
    const other = textLayer('Other', "'Other'");
    const { values, diagnostics } = run([title, other]);
    expect(diagnostics).toEqual([]);
    expect(values.get('Title')?.scriptVisuals?.element).toMatchObject({ content: '20,10,0,4,4,4' });
  });

  it('resolves text bounds dependencies independently of layer order and caches text samples', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const first = textLayer('First', "String(layer('Second').sourceRectAtTime().width)");
      const second = textLayer('Second', "Math.random(); return 'longer';");
      const { values, diagnostics } = run([first, second]);
      expect(diagnostics).toEqual([]);
      expect(values.get('First')?.scriptVisuals?.element).toMatchObject({ content: '6' });
      expect(random).toHaveBeenCalledTimes(1);
    } finally {
      random.mockRestore();
    }
  });

  it('reports circular text dependencies without overflowing the stack', () => {
    const first = textLayer('First', "String(layer('Second').sourceRectAtTime().width)");
    const second = textLayer('Second', "String(layer('First').sourceRectAtTime().width)");
    const { values, diagnostics } = run([first, second]);
    expect(diagnostics).toHaveLength(2);
    expect(
      diagnostics.every((entry) => entry.message.includes('Circular text expression dependency')),
    ).toBe(true);
    expect(values.get('First')?.scriptVisuals).toBeUndefined();
  });

  it('overlays only explicit script writes onto historical text, including same-value assignments', () => {
    const title = textLayer(
      'Title',
      "text.setFontSize(time ? 40 : 10); return time ? 'Current text' : 'A';",
    );
    const follower = textLayer('Follower', "'unused'");
    const { values, diagnostics } = run(
      [title, follower],
      `
      const title = layer('Title');
      const currentText = title.content;
      title.fontSize = 40;
      const earlier = title.sourceRectAtTime(0);
      layer('Follower').x = earlier.width;
      layer('Follower').y = earlier.height;
      title.content = currentText;
      layer('Follower').width = title.sourceRectAtTime(0).width;
      if (earlier.width !== 1) throw Error('mutated earlier measurement');
    `,
    );
    expect(diagnostics).toEqual([]);
    expect(values.get('Follower')).toMatchObject({ x: 1, y: 40, width: 12 });
    expect(title.scriptVisuals?.element).toMatchObject({ content: 'Base' });
  });
});
