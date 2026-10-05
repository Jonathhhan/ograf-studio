import { describe, expect, it, vi } from 'vitest';
import Chart from 'chart.js/auto';
import type { ChartConfiguration, ChartItem, Plugin } from 'chart.js';
import { createChartElement, type ChartPreset } from '@ograf-editor/scene-model';
import { disposeChart, mountChart, renderChartAnimationAtFrame } from './chartRendering';

// Exercise the actual Chart.js controllers in Node. Its BasicPlatform normally disables all
// animation options, including the arc reset flags our frame-sampling adapter needs.
vi.mock('chart.js/auto', async (importOriginal) => {
  const original = await importOriginal<typeof import('chart.js/auto')>();
  const { BasicPlatform } = await import('chart.js');
  class FrameSamplingPlatform extends BasicPlatform {
    override updateConfig(): void {}
  }
  class FrameSamplingChart extends original.default {
    constructor(item: ChartItem, configuration: ChartConfiguration) {
      super(item, { ...configuration, platform: FrameSamplingPlatform });
    }
  }
  return { ...original, default: FrameSamplingChart };
});

function chartHost() {
  const canvases: HTMLCanvasElement[] = [];
  const document = {
    createElement(tag: string) {
      const node: Record<string, unknown> = {
        style: {},
        dataset: {},
        width: 640,
        height: 360,
        appendChild: vi.fn(),
      };
      if (tag === 'canvas') {
        const context = new Proxy(
          { canvas: node, measureText: (value: string) => ({ width: value.length * 6 }) },
          {
            get(target, property) {
              if (property in target) return target[property as keyof typeof target];
              return () => undefined;
            },
          },
        );
        node.getContext = () => context;
        canvases.push(node as unknown as HTMLCanvasElement);
      }
      return node;
    },
  };
  return {
    host: {
      ownerDocument: document,
      dataset: {},
      appendChild: vi.fn(),
    } as unknown as HTMLElement,
    canvas: () => canvases[0]!,
  };
}

const presets: ChartPreset[] = [
  'bar',
  'horizontal-bar',
  'stacked-bar',
  'line',
  'area',
  'pie',
  'doughnut',
  'radar',
  'polar-area',
];

function geometry(chart: Chart) {
  return chart.data.datasets.map((_, index) =>
    chart.getDatasetMeta(index).data.map((point) => {
      const target = point as unknown as Record<string, number>;
      return Object.fromEntries(
        ['x', 'y', 'base', 'width', 'height', 'startAngle', 'endAngle', 'outerRadius'].flatMap(
          (key) => (typeof target[key] === 'number' ? [[key, target[key]]] : []),
        ),
      );
    }),
  );
}

describe('Chart.js frame rendering with real controllers', () => {
  it.each(presets)('%s grows and restores the same geometry after a backward seek', (preset) => {
    const { host, canvas } = chartHost();
    const element = createChartElement({ preset });
    element.animation = {
      type: 'grow',
      durationFrames: 20,
      delayFrames: 0,
      staggerFrames: 0,
      easing: 'linear',
      replayOnUpdate: true,
    };
    mountChart(host, element);
    const chart = Chart.getChart(canvas())!;
    const ranges = Object.fromEntries(
      Object.entries(chart.scales).map(([id, scale]) => [id, [scale.min, scale.max]]),
    );
    const initial = geometry(chart);
    renderChartAnimationAtFrame(host, element, 10);
    const halfway = geometry(chart);
    renderChartAnimationAtFrame(host, element, 20);
    const completed = geometry(chart);
    expect(halfway).not.toEqual(initial);
    expect(completed).not.toEqual(halfway);
    renderChartAnimationAtFrame(host, element, 10);
    expect(geometry(chart)).toEqual(halfway);
    renderChartAnimationAtFrame(host, element, 0);
    expect(geometry(chart)).toEqual(initial);
    expect(
      Object.fromEntries(
        Object.entries(chart.scales).map(([id, scale]) => [id, [scale.min, scale.max]]),
      ),
    ).toEqual(ranges);
    disposeChart(host);
    expect(Chart.getChart(canvas())).toBeUndefined();
  });

  it('retains the sampled progress when Chart.js recomputes layout during resize', () => {
    const { host, canvas } = chartHost();
    const element = createChartElement({ preset: 'horizontal-bar' });
    element.animation = {
      type: 'grow',
      durationFrames: 20,
      delayFrames: 0,
      staggerFrames: 0,
      easing: 'linear',
      replayOnUpdate: true,
    };
    mountChart(host, element);
    const chart = Chart.getChart(canvas())!;
    renderChartAnimationAtFrame(host, element, 10);
    chart.resize(800, 400);
    const halfway = geometry(chart);
    renderChartAnimationAtFrame(host, element, 20);
    const completed = geometry(chart);
    expect(halfway).not.toEqual(completed);
    renderChartAnimationAtFrame(host, element, 10);
    expect(geometry(chart)).toEqual(halfway);
    disposeChart(host);
  });

  it('draws curved area fills and strokes from the same sampled control points', () => {
    const { host } = chartHost();
    const element = createChartElement({ preset: 'area' });
    Object.assign(element.data.datasets[0]!, { tension: 0.35 });
    element.animation = {
      type: 'grow',
      durationFrames: 20,
      delayFrames: 0,
      staggerFrames: 0,
      easing: 'linear',
      replayOnUpdate: true,
    };
    let before: unknown;
    let after: unknown;
    const controlPoints = (chart: Chart) =>
      chart.getDatasetMeta(0).data.map((point) => {
        const target = point as unknown as Record<string, number>;
        return ['cp1x', 'cp1y', 'cp2x', 'cp2y'].map((key) => target[key]);
      });
    const monitor: Plugin = {
      id: 'ograf-test-curve-sample',
      beforeDatasetDraw(chart) {
        before = controlPoints(chart);
      },
      afterDatasetDraw(chart) {
        after = controlPoints(chart);
      },
    };
    Chart.register(monitor);
    try {
      mountChart(host, element);
      renderChartAnimationAtFrame(host, element, 10);
      expect(before).toEqual(after);
      renderChartAnimationAtFrame(host, element, 20);
      renderChartAnimationAtFrame(host, element, 10);
      expect(before).toEqual(after);
    } finally {
      disposeChart(host);
      Chart.unregister(monitor);
    }
  });
});
