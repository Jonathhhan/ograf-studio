import { describe, expect, it, vi } from 'vitest';
import { createDefaultTransform, createProject, createLayerOfKind } from './factory';
import {
  resolveExpressionTransforms,
  type ExpressionLayerState,
  type ExpressionDiagnostic,
} from './expressionTransforms';
import { hasActiveTransformExpression } from './expressionFields';
import { EXPRESSION_FIELDS } from './expressions';
import { migrateProject } from './migrations';
import { scriptingErrors } from './scriptingValidation';

function fixture(): ExpressionLayerState {
  return {
    id: 'title',
    name: 'Title',
    transform: createDefaultTransform({ x: 10, y: 20, width: 200, height: 100 }),
  };
}
function run(layers: ExpressionLayerState[], source = '') {
  const diagnostics: ExpressionDiagnostic[] = [];
  const values = resolveExpressionTransforms(layers, { time: 1, frame: 25 }, diagnostics, 1, {
    enabled: true,
    source,
    modules: [],
  });
  return { values, diagnostics };
}

describe('vector expression fields', () => {
  it('evaluates a vector once per frame even when both components are consumed', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const title = fixture();
      title.expressions = { position: '[Math.random(), Math.random()]' };
      expect(run([title]).diagnostics).toEqual([]);
      expect(random).toHaveBeenCalledTimes(2);
      run([title]);
      expect(random).toHaveBeenCalledTimes(4);
    } finally {
      random.mockRestore();
    }
  });
  it('exposes five fields and resolves array results to scalar geometry', () => {
    expect(EXPRESSION_FIELDS).toEqual([
      'text',
      'position',
      'size',
      'transformOrigin',
      'rotation',
      'opacity',
    ]);
    const title = fixture();
    title.expressions = {
      position: '[value[0] + 5, value[1] + 10]',
      size: '[400, 200]',
      transformOrigin: '[0.5, 0.25]',
      rotation: '45',
      opacity: '0.8',
    };
    const before = structuredClone(title);
    const follower = {
      ...fixture(),
      id: 'follower',
      name: 'Follower',
      expressions: {
        position:
          "[layer('Title').position[0] + layer('Title').size[0], layerById('title').transformOrigin[1]]",
      },
    };
    const { values, diagnostics } = run([follower, title]);
    expect(diagnostics).toEqual([]);
    expect(values.get(title.id)).toEqual({
      x: 15,
      y: 30,
      width: 400,
      height: 200,
      rotation: 45,
      opacity: 0.8,
      transformOriginX: 0.5,
      transformOriginY: 0.25,
    });
    expect(values.get('follower')).toMatchObject({ x: 415, y: 0.25 });
    expect(title).toEqual(before);
  });

  it('provides vector metadata and samples the authored pair at the requested time', () => {
    const title = fixture();
    title.sampleTransform = (seconds) =>
      createDefaultTransform({
        x: seconds * 10,
        y: seconds * 20,
        width: seconds * 100,
        height: seconds * 50,
      });
    title.expressions = {
      position:
        "if (thisProperty.name !== 'position') throw Error('wrong name'); const p = [...thisProperty.valueAtTime(0.5)]; p[0] += value[0]; return p;",
      size: 'valueAtTime(2)',
      transformOrigin: 'thisProperty.value',
    };
    const { values, diagnostics } = run([title]);
    expect(diagnostics).toEqual([]);
    expect(values.get(title.id)).toMatchObject({
      x: 15,
      y: 10,
      width: 200,
      height: 100,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    });
  });

  it('runs composition assignments after vector expressions', () => {
    const title = fixture();
    title.expressions = {
      position: '[100, 200]',
      size: '[400, 200]',
      transformOrigin: '[0.5, 0.5]',
    };
    const { values, diagnostics } = run(
      [title],
      "const title = layer('Title'); title.position[0] += 20; title.y += 10; title.transformOrigin[0] = 0.25;",
    );
    expect(diagnostics).toEqual([]);
    expect(values.get(title.id)).toMatchObject({ x: 120, y: 210, transformOriginX: 0.25 });
  });

  it.each([
    '100',
    '[1]',
    '[1, 2, 3]',
    '[1, NaN]',
    '[Infinity, 2]',
    '[1, "2"]',
    '{x: 1, y: 2}',
    '[1, ,]',
  ])('rejects invalid pairs atomically: %s', (source) => {
    const title = fixture();
    title.expressions = { position: source, rotation: '90' };
    const { values, diagnostics } = run([title]);
    expect(values.get(title.id)).toMatchObject({ x: 10, y: 20, rotation: 90 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ property: 'position', source });
    expect(diagnostics[0]?.message).toContain('two finite numbers');
  });

  it('reports a vector dependency cycle and preserves the whole sampled pair', () => {
    const title = fixture();
    title.expressions = { position: "[layer('Title').position[1], 99]", size: '[80, 90]' };
    const { values, diagnostics } = run([title]);
    expect(values.get(title.id)).toMatchObject({ x: 10, y: 20, width: 80, height: 90 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('Title.position -> Title.position');
  });

  it('accepts normalized transform origins even when a size axis is zero', () => {
    const title = fixture();
    title.expressions = { size: '[100, 0]', transformOrigin: '[0.1, 0.2]' };
    const { values, diagnostics } = run([title]);
    expect(values.get(title.id)).toMatchObject({
      width: 100,
      height: 0,
      transformOriginX: 0.1,
      transformOriginY: 0.2,
    });
    expect(diagnostics).toEqual([]);
  });

  it('rejects transform origins outside the normalized range', () => {
    const title = fixture();
    title.expressions = { transformOrigin: '[10, 20]' };
    const { values, diagnostics } = run([title]);
    expect(values.get(title.id)).toMatchObject({ transformOriginX: 0.5, transformOriginY: 0.5 });
    expect(diagnostics[0]?.message).toContain('between 0 and 1');
  });

  it('gives vector fields precedence over legacy components, including when disabled', () => {
    const title = fixture();
    title.expressions = { x: '999', position: '[100, 200]' };
    title.expressionsEnabled = { position: false };
    expect(run([title]).values.get(title.id)).toMatchObject({ x: 10, y: 20 });
    expect(hasActiveTransformExpression(title, 'x')).toBe(false);
    title.expressionsEnabled.position = true;
    expect(run([title]).values.get(title.id)).toMatchObject({ x: 100, y: 200 });
    expect(hasActiveTransformExpression(title, 'x')).toBe(true);
    title.expressions = { x: '999' };
    expect(run([title]).values.get(title.id)?.x).toBe(999);
  });

  it('validates and round-trips vector sources without converting scalar geometry', () => {
    const project = createProject();
    const layer = createLayerOfKind('rectangle');
    layer.expressions = { position: '[10,20]', size: '[100,200]', transformOrigin: '[0.5,1]' };
    project.compositions[0]!.layers = [layer];
    expect(scriptingErrors(project.compositions[0])).toEqual([]);
    const loaded = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(loaded.compositions[0]!.layers[0]!.expressions).toEqual(layer.expressions);
    expect(loaded.compositions[0]!.layers[0]!.keyframes[0]!.transform).toHaveProperty('x');
    expect(loaded.compositions[0]!.layers[0]!.keyframes[0]!.transform).not.toHaveProperty(
      'position',
    );
  });
});
