import { describe, expect, it, vi } from 'vitest';
import {
  resolveExpressionTransforms,
  type ExpressionLayerState,
  type ExpressionDiagnostic,
} from './expressionTransforms';
import { createTextLayer } from './factory';

function layer(
  id: string,
  expressions?: ExpressionLayerState['expressions'],
): ExpressionLayerState {
  return {
    id,
    name: id,
    expressions,
    transform: {
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    },
  };
}

describe('resolveExpressionTransforms', () => {
  it('samples other expressions and their dependencies at the requested time', () => {
    const a = layer('A', { x: 'value + time * 10', y: 'frame' });
    const b = layer('B', { x: "layer('A').x + layer('A').y" });
    for (const target of [a, b])
      target.sampleTransform = (t) => ({ ...target.transform, x: t * 100 });
    const follower = layer('Follower', { x: "layerById('B').property('x').valueAtTime(2)" });
    const errors: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms(
      [follower, b, a],
      { time: 5, frame: 250 },
      errors,
      1,
      undefined,
      (time) => ({ time, frame: time * 50 }),
    );
    expect(errors).toEqual([]);
    expect(result.get('Follower')?.x).toBe(320);
  });

  it('keeps self samples authored and evaluates other properties on the same layer', () => {
    const a = layer('A', {
      x: "valueAtTime(2) + thisLayer.property('y').valueAtTime(2)",
      y: 'time * 3',
    });
    a.sampleTransform = (t) => ({ ...a.transform, x: t * 100 });
    const errors: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([a], { time: 5 }, errors);
    expect(errors).toEqual([]);
    expect(result.get('A')?.x).toBe(206);
  });

  it('treats aliases of the current vector as self samples', () => {
    const a = layer('A', {
      position: "[layerById('A').property('x').valueAtTime(2), valueAtTime(3)[1]]",
    });
    a.sampleTransform = (t) => ({ ...a.transform, x: t * 100, y: t * 10 });
    const b = layer('B', { position: "layer('A').property('position').valueAtTime(1)" });
    const errors: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([b, a], { time: 0 }, errors);
    expect(errors).toEqual([]);
    expect(result.get('B')).toMatchObject({ x: 200, y: 30 });
  });

  it('evaluates a sampled property once per time and does not replay Comp', () => {
    const a = layer('A', { x: 'counter.next()' });
    a.sampleTransform = () => a.transform;
    const b = layer('B', {
      x: "const p = layer('A').property('x'); return p.valueAtTime(2) - p.valueAtTime(2);",
    });
    const errors: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([b, a], { time: 0 }, errors, 1, {
      enabled: true,
      modules: [
        { fileName: 'counter.js', source: 'let n = 0; export function next() { return ++n; }' },
      ],
      source: "layer('A').x = 999; layer('B').y = layer('A').property('x').valueAtTime(2);",
    });
    expect(errors).toEqual([]);
    expect(result.get('B')).toMatchObject({ x: 0, y: 10 });
    expect(result.get('A')?.x).toBe(999);
  });

  it('detects cycles across different times', () => {
    const a = layer('A', { x: "layer('B').property('x').valueAtTime(1)" });
    const b = layer('B', { x: "layer('A').property('x').valueAtTime(0)" });
    for (const target of [a, b]) target.sampleTransform = () => target.transform;
    const errors: ExpressionDiagnostic[] = [];
    resolveExpressionTransforms([a, b], { time: 0 }, errors);
    expect(errors[0]?.message).toContain('A.x -> B.x@1 -> A.x');
  });

  it('runs expressions once before sequential Comp writes without refreshing dependents', () => {
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms(
      [
        layer('Title'),
        layer('Box', { width: "layer('Title').width + 20" }),
        layer('Follower', { x: "layer('Box').width" }),
      ],
      {},
      diagnostics,
      1,
      {
        enabled: true,
        modules: [],
        source: `
          layer('Title').width = 200;
          if (layer('Box').width !== 120) throw Error('Expression unexpectedly refreshed');
          layer('Box').width = layer('Title').width + 20;
          layer('Title').width = 300;
          if (layer('Box').width !== 220) throw Error('Sequential assignment changed');
        `,
      },
    );
    expect(diagnostics).toEqual([]);
    expect(result.get('Title')?.width).toBe(300);
    expect(result.get('Box')?.width).toBe(220);
    expect(result.get('Follower')?.x).toBe(120);
  });

  it('honors sequential text/box writes, retains snapshots, and keeps authored time samples separate', () => {
    const authored = createTextLayer();
    const title = layer('Title');
    title.scriptVisuals = {
      element: authored.element,
      effects: authored.effects,
      isVisible: true,
      blendMode: 'normal',
    };
    title.sampleTransform = () => ({ ...title.transform, width: 80 });
    title.sampleScriptVisualsAtTime = () => title.scriptVisuals!;
    title.sourceRectAtTimeWithVisuals = (_at, _extents, visuals, pose) => {
      if (visuals.element.type !== 'text') throw Error('Expected text');
      return {
        left: 0,
        top: 0,
        width: Math.min(pose!.width, visuals.element.content.length * visuals.element.fontSize),
        height: visuals.element.fontSize,
      };
    };
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([title, layer('Box')], { time: 1 }, diagnostics, 1, {
      enabled: true,
      modules: [],
      source: `
        const title = layer('Title');
        const width = title.property('width');
        title.content = 'Hello';
        title.fontSize = 20;
        title.width = 300;
        const first = title.sourceRectAtTime();
        if (!Object.isFrozen(first) || first.width !== 100) throw Error('Invalid initial snapshot');
        title.element.fontSize = 40;
        title.size[0] = 150;
        if (width.value !== 150 || width.valueAtTime(0) !== 80) throw Error('Incorrect current/authored reads');
        const second = title.sourceRectAtTime();
        if (first.width !== 100 || second.width !== 150) throw Error('Snapshot changed');
        const past = title.sourceRectAtTime(0);
        if (past.width !== 150 || past.height !== 40) throw Error('Earlier writes missing in timed bounds');
        layer('Box').width = second.width + 24;
        layer('Box').height = second.height + 12;
      `,
    });
    expect(diagnostics).toEqual([]);
    expect(result.get('Box')).toMatchObject({ width: 174, height: 52 });
    expect(title.transform.width).toBe(100);
    expect(title.scriptVisuals.element).toEqual(authored.element);
  });

  it('evicts old authored time samples without changing their results', () => {
    const title = layer('Title');
    const sample = vi.fn((time: number) => ({ ...title.transform, x: time }));
    title.sampleTransform = sample;
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([title], { time: 0 }, diagnostics, 1, {
      enabled: true,
      modules: [],
      source: `
        const x = layer('Title').property('x');
        for (let i = 0; i < 140; i++) x.valueAtTime(i);
        if (x.valueAtTime(139) !== 139) throw Error('Recent sample changed');
        layer('Title').x = x.valueAtTime(0);
      `,
    });
    expect(diagnostics).toEqual([]);
    expect(result.get('Title')!.x).toBe(0);
    expect(sample).toHaveBeenCalledTimes(141);
  });

  it('rejects invalid text writes before calling the renderer and rolls back the script', () => {
    const authored = createTextLayer();
    const title = layer('Title');
    title.scriptVisuals = {
      element: authored.element,
      effects: authored.effects,
      isVisible: true,
      blendMode: 'normal',
    };
    const measure = vi.fn(() => ({ left: 0, top: 0, width: 1, height: 1 }));
    title.sourceRectAtTimeWithVisuals = measure;
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([title], { time: 0 }, diagnostics, 1, {
      enabled: true,
      modules: [],
      source: `const title = layer('Title'); title.x = 900; title.fontSize = 'invalid'; title.sourceRectAtTime();`,
    });
    expect(diagnostics).toHaveLength(1);
    expect(measure).not.toHaveBeenCalled();
    expect(result.get('Title')!.x).toBe(10);
  });
  it('shares authored samples across stages without re-running expressions or leaking between evaluations', () => {
    const target = layer('Title', {
      x: 'helpers.tick(); return valueAtTime(1) + 100;',
      y: 'layer("Title").x + layer("Title").property("x").valueAtTime(1)',
      width: 'sourceRectAtTime(1).width + 10',
    });
    const sample = vi.fn(() => ({ ...target.transform }));
    const rect = vi.fn((_time: number, extents: boolean) => ({
      left: 0,
      top: 0,
      width: target.transform.width + (extents ? 4 : 0),
      height: 50,
    }));
    target.sampleTransform = sample;
    target.sourceRectAtTime = rect;
    const scripting = {
      enabled: true,
      modules: [
        {
          fileName: 'helpers.js',
          source: 'let n=0; export function tick(){return ++n;} export function count(){return n;}',
        },
      ],
      source: `const title = layer('Title');
        title.x = title.x + 1000;
        title.y = title.property('x').valueAtTime(1);
        title.height = title.sourceRectAtTime(1).width;
        title.width = title.sourceRectAtTime(1, true).width;
        title.rotation = helpers.count();`,
    };
    const errors: ExpressionDiagnostic[] = [];
    let result = resolveExpressionTransforms([target], { time: 1 }, errors, 1, scripting);
    expect(errors).toEqual([]);
    expect(result.get('Title')).toMatchObject({
      x: 1110,
      y: 10,
      width: 104,
      height: 100,
      rotation: 1,
    });
    expect(sample).toHaveBeenCalledTimes(1);
    expect(rect).toHaveBeenCalledTimes(2);
    expect(target.transform.x).toBe(10);
    // Same timestamp, new data/geometry: a new evaluation must not reuse the old samples.
    target.transform.x = 20;
    target.transform.width = 200;
    result = resolveExpressionTransforms([target], { time: 1 }, errors, 1, scripting);
    expect(result.get('Title')).toMatchObject({
      x: 1120,
      y: 20,
      width: 204,
      height: 200,
      rotation: 2,
    });
    expect(sample).toHaveBeenCalledTimes(2);
    expect(rect).toHaveBeenCalledTimes(4);
    expect(errors).toEqual([]);
  });

  it('uses text-expression content when composition scripts read source bounds', () => {
    const authoredText = createTextLayer();
    const text = layer('Text', { text: "time < 0.5 ? 'A' : 'Longer text'" });
    text.scriptVisuals = {
      element: authoredText.element,
      effects: authoredText.effects,
      isVisible: true,
      blendMode: 'normal',
    };
    text.sourceRectAtTime = () => ({ left: 0, top: 0, width: 30, height: 20 });
    text.sourceRectAtTimeWithVisuals = (_seconds, _includeExtents, visuals) => ({
      left: 0,
      top: 0,
      width: visuals.element.type === 'text' ? visuals.element.content.length * 10 : 0,
      height: 20,
    });
    text.sampleScriptVisualsAtTime = () => ({
      element: authoredText.element,
      effects: authoredText.effects,
      isVisible: true,
      blendMode: 'normal',
    });
    const follower = layer('Smiley');
    const result = resolveExpressionTransforms([text, follower], { time: 1 }, [], 1, {
      enabled: true,
      modules: [],
      source: `const title = layer('Text');
if (title.content !== 'Longer text') throw Error('text expression was not applied');
title.content = 'Later text';
const bounds = title.sourceRectAtTime(0);
layer('Smiley').x = bounds.width;`,
    });
    expect(result.get('Text')?.scriptVisuals?.element).toMatchObject({ content: 'Later text' });
    expect(result.get('Smiley')).toMatchObject({ x: 100 });
  });

  it.each(['title.width = 350;', 'title.size[0] = 350;', 'title.size = [350, 60];'])(
    'applies earlier box writes when measuring historical text: %s',
    (write) => {
      const authored = createTextLayer();
      const text = layer('Text');
      text.transform.width = 350;
      text.scriptVisuals = {
        element: authored.element,
        effects: authored.effects,
        isVisible: true,
        blendMode: 'normal',
      };
      const sampled = { ...text.transform, width: 100, height: 40 };
      text.sampleTransform = () => sampled;
      text.sampleScriptVisualsAtTime = () => text.scriptVisuals!;
      text.sourceRectAtTimeWithVisuals = (_seconds, _extents, _visuals, pose) => ({
        left: 0,
        top: 0,
        width: pose!.width,
        height: pose!.height,
      });
      const diagnostics: ExpressionDiagnostic[] = [];
      const result = resolveExpressionTransforms(
        [text, layer('Follower')],
        { time: 1 },
        diagnostics,
        1,
        {
          enabled: true,
          modules: [],
          source: `const title = layer('Text');
          if (title.sourceRectAtTime(0).width !== 100) throw Error('unsampled width');
          ${write}
          layer('Follower').x = title.sourceRectAtTime(0).width;
          layer('Follower').y = title.sourceRectAtTime(0).height;`,
        },
      );
      expect(diagnostics).toEqual([]);
      expect(result.get('Follower')).toMatchObject({
        x: 350,
        y: write.includes('[350, 60]') ? 60 : 40,
      });
      expect(sampled).toMatchObject({ width: 100, height: 40 });
    },
  );

  it('does not apply text expressions twice to sampled source bounds', () => {
    const authoredText = createTextLayer();
    const text = layer('Text', { text: "text.content + '!'" });
    text.scriptVisuals = {
      element: authoredText.element,
      effects: authoredText.effects,
      isVisible: true,
      blendMode: 'normal',
    };
    text.sourceRectAtTimeWithVisuals = (_seconds, _includeExtents, visuals) => ({
      left: 0,
      top: 0,
      width: visuals.element.type === 'text' ? visuals.element.content.length : 0,
      height: 20,
    });
    text.sampleScriptVisualsAtTime = () => ({
      element: authoredText.element,
      effects: authoredText.effects,
      isVisible: true,
      blendMode: 'normal',
    });
    const follower = layer('Smiley', { x: 'layer("Text").sourceRectAtTime(0).width' });

    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([text, follower], { time: 1 }, diagnostics, 1);

    expect(diagnostics).toEqual([]);
    const expectedWidth =
      authoredText.element.type === 'text' ? authoredText.element.content.length + 1 : 0;
    expect(result.get('Smiley')).toMatchObject({ x: expectedWidth });
  });

  it.each([
    'layer("Title").property("fontSize").value',
    'layer("Title").property("x").valueAtTime(NaN)',
    'layer("Title").sourceRectAtTime(Infinity).width',
    'layer("Title").sourceRectAtTime(0, "yes").width',
  ])('uses the same sampling validation in expressions and scripts: %s', (source) => {
    const target = layer('Title', { x: source });
    target.sampleTransform = () => ({ ...target.transform });
    target.sourceRectAtTime = () => ({ left: 0, top: 0, width: 100, height: 50 });
    const expressionErrors: ExpressionDiagnostic[] = [];
    resolveExpressionTransforms([target], {}, expressionErrors);
    target.expressions = {};
    const scriptErrors: ExpressionDiagnostic[] = [];
    resolveExpressionTransforms([target], {}, scriptErrors, 1, {
      enabled: true,
      source: `layer("Title").x = ${source};`,
      modules: [],
    });
    expect(expressionErrors).toHaveLength(1);
    expect(scriptErrors).toHaveLength(1);
    expect(scriptErrors[0]!.message).toBe(expressionErrors[0]!.message);
  });

  it('provides the sampled value and read-only metadata for each current property', () => {
    const target = layer('Title');
    target.expressions = Object.fromEntries(
      ['x', 'y', 'width', 'height', 'rotation', 'opacity'].map((property) => [
        property,
        `if (thisProperty.name !== ${JSON.stringify(property)} || thisProperty.layerId !== thisLayer.id || thisLayer.name !== "Title") throw new Error("metadata"); return value + thisProperty.value;`,
      ]),
    );
    const diagnostics: ExpressionDiagnostic[] = [];
    expect(resolveExpressionTransforms([target], {}, diagnostics).get('Title')).toMatchObject({
      x: 20,
      y: 40,
      width: 200,
      height: 100,
      rotation: 0,
      opacity: 2,
    });
    expect(diagnostics).toEqual([]);
    target.expressions = {
      x: 'thisProperty.value = 99; return 1;',
      y: 'thisLayer.id = "Other"; return 1;',
    };
    expect(resolveExpressionTransforms([target], {}, diagnostics).get('Title')).toMatchObject({
      x: 10,
      y: 20,
    });
    expect(diagnostics).toHaveLength(2);
  });
  it('reads layer identity without evaluating its transform properties', () => {
    const broken = layer('Broken', { x: 'missing()' });
    const target = layer('Target', {
      x: 'layer("Broken").id === "Broken" && layerById("Broken").name === "Broken" ? value + 5 : 0',
    });
    const diagnostics: ExpressionDiagnostic[] = [];
    expect(resolveExpressionTransforms([target, broken], {}, diagnostics).get('Target')!.x).toBe(
      15,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.layerId).toBe('Broken');
  });
  it('exposes the runtime identity for scoped collection references', () => {
    const a = { ...layer('rows::0::a'), name: 'A', prototypeLayerId: 'a', referenceScope: 'rows0' };
    const b = {
      ...layer('rows::0::b', {
        x: 'layer("A").id === "rows::0::a" && layerById("a").id === layer("A").id ? value : 0',
      }),
      name: 'B',
      prototypeLayerId: 'b',
      referenceScope: 'rows0',
    };
    expect(resolveExpressionTransforms([a, b], {}).get(b.id)!.x).toBe(10);
  });

  it('supports spread, Object.keys and JSON serialization for supplied API values', () => {
    const target = layer('Target', {
      x: '({...data}).padding + Object.keys(data).length',
      y: 'JSON.parse(JSON.stringify(thisLayer)).y',
      width: 'Object.values(comp).reduce((sum, value) => sum + value, 0)',
      height: 'Object.keys(timeline).length',
    });
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms(
      [target],
      {
        'data.padding': 15,
        'comp.width': 1920,
        'comp.height': 1080,
        'timeline.startFrame': 0,
      },
      diagnostics,
    );
    expect(result.get('Target')).toMatchObject({ x: 16, y: 20, width: 3000, height: 1 });
    expect(diagnostics).toEqual([]);
  });

  it('copies computed layer values through explicit name and ID references', () => {
    const source = layer('Source', { width: '200' });
    const target = layer('Target', {
      x: '({...layer("Source")}).width',
      y: '({...layerById("Source")}).width',
      width: 'JSON.parse(JSON.stringify(layer("Source"))).width',
    });
    // Enumerating keys must not create a dependency on Broken.x.
    const broken = layer('Broken', { x: 'layer("Missing").x' });
    target.expressions!.height = 'Object.keys(layer("Broken")).length';
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([target, source, broken], {}, diagnostics);
    expect(result.get('Target')).toMatchObject({ x: 200, y: 200, width: 200, height: 9 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.layerId).toBe('Broken');
  });

  it('treats indentation-only drafts as empty expressions', () => {
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([layer('Draft', { x: '  \n  ' })], {}, diagnostics);
    expect(result.get('Draft')!.x).toBe(10);
    expect(diagnostics).toEqual([]);
  });

  it('retains v1 behavior for legacy expressions and rejects future versions before execution', () => {
    const legacy = layer('legacy', { x: 'Math.max(x, 42)' });
    const future = layer('future', { x: 'throw new Error("executed")' });
    const diagnostics: ExpressionDiagnostic[] = [];
    expect(resolveExpressionTransforms([legacy], {}).get('legacy')!.x).toBe(42);
    const result = resolveExpressionTransforms([future], {}, diagnostics, 3);
    expect(result.get('future')!.x).toBe(10);
    expect(diagnostics[0]!.message).toBe('Unsupported expression API version: 3');
  });

  it('keeps ID references stable after renaming and resolves collection prototypes locally', () => {
    const target = { ...layer('stable-id', { width: '200' }), name: 'Renamed' };
    const follower = layer('follower', { x: 'layerById("stable-id").width' });
    const items = [0, 1].flatMap((index) => [
      {
        ...layer('box-' + index, { width: String(300 + index) }),
        prototypeLayerId: 'box',
        referenceScope: 'item-' + index,
      },
      {
        ...layer('text-' + index, { x: 'layerById("box").width' }),
        prototypeLayerId: 'text',
        referenceScope: 'item-' + index,
      },
    ]);
    const diagnostics: ExpressionDiagnostic[] = [];
    const outside = layer('outside', { x: 'layerById("box").width' });
    const result = resolveExpressionTransforms(
      [follower, target, ...items, outside],
      {},
      diagnostics,
    );
    expect(result.get('follower')!.x).toBe(200);
    expect(result.get('text-0')!.x).toBe(300);
    expect(result.get('text-1')!.x).toBe(301);
    expect(diagnostics[0]!.message).toBe('Unknown layer ID: box');
    target.expressions = { width: 'layerById("follower").x' };
    const cycles: ExpressionDiagnostic[] = [];
    expect(resolveExpressionTransforms([target, follower], {}, cycles).get('follower')!.x).toBe(10);
    expect(cycles.every((entry) => entry.message.includes('Circular'))).toBe(true);
  });

  it('reports failed properties and their dependents, and clears errors after repair or disabling', () => {
    const a = layer('A', { x: 'layer("Missing").x', y: '42' });
    const b = layer('B', { x: 'layer("A").x + 1' });
    const diagnostics: ExpressionDiagnostic[] = [];
    expect(resolveExpressionTransforms([b, a], {}, diagnostics).get('A')).toMatchObject({
      x: 10,
      y: 42,
    });
    expect(diagnostics.map((entry) => [entry.layerId, entry.property, entry.message])).toEqual([
      ['B', 'x', 'Unknown layer: Missing'],
      ['A', 'x', 'Unknown layer: Missing'],
    ]);
    a.expressionsEnabled = { x: false };
    const repaired: ExpressionDiagnostic[] = [];
    expect(resolveExpressionTransforms([b, a], {}, repaired).get('B')!.x).toBe(11);
    expect(repaired).toEqual([]);
  });

  it('resolves item siblings first and global layers second without leaking across instances', () => {
    const global = layer('Global', { width: '500' });
    const rows = [0, 1].flatMap((index) => [
      {
        ...layer('box' + index, { width: String(100 + index) }),
        name: 'Box',
        referenceScope: 'row' + index,
      },
      {
        ...layer('text' + index, { x: 'layer("Box").width', y: 'layer("Global").width' }),
        referenceScope: 'row' + index,
      },
    ]);
    const outside = layer('Outside', { x: 'layer("Box").width' });
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms(
      [outside, ...rows.reverse(), global],
      {},
      diagnostics,
    );
    expect(result.get('text0')).toMatchObject({ x: 100, y: 500 });
    expect(result.get('text1')).toMatchObject({ x: 101, y: 500 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.layerId).toBe('Outside');
  });

  it('does not hide ambiguous item names by falling through to a global layer', () => {
    const global = layer('Box', { width: '999' });
    const local = [layer('A'), layer('B')].map((entry) => ({
      ...entry,
      name: 'Box',
      referenceScope: 'row',
    }));
    const text = { ...layer('Text', { x: 'layer("Box").width' }), referenceScope: 'row' };
    const diagnostics: ExpressionDiagnostic[] = [];
    expect(
      resolveExpressionTransforms([global, ...local, text], {}, diagnostics).get('Text')!.x,
    ).toBe(10);
    expect(diagnostics).toEqual([
      expect.objectContaining({ layerId: 'Text', message: 'Ambiguous layer name: Box' }),
    ]);
  });

  it('resolves computed references independently of layer and property order', () => {
    const a = layer('A', { x: 'layer("B").width + 1', width: '200', y: 'thisLayer.width' });
    const b = layer('B', { width: 'layer("A").width + 50' });
    for (const layers of [
      [a, b],
      [b, a],
    ]) {
      const result = resolveExpressionTransforms(layers, {});
      expect(result.get('A')).toMatchObject({ x: 251, width: 200, y: 100 });
      expect(result.get('B')!.width).toBe(250);
      expect(a.transform.width).toBe(100);
    }
    a.expressionsEnabled = { width: false };
    expect(resolveExpressionTransforms([a, b], {}).get('A')).toMatchObject({ x: 151, width: 100 });
  });

  it('does not confuse layers named data or comp with expression variables', () => {
    const data = layer('data', { x: '30' });
    const comp = layer('comp', { width: '40' });
    const text = layer('Text', {
      x: 'data.x + layer("data").x',
      width: 'comp.width + layer("comp").width',
    });
    const result = resolveExpressionTransforms([data, comp, text], {
      'data.x': 5,
      'comp.width': 1920,
    });
    expect(result.get('Text')).toMatchObject({ x: 35, width: 1960 });
  });

  it('keeps native globals and API namespaces independent of layer names', () => {
    const globals = ['Math', 'console', 'Number', 'data', 'timeline'].map((name) =>
      layer(name, { width: '75' }),
    );
    const target = layer('Target', {
      x: 'Math.max(2, 8) + Number("2") + layer("Math").width',
      y: 'typeof console.log === "function" ? 50 : 0',
      width: 'data.width',
    });
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([...globals, target], {}, diagnostics);
    expect(result.get('Target')).toMatchObject({ x: 85, y: 50, width: 100 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.property).toBe('width');
  });

  it('reports a readable dependency path for circular references', () => {
    const a = layer('A', { x: 'layer("B").width' });
    const b = layer('B', { width: 'layer("A").x' });
    const diagnostics: ExpressionDiagnostic[] = [];
    resolveExpressionTransforms([a, b], {}, diagnostics);
    expect(diagnostics[0]!.message).toBe('Circular expression dependency: A.x -> B.width -> A.x');
  });

  it('rejects every reference to duplicate names, including three duplicates', () => {
    const duplicates = [layer('A'), layer('B'), layer('C')].map((l) => ({
      ...l,
      name: 'Duplicate',
    }));
    const text = layer('Text', { x: 'layer("Duplicate").x + 100', y: '99' });
    for (const layers of [[...duplicates, text], [text, ...duplicates].reverse()]) {
      expect(resolveExpressionTransforms(layers, {}).get('Text')).toMatchObject({ x: 10, y: 99 });
    }
  });

  it('retains base values for invalid/circular dependencies and still evaluates other properties', () => {
    const a = layer('A', { x: 'layer("B").x', y: '35' });
    const b = layer('B', { x: 'layer("A").x', width: '1 / 0' });
    const c = layer('C', { x: 'layer("B").width', y: 'layer("Missing").y' });
    for (const layers of [
      [a, b, c],
      [c, b, a],
    ]) {
      const result = resolveExpressionTransforms(layers, {});
      expect(result.get('A')).toMatchObject({ x: 10, y: 35 });
      expect(result.get('B')).toMatchObject({ x: 10, width: 100 });
      expect(result.get('C')).toMatchObject({ x: 10, y: 20 });
    }
  });
});
