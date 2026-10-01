import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledGraphicDescriptor, ScheduledAction } from '@ograf-editor/ograf-types';
import {
  applyShaderAnimationValues,
  createDefaultTransform,
  createLayerEffects,
  createLayerLoopClip,
  createMediaPaint,
  createRectangleLayer,
  createShaderPaint,
  resolveShaderParameters,
  sampleShaderAnimationValues,
  type Element,
  type LayerAnimationTracks,
} from '@ograf-editor/scene-model';

const mock = vi.hoisted(() => {
  const frames: FrameRequestCallback[] = [];
  let nextFrameId = 0;
  class Host {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: Host[] = [];
    listeners = new Map<
      string,
      Array<(event: { pointerType?: string; detail?: number }) => void>
    >();
    firstElementChild: Host | null = null;
    shadowRoot: Host | null = null;
    ownerDocument = {};
    attachShadow() {
      return (this.shadowRoot = new Host());
    }
    replaceChildren() {
      this.children = [];
    }
    appendChild(child: Host) {
      this.children.push(child);
      return child;
    }
    addEventListener(
      type: string,
      listener: (event: { pointerType?: string; detail?: number }) => void,
    ) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    emit(type: string, event: { pointerType?: string; detail?: number } = {}) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }
  vi.stubGlobal('HTMLElement', Host);
  vi.stubGlobal('document', { createElement: () => new Host() });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return ++nextFrameId;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return { Host, paint: vi.fn(), content: vi.fn(), render: vi.fn(), frames };
});
vi.mock('./buildRuntimeTimeline', () => ({
  buildRuntimeTimeline: () => {
    let seconds = 0;
    return {
      time: () => seconds,
      seek: (value: number) => {
        seconds = value;
      },
      kill() {},
      pause() {},
    };
  },
}));
vi.mock('./documentFonts', () => ({ registerDocumentFonts: async () => {} }));
vi.mock('lottie-web/build/player/lottie_light_canvas.js', () => ({ default: {} }));
vi.mock('./maskRendering', () => ({ applyCompiledMasks: () => {} }));
vi.mock('./renderElement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./renderElement')>();
  return {
    ...actual,
    renderElementContent: (host: HTMLElement, element: Element) => {
      mock.render(host, element);
      host.dataset.ografRenderedElement = JSON.stringify(element);
    },
    renderAnimatedElementAtTime: mock.content,
    applyAnimatedPaint: mock.paint,
    disposeElementContent: () => {},
    setLottieDeterministicRendering: () => {},
    waitForElementContentReady: async () => {},
  };
});
import { GraphicElement } from './GraphicElement';

describe('pointer-triggered visual rules', () => {
  it('applies mouse-over and mouse-leave visibility in realtime playback', async () => {
    const compiled = descriptor();
    compiled.layers[0]!.visualRules = [
      {
        id: 'enter',
        name: 'Hide on hover',
        enabled: true,
        trigger: 'pointer-enter',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [{ type: 'visibility', visible: false }],
      },
      {
        id: 'leave',
        name: 'Show on leave',
        enabled: true,
        trigger: 'pointer-leave',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [{ type: 'visibility', visible: true }],
      },
    ];
    class Graphic extends GraphicElement {
      static descriptor = compiled;
    }
    const graphic = new Graphic();
    graphic.connectedCallback();
    expect(
      await graphic.load({
        renderType: 'realtime',
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        data: {},
      }),
    ).toMatchObject({ statusCode: 200 });

    const layerHost = (
      graphic.shadowRoot as unknown as InstanceType<typeof mock.Host>
    ).children.find((child) => child.style.position === 'absolute')!;
    layerHost.emit('pointerenter', { pointerType: 'touch' });
    expect(layerHost.style.display).toBe('');
    layerHost.emit('pointerenter', { pointerType: 'mouse' });
    expect(layerHost.style.display).toBe('none');
    layerHost.emit('pointerleave', { pointerType: 'mouse' });
    expect(layerHost.style.display).toBe('');

    expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
  });

  it('does not fire a single-click rule during a double-click', async () => {
    const compiled = descriptor();
    compiled.layers[0]!.visualRules = [
      {
        id: 'click',
        name: 'Hide on click',
        enabled: true,
        trigger: 'click',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [{ type: 'visibility', visible: false }],
      },
      {
        id: 'double-click',
        name: 'Show on double-click',
        enabled: true,
        trigger: 'double-click',
        dataKey: '',
        sourcePath: [],
        operator: 'equals',
        actions: [{ type: 'visibility', visible: true }],
      },
    ];
    class Graphic extends GraphicElement {
      static descriptor = compiled;
    }
    const graphic = new Graphic();
    graphic.connectedCallback();
    expect(
      await graphic.load({
        renderType: 'realtime',
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        data: {},
      }),
    ).toMatchObject({ statusCode: 200 });
    const layerHost = (
      graphic.shadowRoot as unknown as InstanceType<typeof mock.Host>
    ).children.find((child) => child.style.position === 'absolute')!;

    vi.useFakeTimers();
    try {
      layerHost.emit('click', { detail: 1 });
      layerHost.emit('click', { detail: 2 });
      layerHost.emit('dblclick');
      await vi.advanceTimersByTimeAsync(500);
      expect(layerHost.style.display).toBe('');

      layerHost.emit('click', { detail: 1 });
      await vi.advanceTimersByTimeAsync(500);
      expect(layerHost.style.display).toBe('none');
    } finally {
      vi.useRealTimers();
      expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
    }
  });
});

