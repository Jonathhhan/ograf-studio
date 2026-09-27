import gsap from 'gsap';
import { describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import { createCornerRadii, createTextElement, createShaderPaint } from '@ograf-editor/scene-model';
import { buildRuntimeTimeline } from './buildRuntimeTimeline';
import * as shaderAnimationRendering from './shaderAnimationRendering';
import { applyCompiledMasks } from './maskRendering';
import { sampleCompiledLayerVisualState } from './loopRendering';
import { resolveFrameExpressions } from './expressionRendering';
import * as effectCompositing from './effectCompositing';
import * as elementRendering from './renderElement';

function descriptor(): CompiledGraphicDescriptor {
  const transform = {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 0,
    transformOriginX: 0.5,
    transformOriginY: 0.5,
  };
  const track = (property: keyof typeof transform) => [
    { id: `${property}-0`, frame: 0, value: transform[property], easing: 'linear' as const },
    {
      id: `${property}-10`,
      frame: 10,
      value: property === 'opacity' ? 1 : transform[property],
      easing: 'linear' as const,
    },
  ];
  return {
    width: 1920,
    height: 1080,
    backgroundColor: 'transparent',
    frameRate: 25,
    layers: [
      {
        id: 'layer',
        isVisible: true,
        element: {
          type: 'rectangle',
          fill: '#fff',
          strokeColor: 'transparent',
          strokeWidth: 0,
          borderRadius: createCornerRadii(),
        },
        effects: {
          blur: 0,
          dropShadowEnabled: false,
          dropShadowColor: '#000000',
          dropShadowOpacity: 0,
          dropShadowOffsetX: 0,
          dropShadowOffsetY: 0,
          dropShadowBlur: 0,
        },
        keyframes: [
          { id: 'start', frame: 0, transform, easing: 'linear' },
          { id: 'end', frame: 10, transform: { ...transform, opacity: 1 }, easing: 'linear' },
        ],
        animationTracks: {
          x: track('x'),
          y: track('y'),
          width: track('width'),
          height: track('height'),
          rotation: track('rotation'),
          opacity: track('opacity'),
          transformOriginX: track('transformOriginX'),
          transformOriginY: track('transformOriginY'),
        },
        bindings: [],
      },
    ],
    keyframes: [
      { id: 'start', frame: 0, role: 'start' },
      { id: 'end', frame: 10, role: 'end' },
    ],
    transitions: [
      {
        fromKeyframeId: 'start',
        toKeyframeId: 'end',
        durationFrames: 10,
        easing: 'linear',
      },
    ],
    stepKeyframeIds: [],
    stepCount: 0,
    startKeyframeId: 'start',
    endKeyframeId: 'end',
    customActions: [],
  };
}

describe('runtime timeline boundary seeking', () => {
  it('publishes runtime diagnostics on data changes and clears disabled expressions', () => {
    const compiled = descriptor();
    compiled.layers[0]!.expressions = { x: 'data.position' };
    const element = { style: {} } as HTMLElement;
    let data: Record<string, unknown> = {};
    const diagnostics = vi.fn();
    const timeline = buildRuntimeTimeline(
      compiled,
      new Map([['layer', element]]),
      () => data,
      diagnostics,
    );
    expect(diagnostics.mock.calls.at(-1)![0]).toEqual([
      expect.objectContaining({ layerId: 'layer', property: 'x', source: 'data.position' }),
    ]);
    data = { position: 123 };
    timeline.seek(0.2, true);
    expect(diagnostics.mock.calls.at(-1)![0]).toEqual([]);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(123);
    data = { position: 'invalid' };
    timeline.seek(0, true);
    expect(diagnostics.mock.calls.at(-1)![0]).toHaveLength(1);
    compiled.layers[0]!.expressionsEnabled = { x: false };
    timeline.seek(0.2, true);
    expect(diagnostics.mock.calls.at(-1)![0]).toEqual([]);
    timeline.kill();
  });

  it('clips against expression-resolved parent and child geometry in every render pass', () => {
    const compiled = descriptor();
    const parent = compiled.layers[0]!;
    parent.expressions = { width: '400' };
    const child = structuredClone(parent);
    child.id = 'child';
    child.clipParentId = parent.id;
    child.expressions = { x: '50' };
    compiled.layers.push(child);
    const elements = new Map(
      compiled.layers.map((layer) => [layer.id, { style: {} } as HTMLElement]),
    );
    const target = elements.get(child.id)!;
    const clip = 'path("M -50 0 L 350 0 L 350 50 L -50 50 Z")';
    applyCompiledMasks(
      compiled,
      elements,
      new Map(compiled.layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, 0)])),
    );
    expect(target.style.clipPath).toBe(clip);
    const timeline = buildRuntimeTimeline(compiled, elements);
    for (const frame of [5, 10, 0, 5]) {
      timeline.seek(frame / compiled.frameRate, true);
      expect(target.style.clipPath).toBe(clip);
    }
    parent.expressionsEnabled = { width: false };
    timeline.seek(0, true);
    expect(target.style.clipPath).toBe('path("M -50 0 L 50 0 L 50 50 L -50 50 Z")');
    timeline.kill();
  });

  it('does not repaint animated effects or shader parameters when applying expressions', () => {
    const compiled = descriptor();
    compiled.layers[0]!.expressions = { x: 'frame + 10' };
    const element = { style: {} } as HTMLElement;
    const effects = vi.spyOn(effectCompositing, 'applyLayerEffectsFilter');
    const paint = vi.spyOn(elementRendering, 'applyAnimatedPaint');
    try {
      applyCompiledMasks(
        compiled,
        new Map([['layer', element]]),
        new Map([['layer', sampleCompiledLayerVisualState(compiled.layers[0]!, 5)]]),
      );
      expect(Number(gsap.getProperty(element, 'x'))).toBe(15);
      expect(effects).not.toHaveBeenCalled();
      expect(paint).not.toHaveBeenCalled();
    } finally {
      effects.mockRestore();
      paint.mockRestore();
    }
  });

  it.each([
    [10, 10, 20],
    [20, 20, 29],
    [10, 90, 100],
  ])('follows authored Step boundaries %s/%s/%s on seek and playback', (first, last, end) => {
    const compiled = descriptor();
    compiled.keyframes = [
      { id: 'start', frame: 0, role: 'start' },
      { id: 'first', frame: first, role: 'step' },
      ...(last !== first ? [{ id: 'last', frame: last, role: 'step' as const }] : []),
      { id: 'end', frame: end, role: 'end' },
    ];
    compiled.layers[0]!.expressions = {
      x: `if (frame < timeline.firstStepFrame)
        return 100 * clamp(frame / timeline.firstStepFrame, 0, 1);
        return 100 * (1 - clamp((frame - timeline.lastStepFrame) /
          (timeline.endFrame - timeline.lastStepFrame), 0, 1));`,
    };
    const element = { style: {} } as HTMLElement;
    const timeline = buildRuntimeTimeline(compiled, new Map([['layer', element]]));
    const samples = [
      [0, 0],
      [first / 4, 25],
      [first, 100],
      [(first + last) / 2, 100],
      [last, 100],
      [(last + end) / 2, 50],
      [end, 0],
      [first / 4, 25],
    ];
    for (const [frame, expected] of samples) {
      timeline.seek(frame! / compiled.frameRate, true);
      expect(Number(gsap.getProperty(element, 'x'))).toBeCloseTo(expected!);
    }
    timeline.time((last + (end - last) / 4) / compiled.frameRate, false);
    expect(Number(gsap.getProperty(element, 'x'))).toBeCloseTo(75);
    timeline.kill();
  });

  it('evaluates numeric data fields in position expressions on seek and playback', () => {
    const compiled = descriptor();
    compiled.keyframes.at(-1)!.frame = 100;
    const layer = compiled.layers[0]!;
    layer.expressions = { x: 'thisLayer.x + data.xPos', y: 'thisLayer.y + data.yPos' };
    const element = { style: {} } as HTMLElement;
    let data = { xPos: 30, yPos: -5 };
    const timeline = buildRuntimeTimeline(compiled, new Map([[layer.id, element]]), () => data);
    timeline.seek(50 / 25, true);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(30);
    expect(Number(gsap.getProperty(element, 'y'))).toBe(-5);
    data = { xPos: 75, yPos: 20 };
    timeline.time(60 / 25, false);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(75);
    expect(Number(gsap.getProperty(element, 'y'))).toBe(20);
    timeline.kill();
  });
  it('combines numeric preview fields with another layer position', () => {
    const compiled = descriptor();
    const rectangle = compiled.layers[0]!;
    rectangle.name = 'Rectangle';
    rectangle.animationTracks.x = rectangle.animationTracks.x!.map((keyframe) => ({
      ...keyframe,
      value: 100,
    }));
    const text = structuredClone(rectangle);
    text.id = 'text';
    text.name = 'Text';
    text.expressions = {
      x: 'layer("Rectangle").x + data.xPos',
      y: 'layer("Rectangle").y + data.yPos',
    };
    compiled.layers = [rectangle, text];
    const states = new Map(
      compiled.layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, 0)]),
    );
    const result = resolveFrameExpressions(compiled, states, undefined, { xPos: 30, yPos: 20 });
    expect(result.get('text')!.transform.x).toBe(130);
    expect(result.get('text')!.transform.y).toBe(20);
  });
  it('updates a numeric expression when a select field changes during playback', () => {
    const compiled = descriptor();
    compiled.keyframes.at(-1)!.frame = 100;
    const layer = compiled.layers[0]!;
    layer.expressions = { x: 'data.Alphabet == "Latin" ? 100 : 200' };
    const element = { style: {} } as HTMLElement;
    let data = { Alphabet: 'Latin' };
    const timeline = buildRuntimeTimeline(compiled, new Map([[layer.id, element]]), () => data);
    timeline.seek(50 / 25, true);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(100);
    data = { Alphabet: 'Arabic' };
    timeline.time(60 / 25, false);
    expect(Number(gsap.getProperty(element, 'x'))).toBe(200);
    timeline.kill();
  });
  it('moves a rectangle and its text together when position data changes', () => {
    const compiled = descriptor();
    compiled.keyframes.at(-1)!.frame = 100;
    const rectangle = compiled.layers[0]!;
    rectangle.name = 'Rectangle';
    rectangle.expressions = {
      x: 'thisLayer.x + data.xPos - 30',
      y: 'thisLayer.y + data.yPos',
    };
    const text = structuredClone(rectangle);
    text.id = 'text';
    text.name = 'Text';
    text.expressions = {
      x: 'layer("Rectangle").x + 30',
      y: 'layer("Rectangle").y',
    };
    compiled.layers = [rectangle, text];
    const rectangleElement = { style: {} } as HTMLElement;
    const textElement = { style: {} } as HTMLElement;
    let data = { xPos: 30, yPos: 0 };
    const timeline = buildRuntimeTimeline(
      compiled,
      new Map([
        [rectangle.id, rectangleElement],
        [text.id, textElement],
      ]),
      () => data,
    );
    timeline.seek(50 / 25, true);
    expect(Number(gsap.getProperty(rectangleElement, 'x'))).toBe(0);
    expect(Number(gsap.getProperty(textElement, 'x'))).toBe(30);
    data = { xPos: 80, yPos: 20 };
    timeline.time(60 / 25, false);
    expect(Number(gsap.getProperty(rectangleElement, 'x'))).toBe(50);
    expect(Number(gsap.getProperty(textElement, 'x'))).toBe(80);
    expect(Number(gsap.getProperty(rectangleElement, 'y'))).toBe(20);
    expect(Number(gsap.getProperty(textElement, 'y'))).toBe(20);
    timeline.kill();
  });
  it('keeps a moving rectangle within title-safe bounds at 0 and 100 percent', () => {
    const compiled = descriptor();
    const rectangle = compiled.layers[0]!;
    rectangle.name = 'Rectangle';
    rectangle.animationTracks.x = [{ ...rectangle.animationTracks.x![0]!, value: 100 }];
    rectangle.animationTracks.y = [{ ...rectangle.animationTracks.y![0]!, value: 100 }];
    rectangle.expressions = {
      width:
        'const text = layer("Text"); const width = text.width + 150; const height = text.height + 60; return clamp(width < height ? height : width, 0, comp.width * 0.9);',
      height: 'clamp(layer("Text").height + 60, 0, comp.height * 0.9)',
      x: `const safeLeft = comp.width * 0.05;
const safeWidth = comp.width * 0.9;
const rectWidth = layer("Rectangle").width;
const travel = clamp(safeWidth - rectWidth, 0, 200);
const room = clamp(safeWidth - rectWidth - travel, 0, safeWidth);
const inFrames = clamp(data.inFrames, 1, 50);
const outFrames = clamp(data.outFrames, 1, 50);
const phase = frame < inFrames
  ? 1 - clamp(frame / inFrames, 0, 1)
  : clamp((frame - (100 - outFrames)) / outFrames, 0, 1);
return safeLeft + room * clamp(data.xPos / 100, 0, 1) + travel * phase;`,
      y: `const safeTop = comp.height * 0.05;
const safeHeight = comp.height * 0.9;
return safeTop + clamp(data.yPos / 100, 0, 1) * clamp(safeHeight - layer("Rectangle").height, 0, safeHeight);`,
    };
    const text = structuredClone(rectangle);
    text.id = 'text';
    text.name = 'Text';
    text.expressions = {
      x: 'layer("Rectangle").x + 100',
      y: 'layer("Rectangle").y + 30',
    };
    compiled.layers = [rectangle, text];
    const pose = (frame: number, xPos: number, yPos: number, inFrames = 10, outFrames = 10) => {
      const states = new Map(
        compiled.layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, frame)]),
      );
      const resolved = resolveFrameExpressions(compiled, states, undefined, {
        xPos,
        yPos,
        inFrames,
        outFrames,
      });
      const rect = resolved.get(rectangle.id)!.transform;
      expect(rect.x).toBeGreaterThanOrEqual(compiled.width * 0.05);
      expect(rect.y).toBeGreaterThanOrEqual(compiled.height * 0.05);
      expect(rect.x + rect.width).toBeLessThanOrEqual(compiled.width * 0.95);
      expect(rect.y + rect.height).toBeLessThanOrEqual(compiled.height * 0.95);
      expect(resolved.get(text.id)!.transform.x).toBe(rect.x + 100);
      expect(resolved.get(text.id)!.transform.y).toBe(rect.y + 30);
      return { rect, states };
    };
    for (const frame of [0, 5, 10, 50, 95, 100]) {
      pose(frame, 0, 0);
      const { rect } = pose(frame, 100, 100);
      expect(rect.y + rect.height).toBe(compiled.height * 0.95);
      if (frame === 0 || frame === 100) expect(rect.x + rect.width).toBe(compiled.width * 0.95);
    }
    expect(pose(0, 0, 0).rect.x).toBeGreaterThan(pose(10, 0, 0).rect.x);
    expect(pose(10, 0, 0).rect.x).toBe(pose(50, 0, 0).rect.x);
    expect(pose(100, 0, 0).rect.x).toBe(pose(0, 0, 0).rect.x);
    expect(pose(10, 0, 0, 20, 30).rect.x).toBeGreaterThan(pose(20, 0, 0, 20, 30).rect.x);
    expect(pose(20, 0, 0, 20, 30).rect.x).toBe(pose(70, 0, 0, 20, 30).rect.x);
    expect(pose(85, 0, 0, 20, 30).rect.x).toBeGreaterThan(pose(70, 0, 0, 20, 30).rect.x);
    expect(pose(100, 0, 0, 20, 30).rect.x).toBe(pose(0, 0, 0, 20, 30).rect.x);
    const states = pose(0, 100, 100).states;
    states.set(text.id, {
      ...states.get(text.id)!,
      transform: {
        ...states.get(text.id)!.transform,
        width: compiled.width,
        height: compiled.height,
      },
    });
    const oversized = resolveFrameExpressions(compiled, states, undefined, {
      xPos: 100,
      yPos: 100,
      inFrames: 10,
      outFrames: 10,
    });
    const rect = oversized.get(rectangle.id)!.transform;
    expect(rect.width).toBe(compiled.width * 0.9);
    expect(rect.height).toBe(compiled.height * 0.9);
    expect(rect.x).toBe(compiled.width * 0.05);
    expect(rect.y).toBe(compiled.height * 0.05);
  });
  it('turns opacity animation off with boolean data while retaining movement', () => {
    const compiled = descriptor();
    const layer = compiled.layers[0]!;
    layer.expressions = {
      x: 'x + 100',
      opacity: 'if (data.fade == 0) return 1; return clamp(frame / 10, 0, 1);',
    };
    const states = new Map([[layer.id, sampleCompiledLayerVisualState(layer, 0)]]);
    const enabled = resolveFrameExpressions(compiled, states, undefined, { fade: true }).get(
      layer.id,
    )!.transform;
    const disabled = resolveFrameExpressions(compiled, states, undefined, { fade: false }).get(
      layer.id,
    )!.transform;
    expect(enabled.opacity).toBe(0);
    expect(disabled.opacity).toBe(1);
    expect(disabled.x).toBe(enabled.x);
  });
  it('fits to measured text and resolves position dependencies regardless of layer order', () => {
    const compiled = descriptor();
    const rectangle = compiled.layers[0]!;
    rectangle.name = 'Rectangle';
    rectangle.expressions = {
      width: 'layer("Text").width + 150',
      height: 'layer("Text").height + 60',
    };
    const text = structuredClone(rectangle);
    text.id = 'text';
    text.name = 'Text';
    text.element = createTextElement({ autoFit: 'auto-size' });
    text.expressions = {
      x: 'layer("Rectangle").x + layer("Rectangle").width + 100',
      y: 'layer("Rectangle").y + 30',
    };
    const host = {
      style: { width: '250.5px', height: '80.25px' },
      classList: { contains: () => true },
    };
    const elements = new Map([
      ['text', { firstElementChild: host, style: {} } as unknown as HTMLElement],
    ]);
    for (const layers of [
      [rectangle, text],
      [text, rectangle],
    ]) {
      compiled.layers = layers;
      const sampled = new Map(
        layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, 5)]),
      );
      const result = resolveFrameExpressions(compiled, sampled, elements);
      expect(result.get('layer')!.transform).toMatchObject({ width: 400.5, height: 140.25 });
      expect(result.get('text')!.transform).toMatchObject({ x: 500.5, y: 30, width: 250.5 });
      expect(sampled.get('text')!.transform.width).toBe(100);
    }
    host.style.width = '350px';
    host.style.height = '100px';
    const sampled = new Map(
      compiled.layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, 5)]),
    );
    const updated = resolveFrameExpressions(compiled, sampled, elements);
    expect(updated.get('layer')!.transform).toMatchObject({ width: 500, height: 160 });
    expect(updated.get('text')!.transform.x).toBe(600);
    rectangle.expressionsEnabled = { width: false };
    expect(resolveFrameExpressions(compiled, sampled, elements).get('text')!.transform.x).toBe(200);
  });
  it('falls back on circular property dependencies without breaking unrelated properties', () => {
    const compiled = descriptor();
    const a = compiled.layers[0]!;
    a.name = 'A';
    const b = structuredClone(a);
    b.id = 'b';
    b.name = 'B';
    a.expressions = { x: 'layer("B").x + 1', y: '42' };
    b.expressions = { x: 'layer("A").x + 1' };
    for (const layers of [
      [a, b],
      [b, a],
    ]) {
      compiled.layers = layers;
      const sampled = new Map(
        layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, 0)]),
      );
      const result = resolveFrameExpressions(compiled, sampled);
      expect(result.get(a.id)!.transform).toMatchObject({ x: 0, y: 42 });
      expect(result.get(b.id)!.transform.x).toBe(0);
    }
  });
  it('uses timeline frames for the right-center-right expression, independently of paint sampling', () => {
    const compiled = descriptor();
    compiled.keyframes.at(-1)!.frame = 100;
    const rectangle = compiled.layers[0]!;
    rectangle.name = 'Rectangle';
    const text = structuredClone(rectangle);
    text.id = 'text';
    text.name = 'Text';
    text.animationTracks.x = [
      { id: 'x0', frame: 0, value: 1100, easing: 'linear' },
      { id: 'x10', frame: 10, value: 200, easing: 'linear' },
      { id: 'x90', frame: 90, value: 200, easing: 'linear' },
      { id: 'x100', frame: 100, value: 1100, easing: 'linear' },
    ];
    text.expressions = {
      x: `const rect = layer("Rectangle");
          const inside = rect.x + (rect.width - thisLayer.width) / 2;
          const outside = rect.x + rect.width + 100;
          if (frame < 10) { return lerp(outside, inside, clamp(frame / 10, 0, 1)); }
          else if (frame <= 90) { return inside; }
          else { return lerp(inside, outside, clamp((frame - 90) / 10, 0, 1)); }`,
      y: 'time * 25',
      opacity:
        'if (frame < 10) return clamp(frame / 10, 0, 1); if (frame <= 90) return 1; return 1 - clamp((frame - 90) / 10, 0, 1);',
    };
    compiled.layers.push(text);
    const target = { style: {} } as HTMLElement;
    const elements = new Map([
      ['layer', { style: {} } as HTMLElement],
      ['text', target],
    ]);
    const spy = vi.spyOn(gsap, 'set');
    const timeline = buildRuntimeTimeline(compiled, elements);
    for (const [frame, x] of [
      [0, 200],
      [5, 100],
      [10, 0],
      [90, 0],
      [95, 100],
      [100, 200],
      [5, 100],
    ]) {
      timeline.seek(frame! / 25, true);
      expect(spy.mock.calls.filter(([element]) => element === target).at(-1)?.[1]).toMatchObject({
        x,
        y: frame,
      });
    }
    // Playback advances the timeline directly; keyed X/opacity tweens must not override expressions.
    for (const [frame, x, opacity] of [
      [5, 100, 0.5],
      [20, 0, 1],
      [50, 0, 1],
      [80, 0, 1],
      [95, 100, 0.5],
      [100, 200, 0],
      [50, 0, 1],
    ] as const) {
      timeline.time(frame / 25, false);
      expect(Number(gsap.getProperty(target, 'x'))).toBeCloseTo(x);
      expect(Number(gsap.getProperty(target, 'opacity'))).toBeCloseTo(opacity);
    }
    timeline.kill();
    spy.mockRestore();
  });
  it('resolves layer references in the shared editor pass and timeline seeking', () => {
    const compiled = descriptor();
    const rectangle = compiled.layers[0]!;
    rectangle.name = 'Rectangle';
    rectangle.animationTracks.x = [
      { id: 'r0', frame: 0, value: 40, easing: 'linear' },
      { id: 'r10', frame: 10, value: 140, easing: 'linear' },
    ];
    const text = structuredClone(rectangle);
    text.id = 'text';
    text.name = 'Text';
    text.expressions = {
      x: 'layer("Rectangle").x + layer("Rectangle").width + 100',
      y: 'thisLayer.y + 20',
    };
    compiled.layers.push(text);
    const target = { style: {} } as HTMLElement;
    const elements = new Map([
      ['layer', { style: {} } as HTMLElement],
      ['text', target],
    ]);
    const spy = vi.spyOn(gsap, 'set');
    const verify = (x: number, y = 20) => {
      const calls = spy.mock.calls.filter(([element]) => element === target);
      expect(calls.at(-1)?.[1]).toMatchObject({ x, y });
    };
    // This is the pass used by Stage, including stopped-frame edits.
    applyCompiledMasks(
      compiled,
      elements,
      new Map(compiled.layers.map((layer) => [layer.id, sampleCompiledLayerVisualState(layer, 0)])),
    );
    verify(240);
    const timeline = buildRuntimeTimeline(compiled, elements);
    for (const frame of [5, 10, 0, 5]) {
      timeline.seek(frame / 25, true);
      verify(240 + frame * 10);
    }
    text.expressionsEnabled = { x: false };
    timeline.seek(0, true);
    verify(40);
    timeline.kill();
    spy.mockRestore();
  });
  it('samples shader tracks through the uniform path instead of GSAP numeric targets', () => {
    const compiled = descriptor();
    compiled.layers[0]!.element = createTextElement({
      fill: createShaderPaint({
        fragmentSource: `#pragma ograf count slider min(0) max(10)
const int count = 2;
#pragma ograf gain slider min(0.0) max(2.0)
const float gain = 0.5;
void mainImage(out vec4 color, in vec2 coord) { color = vec4(gain); }`,
      }),
    });
    const property = 'fill.parameters.gain';
    compiled.layers[0]!.animationTracks[property] = [
      { id: 'a', frame: 0, value: 0, easing: 'linear' },
      { id: 'b', frame: 10, value: 2, easing: 'linear' },
    ];
    compiled.layers[0]!.animationTracks['fill.parameters.count'] = [
      { id: 'c', frame: 0, value: 2, easing: 'linear' },
      { id: 'd', frame: 10, value: 8, easing: 'linear' },
    ];
    const spy = vi.spyOn(shaderAnimationRendering, 'applyShaderPaintTracks');
    const element = { style: {} } as unknown as HTMLElement;
    const timeline = buildRuntimeTimeline(compiled, new Map([['layer', element]]));
    for (const frame of [5, 2, 5]) {
      timeline.seek(frame / 25, true);
      expect(spy.mock.calls.at(-1)?.[1][property]?.[0]?.value).toBe(frame / 5);
      expect(spy.mock.calls.at(-1)?.[1]['fill.parameters.count']?.[0]?.value).toBe(2);
    }
    timeline.seek(10 / 25, true);
    expect(spy.mock.calls.at(-1)?.[1]['fill.parameters.count']?.[0]?.value).toBe(8);
    expect(timeline.getChildren().some((tween) => property in tween.vars)).toBe(false);
    timeline.kill();
    spy.mockRestore();
  });
  it('restores a transparent first-frame pose after seeking backwards from a visible frame', () => {
    const setSpy = vi.spyOn(gsap, 'set');
    const element = { style: {} } as unknown as HTMLElement;
    const timeline = buildRuntimeTimeline(descriptor(), new Map([['layer', element]]));
    const initialSetCalls = setSpy.mock.calls.length;

    timeline.seek(10 / 25, true);
    expect(gsapOpacity(element)).toBe(1);
    timeline.seek(0, true);

    expect(gsapOpacity(element)).toBe(0);
    expect(setSpy.mock.calls.length).toBeGreaterThan(initialSetCalls);
    timeline.kill();
    setSpy.mockRestore();
  });

  it('renders animated gradient stop offsets on deterministic seeks', () => {
    const compiled = descriptor();
    const fill = {
      type: 'linear' as const,
      angle: 90,
      stops: [
        { offset: 0, color: '#ffffff', opacity: 1 },
        { offset: 1, color: '#000000', opacity: 1 },
      ],
    };
    compiled.layers[0]!.element = {
      type: 'rectangle',
      fill,
      strokeColor: 'transparent',
      strokeWidth: 0,
      borderRadius: createCornerRadii(),
    };
    compiled.layers[0]!.animationTracks['fill.stops[0].offset'] = [
      { id: 'stop-0', frame: 0, value: 0, easing: 'linear' },
      { id: 'stop-10', frame: 10, value: 1, easing: 'linear' },
    ];
    const content = { style: {}, querySelector: () => null };
    const element = {
      style: {},
      dataset: { ografBasePaint: JSON.stringify(fill) },
      firstElementChild: content,
    } as unknown as HTMLElement;

    const timeline = buildRuntimeTimeline(compiled, new Map([['layer', element]]));
    timeline.seek(5 / 25, true);

    expect(content.style).toMatchObject({ background: expect.stringContaining('50%') });
    timeline.kill();
  });

  it('renders animated text stroke width on deterministic forward and reverse seeks', () => {
    const compiled = descriptor();
    compiled.layers[0]!.element = createTextElement({
      content: 'Score',
      strokeColor: '#101820',
      strokeWidth: 0,
    });
    compiled.layers[0]!.animationTracks.strokeWidth = [
      { id: 'stroke-0', frame: 0, value: 0, easing: 'linear' },
      { id: 'stroke-10', frame: 10, value: 8, easing: 'linear' },
    ];
    const content = { style: {} };
    const contentHost = {
      dataset: {},
      firstElementChild: content,
      classList: { contains: (name: string) => name === 'layer-content-host' },
    };
    const element = {
      style: {},
      firstElementChild: contentHost,
    } as unknown as HTMLElement;

    const timeline = buildRuntimeTimeline(compiled, new Map([['layer', element]]));
    timeline.seek(5 / 25, true);
    expect(content.style).toMatchObject({ webkitTextStrokeWidth: '4px' });
    timeline.seek(0, true);
    expect(content.style).toMatchObject({ webkitTextStrokeWidth: '0px' });
    timeline.kill();
  });
});

function gsapOpacity(element: HTMLElement): number {
  return Number((element as unknown as { opacity: number }).opacity ?? element.style.opacity);
}
