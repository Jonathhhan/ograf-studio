import { describe, it, expect } from 'vitest';
import {
  createDefaultTransform,
  createLayerOfKind,
  createLayerKeyframe,
  createComposition,
  createProject,
} from '../src/factory';
import {
  resolveWorldTransforms,
  localTransformMatrix,
  worldTransformMatrix,
  multiplyMatrices,
  matrixPoint,
  inverseMatrix,
  poseFromMatrix,
} from '../src/transformHierarchy';
import { clipPathSvgForParentBounds } from '../src/clipping';
import { resolveExpressionTransforms } from '../src/expressionTransforms';
import { renderCompositionFrameSvg } from '../../authoring-core/src/renderFrame';
import { compileDescriptor } from '../../codegen/src/compileDescriptor';
import { sampleCompiledLayerVisualState } from '../../ograf-runtime/src/loopRendering';
import { applyCompiledMasks } from '../../ograf-runtime/src/maskRendering';
import { validateProject } from '../../validation/src/validateProject';

const pose = (patch = {}) =>
  createDefaultTransform({
    x: 0,
    y: 0,
    width: 60,
    height: 60,
    transformOriginX: 0,
    transformOriginY: 0,
    ...patch,
  });
describe('explicit transform hierarchy', () => {
  it('keeps affine shear, reflection and child opacity without mutating input', () => {
    const parent = pose({ x: 50, y: 10, scaleX: 2, scaleY: -1, opacity: 0 }),
      child = pose({ x: 10, rotation: 45, opacity: 0.7 }),
      poses = new Map([
        ['p', parent],
        ['c', child],
      ]);
    const world = resolveWorldTransforms(
      [{ id: 'c', transformParentId: 'p' }, { id: 'p' }],
      poses,
    ).get('c')!;
    expect(worldTransformMatrix(world)).toEqual(
      multiplyMatrices(localTransformMatrix(parent), localTransformMatrix(child)),
    );
    expect(world.opacity).toBe(0.7);
    expect(child).not.toHaveProperty('worldMatrix');
    const m = worldTransformMatrix(world);
    expect(m[0] * m[2] + m[1] * m[3]).not.toBeCloseTo(0);
    localTransformMatrix(poseFromMatrix(m, child)).forEach((v, i) => expect(v).toBeCloseTo(m[i]!));
  });
  it('rejects cycles, missing references and duplicates deterministically', () => {
    const poses = new Map([
      ['a', pose()],
      ['b', pose()],
    ]);
    expect(() =>
      resolveWorldTransforms(
        [
          { id: 'a', transformParentId: 'b' },
          { id: 'b', transformParentId: 'a' },
        ],
        poses,
      ),
    ).toThrow('cycle');
    expect(() => resolveWorldTransforms([{ id: 'a', transformParentId: 'x' }], poses)).toThrow(
      'Missing',
    );
    expect(() => resolveWorldTransforms([{ id: 'a' }, { id: 'a' }], poses)).toThrow('Duplicate');
  });
  it('keeps zero-scale rendering finite and refuses undefined inverse edits', () => {
    const p = pose({ scaleX: 0 });
    expect(localTransformMatrix(p).every(Number.isFinite)).toBe(true);
    expect(() => inverseMatrix(localTransformMatrix(p))).toThrow('singular');
    expect(clipPathSvgForParentBounds(p, pose(), 30)).toBe('M 0 0 Z');
  });
  it('preserves circular geometry as an ellipse and flips sweep under reflection', () => {
    const path = clipPathSvgForParentBounds(pose(), pose({ scaleX: -2 }), 30);
    expect(path).toContain('A 60 30 0 0 0');
    expect(path).not.toContain('Q');
  });
  it('converts coordinates using sampled parent expressions and sequential Comp writes', () => {
    const layers = [
      {
        id: 'p',
        name: 'P',
        transform: pose(),
        expressions: { x: 'time*10' },
        sampleTransform: () => pose(),
      },
      {
        id: 'c',
        name: 'C',
        transformParentId: 'p',
        transform: pose({ x: 5 }),
        sampleTransform: () => pose({ x: 5 }),
      },
      {
        id: 'f',
        name: 'F',
        transform: pose(),
        expressions: { x: 'layer("C").toWorld([0,0],2)[0]' },
      },
    ];
    const errors: any[] = [];
    const result = resolveExpressionTransforms(layers, { time: 1 }, errors, 1, {
      enabled: true,
      modules: [],
      source: 'layer("P").x=100;layer("F").y=layer("C").toWorld([0,0])[0];',
    });
    expect(errors).toEqual([]);
    expect(result.get('f')).toMatchObject({ x: 25, y: 105 });
  });
  it('uses identical SVG and playout matrices for a hidden animated parent and arbitrary seeks', () => {
    const p = createLayerOfKind('rectangle'),
      c = createLayerOfKind('rectangle');
    p.isVisible = false;
    c.transformParentId = p.id;
    p.keyframes = [
      createLayerKeyframe(0, pose({ x: 50, scaleX: 2, scaleY: 1 })),
      createLayerKeyframe(20, pose({ x: 150, scaleX: 3, scaleY: 1 })),
    ];
    p.animationTracks = {};
    c.keyframes = [createLayerKeyframe(0, pose({ x: 10, rotation: 45, opacity: 0.7 }))];
    c.animationTracks = {};
    const comp = createComposition({ layers: [c, p] }),
      project = createProject({ mainCompositionId: comp.id, compositions: [comp] });
    expect(validateProject(project).errors).toEqual([]);
    const desc = compileDescriptor(comp);
    const render = (frame: number) => {
      const states = new Map(
        desc.layers.map((l) => [l.id, sampleCompiledLayerVisualState(l, frame)]),
      );
      const elements = new Map(
        desc.layers.map((l) => [
          l.id,
          { style: {}, dataset: {}, firstElementChild: null } as unknown as HTMLElement,
        ]),
      );
      applyCompiledMasks(desc, elements, states);
      const css = elements.get(c.id)!.style.transform;
      const svg = renderCompositionFrameSvg(project, comp.id, frame).svg;
      expect(svg).toContain('matrix(' + css.slice(7, -1).split(',').join(' ') + ')');
      return css;
    };
    const first = render(7);
    render(20);
    render(0);
    expect(render(7)).toBe(first);
  });
});