function descriptor(): CompiledGraphicDescriptor {
  const authored = createRectangleLayer();
  if (authored.element.type !== 'rectangle') throw Error('Expected rectangle');
  const paint = createShaderPaint({
    fragmentSource: `#pragma ograf gain slider min(0.0) max(2.0)
const float gain = 0.4;
#pragma ograf count slider min(0) max(10)
const int count = 3;
void mainImage(out vec4 color, in vec2 coord) { color = vec4(gain); }`,
  });
  const key = (id: string, frame: number, value: number) => ({
    id,
    frame,
    value,
    easing: 'linear' as const,
  });
  return {
    width: 640,
    height: 360,
    frameRate: 10,
    backgroundColor: 'transparent',
    layers: [
      {
        id: 'shader',
        isVisible: true,
        element: { ...authored.element, fill: paint },
        effects: createLayerEffects(),
        keyframes: [
          {
            id: 'start',
            frame: 0,
            easing: 'linear',
            transform: createDefaultTransform({ width: 640, height: 360 }),
          },
        ],
        animationTracks: {},
        bindings: [
          { dataKey: 'gain', targetProperty: 'fill.parameters.gain' },
          { dataKey: 'count', targetProperty: 'fill.parameters.count' },
        ],
        loop: createLayerLoopClip({
          durationFrames: 20,
          activation: { type: 'step', stepKeyframeId: 'step1' },
          tracks: {
            'fill.parameters.gain': [key('g0', 0, 0), key('g1', 10, 2), key('g2', 20, 0)],
            'fill.parameters.count': [key('c0', 0, 2), key('c1', 10, 8), key('c2', 20, 2)],
          },
        }),
      },
    ],
    keyframes: [
      { id: 'start', frame: 0, role: 'start' },
      { id: 'step1', frame: 10, role: 'step' },
      { id: 'step2', frame: 20, role: 'step' },
      { id: 'end', frame: 30, role: 'end' },
    ],
    transitions: [
      { fromKeyframeId: 'step2', toKeyframeId: 'end', durationFrames: 10, easing: 'linear' },
    ],
    startKeyframeId: 'start',
    endKeyframeId: 'end',
    stepKeyframeIds: ['step1', 'step2'],
    stepCount: 2,
    customActions: [],
  };
}

function mediaDescriptor(): CompiledGraphicDescriptor {
  const result = descriptor();
  const authored = createRectangleLayer();
  if (authored.element.type !== 'rectangle') throw Error('Expected rectangle');
  return {
    ...result,
    layers: [
      {
        ...result.layers[0]!,
        id: 'media',
        element: {
          ...authored.element,
          fill: createMediaPaint({ source: { kind: 'clip', src: 'asset:clip' } }),
        },
        bindings: [],
        loop: null,
      },
    ],
  };
}

