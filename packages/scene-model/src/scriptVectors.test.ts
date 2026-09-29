import { describe, expect, it } from 'vitest';
import { createDefaultTransform } from './factory';
import {
  resolveExpressionTransforms,
  type ExpressionDiagnostic,
  type ExpressionLayerState,
} from './expressionTransforms';
import { scriptLayerReference } from './scriptLayerProperties';
import { scriptModuleName } from './scriptModules';

function layer(): ExpressionLayerState {
  return {
    id: 'title',
    name: 'Title',
    transform: createDefaultTransform({
      x: 10,
      y: 20,
      width: 200,
      height: 80,
      transformOriginX: 0.5,
      transformOriginY: 0.25,
    }),
  };
}
function run(layers: ExpressionLayerState[], source = '') {
  const diagnostics: ExpressionDiagnostic[] = [];
  const result = resolveExpressionTransforms(layers, { time: 2, frame: 50 }, diagnostics, 1, {
    enabled: true,
    source,
    modules: [],
  });
  return { result, diagnostics };
}

describe('vector scripting aliases', () => {
  it('reads sampled current-layer aliases and computed references, resolving only the accessed axis', () => {
    const title = layer();
    title.expressions = {
      x: 'position[0] + thisLayer.transformOrigin[0]',
      y: 'size[1] + transformOrigin[1]',
      width: "layer('Title').position[0] * 2",
      height: 'size[1]',
    };
    const follower: ExpressionLayerState = {
      ...layer(),
      id: 'follower',
      name: 'Follower',
      expressions: { x: "layer('Title').size[0] + layerById('title').transformOrigin[0]" },
    };
    const { result, diagnostics } = run([follower, title]);
    expect(diagnostics).toEqual([]);
    expect(result.get('title')).toMatchObject({ x: 10.5, y: 80.25, width: 21, height: 80 });
    expect(result.get('follower')?.x).toBe(21.5);
    // Accessing position[0] must not resolve y (and create a spurious cycle).
    title.expressions = { x: '2', y: "layer('Title').position[0] + 1" };
    expect(run([title]).diagnostics).toEqual([]);
  });

  it('writes indices and whole vectors after expressions, keeping scalar fields live', () => {
    const title = layer(),
      before = structuredClone(title);
    title.expressions = { x: '30' };
    const { result, diagnostics } = run(
      [title],
      `
      const title = layer('Title');
      const position = title.position;
      title.position[0] += 5;
      title.y = 40;
      if (position[0] !== 35 || position[1] !== 40) throw Error('stale position');
      title.position = [position[1], position[0]];
      title.size = [400, 200];
      title.transformOrigin = [0.5, 0.75];
      title.transformOrigin[0] = 1;
      title.size[1] = 100;
      if (title.transformOrigin[1] !== 0.75) throw Error('stale origin');
      if (!title.properties().includes('transformOrigin')) throw Error('missing reference');
    `,
    );
    expect(diagnostics).toEqual([]);
    expect(result.get('title')).toEqual({
      ...before.transform,
      x: 40,
      y: 35,
      width: 400,
      height: 100,
      transformOriginX: 1,
      transformOriginY: 0.75,
    });
    expect(title.transform).toEqual(before.transform);
    expect(run([title]).result.get('title')).toEqual({ ...before.transform, x: 30 });
    expect(Object.keys(result.get('title')!)).not.toEqual(
      expect.arrayContaining(['position', 'size', 'transformOrigin']),
    );
  });

  it.each([
    "layer('Title').position[0] = 50; return 1;",
    'thisLayer.size[0] = 50; return 1;',
    'transformOrigin[1] = 0; return 1;',
    "layer('Title').transformOrigin = [0, 0]; return 1;",
  ])('keeps property expressions read-only: %s', (source) => {
    const title = layer();
    title.expressions = { x: source };
    const { result, diagnostics } = run([title]);
    expect(diagnostics).toHaveLength(1);
    expect(result.get('title')).toEqual(title.transform);
  });

  it.each([
    'title.position = [1, NaN]',
    'title.size[0] = Infinity',
    'title.transformOrigin = [0, "1"]',
    'title.position = [1]',
    'title.position = [1, 2, 3]',
    'title.position[2] = 3',
    'title.size.length = 1',
    'title.width = 0; title.transformOrigin[0] = 10',
  ])('rolls back all script writes on invalid vectors: %s', (source) => {
    const title = layer();
    const { result, diagnostics } = run(
      [title],
      `const title = layer('Title'); title.y = 900; ${source};`,
    );
    expect(diagnostics).toHaveLength(1);
    expect(result.get('title')).toEqual(title.transform);
  });

  it('validates whole assignments before changing either component, even when caught', () => {
    const title = layer();
    const { result, diagnostics } = run(
      [title],
      `try { layer('Title').position = [100, NaN]; } catch {}`,
    );
    expect(diagnostics).toEqual([]);
    expect(result.get('title')).toEqual(title.transform);
  });

  it('blocks retained vector writes after the script transaction expires', () => {
    const title = layer();
    let active = true;
    const entry = scriptLayerReference(
      title.transform,
      undefined,
      { id: title.id, name: 'Title' },
      () => {
        if (!active) throw Error('expired');
      },
      {},
    );
    const reference = entry.reference as {
      position: number[];
      transformOrigin: number[];
      size: number[];
    };
    const retained = reference.position;
    retained[0] = 15;
    active = false;
    for (const vector of [retained, reference.transformOrigin, reference.size])
      expect(() => {
        vector[0] = 0.9;
      }).toThrow('expired');
    expect(title.transform.x).toBe(15);
  });

  it('samples normalized transform origins at the requested time', () => {
    const title = layer();
    title.sampleTransform = (seconds) =>
      createDefaultTransform({
        x: seconds * 10,
        width: seconds * 100,
        height: seconds * 40,
        transformOriginX: 0.25,
        transformOriginY: 0.5,
      });
    title.expressions = {
      x: 'thisLayer.property("transformOrigin").valueAtTime(1)[0]',
      y: 'thisLayer.property("position").valueAtTime(1)[0]',
      width: 'thisLayer.property("size").valueAtTime(1)[0]',
    };
    const { result, diagnostics } = run(
      [title],
      `
      const title = layer('Title');
      title.position[1] = title.property('transformOrigin').valueAtTime(1)[1];
      if (title.property('transformOrigin').value[0] !== 0.5) throw Error('current origin');
    `,
    );
    expect(diagnostics).toEqual([]);
    expect(result.get('title')).toMatchObject({ x: 0.25, y: 0.5, width: 100 });
  });

  it.each(['position', 'size', 'transformOrigin'])(
    'reserves the %s shorthand from module names',
    (name) => {
      expect(() => scriptModuleName(name + '.js')).toThrow();
    },
  );
});