function customActionDescriptor(): CompiledGraphicDescriptor {
  const result = descriptor();
  const layer = result.layers[0]!;
  return {
    ...result,
    layers: [
      {
        ...layer,
        loop: {
          ...layer.loop!,
          activation: { type: 'customAction', customActionId: 'goal_scored' },
          repeatCount: 1,
        },
      },
    ],
    customActions: [{ id: 'goal_scored', name: 'Goal scored', durationFrames: 20 }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.frames.length = 0;
});

describe('realtime Media paint playback', () => {
  it('keeps rendering Media frames after load', async () => {
    class Graphic extends GraphicElement {
      static descriptor = mediaDescriptor();
    }
    const graphic = new Graphic();
    graphic.connectedCallback();

    expect(
      await graphic.load({
        renderType: 'realtime',
        renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
        data: {},
      }),
    ).toMatchObject({ statusCode: 200 });
    expect(mock.frames.filter((frame) => frame.name === 'invoke')).toHaveLength(1);

    const rendersAfterLoad = mock.content.mock.calls.length;
    const scheduled = mock.frames.findIndex((frame) => frame.name === 'invoke');
    mock.frames.splice(scheduled, 1)[0]!(performance.now());
    expect(mock.content.mock.calls.length).toBeGreaterThan(rendersAfterLoad);
    expect(mock.frames.filter((frame) => frame.name === 'invoke')).toHaveLength(1);

    expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
  });
});

describe('custom-action clips', () => {
  it('applies payload data, plays the authored clip, and settles automatically', async () => {
    vi.useFakeTimers();
    try {
      class Graphic extends GraphicElement {
        static descriptor = customActionDescriptor();
      }
      const graphic = new Graphic();
      graphic.connectedCallback();
      expect(
        await graphic.load({
          renderType: 'realtime',
          renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
          data: { gain: 0.5, count: 3 },
        }),
      ).toMatchObject({ statusCode: 200 });

      let settled = false;
      const action = graphic
        .customAction({ id: 'goal_scored', payload: { gain: 1.25 }, skipAnimation: false })
        .then((result) => {
          settled = true;
          return result;
        });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      expect(
        mock.render.mock.calls.some(
          ([, element]) =>
            element.type === 'rectangle' &&
            element.fill.type === 'shader' &&
            element.fill.parameters.gain === 1.25,
        ),
      ).toBe(true);

      await vi.advanceTimersByTimeAsync(1999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await action).toMatchObject({ statusCode: 200 });
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('scheduled shader lifecycle replay', () => {
  it.each(['stopAction', 'playAction'] as const)(
    'preserves held loop phase and discrete uniforms through %s and backward replay',
    async (action) => {
      class Graphic extends GraphicElement {
        static descriptor = descriptor();
      }
      const graphic = new Graphic();
      graphic.connectedCallback();
      expect(
        await graphic.load({
          renderType: 'non-realtime',
          renderCharacteristics: { resolution: { width: 640, height: 360 }, frameRate: 10 },
          data: { gain: 0.8, count: 5 },
        }),
      ).toMatchObject({ statusCode: 200 });
      const schedule: ScheduledAction[] = [
        { timestamp: 0, action: { type: 'playAction', params: { skipAnimation: true } } },
        {
          timestamp: 250,
          action: {
            type: 'updateAction',
            params: { data: { gain: 0.6, count: 4 }, skipAnimation: true },
          },
        },
        { timestamp: 500, action: { type: action, params: {} } },
      ];
      await graphic.setActionsSchedule({ schedule });
      const sample = async (timestamp: number) => {
        expect(await graphic.goToTime({ timestamp })).toMatchObject({ statusCode: 200 });
        const [host, tracks, frame] = mock.paint.mock.calls.at(-1) as [
          HTMLElement,
          LayerAnimationTracks,
          number,
        ];
        const base = JSON.parse(host.dataset.ografRenderedElement!) as Element;
        const animated = applyShaderAnimationValues(
          base,
          sampleShaderAnimationValues(base, tracks, frame),
        );
        if (
          !('fill' in animated) ||
          !animated.fill ||
          typeof animated.fill === 'string' ||
          animated.fill.type !== 'shader'
        )
          throw Error('Expected shader fill');
        return resolveShaderParameters(animated.fill);
      };
      const first = await sample(1000);
      expect(first).toMatchObject({ gain: 0.8, count: 2 });
      expect(await sample(100)).toMatchObject({ gain: 0.2, count: 2 });
      expect(await sample(1000)).toEqual(first);
      expect(await sample(1500)).toMatchObject({ gain: 0.6, count: 4 });
      await graphic.setActionsSchedule({ schedule: [] });
      expect(await sample(1000)).toMatchObject({ gain: 0.6, count: 4 });
      expect(await graphic.dispose()).toMatchObject({ statusCode: 200 });
    },
  );
});
