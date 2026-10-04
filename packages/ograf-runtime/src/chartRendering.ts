import Chart from 'chart.js/auto';
import type { ChartConfiguration, ChartType, Plugin } from 'chart.js';
import {
  chartAnimationProgress,
  normalizeChartAnimation,
  type ChartElement,
} from '@ograf-editor/scene-model';

const GEOMETRY_KEYS = [
  'x',
  'y',
  'base',
  'width',
  'height',
  'startAngle',
  'endAngle',
  'circumference',
  'outerRadius',
  'innerRadius',
] as const;
type Geometry = Partial<Record<(typeof GEOMETRY_KEYS)[number], number>>;
interface ChartGeometry {
  target: Record<string, unknown>;
  from: Geometry;
  to: Geometry;
  index: number;
}
interface MountedChart {
  chart?: Chart;
  element: ChartElement;
  frame: number;
  geometry: ChartGeometry[];
}
const mountedCharts = new WeakMap<HTMLElement, MountedChart>();

export function chartAnimationEndFrame(element: ChartElement): number {
  const animation = normalizeChartAnimation(element.animation);
  return animation.type === 'none'
    ? 0
    : animation.delayFrames +
        animation.durationFrames +
        (animation.type === 'grow'
          ? animation.staggerFrames * Math.max(0, element.data.labels.length - 1)
          : 0);
}

function readGeometry(target: Record<string, unknown>): Geometry {
  return Object.fromEntries(
    GEOMETRY_KEYS.flatMap((key) =>
      typeof target[key] === 'number' && Number.isFinite(target[key]) ? [[key, target[key]]] : [],
    ),
  );
}

function applyGeometry(state: MountedChart): void {
  const animation = normalizeChartAnimation(state.element.animation);
  for (const { target, from, to, index } of state.geometry) {
    const progress =
      animation.type === 'grow' ? chartAnimationProgress(animation, state.frame, index) : 1;
    for (const key of GEOMETRY_KEYS) {
      const end = to[key];
      if (end === undefined) continue;
      const start = from[key] ?? end;
      const value = progress === 1 ? end : start + (end - start) * progress;
      target[key] = ['width', 'height', 'circumference', 'outerRadius', 'innerRadius'].includes(key)
        ? Math.max(0, value)
        : value;
    }
  }
  const chart = state.chart;
  if (!chart) return;
  // LineElement caches Path2D and control points. Its points setter clears both caches so
  // backward seeks and later redraws use the sampled geometry rather than the last full path.
  for (let index = 0; index < chart.data.datasets.length; index++) {
    const meta = chart.getDatasetMeta(index);
    if (meta.dataset && 'points' in meta.dataset) meta.dataset.points = meta.data;
  }
}

function animationPlugin(state: MountedChart): Plugin {
  let savedContext = false;
  const restoreContext = (chart: Chart) => {
    if (savedContext) {
      chart.ctx.restore();
      savedContext = false;
    }
  };
  return {
    id: 'ograf-chart-animation',
    afterUpdate(chart) {
      state.chart = chart;
      const targets = chart.data.datasets.flatMap((_, datasetIndex) =>
        chart.getDatasetMeta(datasetIndex).data.map((target, index) => ({
          target: target as unknown as Record<string, unknown>,
          to: readGeometry(target as unknown as Record<string, unknown>),
          index,
        })),
      );
      // Chart.js controllers supply each chart type's reset pose. Duration zero prevents
      // Chart.js from owning a wall-clock animation; the OGraf frame supplies progress below.
      chart.reset();
      state.geometry = targets.map((entry) => ({ ...entry, from: readGeometry(entry.target) }));
      applyGeometry(state);
    },
    beforeDraw(chart) {
      restoreContext(chart);
      applyGeometry(state);
    },
    beforeDatasetsDraw(chart) {
      const animation = normalizeChartAnimation(state.element.animation);
      const progress = Math.max(0, Math.min(1, chartAnimationProgress(animation, state.frame)));
      if (animation.type !== 'reveal' && animation.type !== 'fade') return;
      chart.ctx.save();
      savedContext = true;
      if (animation.type === 'reveal') {
        const { left, top, width, height } = chart.chartArea;
        chart.ctx.beginPath();
        chart.ctx.rect(left, top, width * progress, height);
        chart.ctx.clip();
      } else if (animation.type === 'fade') chart.ctx.globalAlpha *= progress;
    },
    afterDatasetsDraw: restoreContext,
    afterDraw: restoreContext,
  };
}

/** Chart.js owns its canvas, but the OGraf document owns all chart inputs and timing. */
export function mountChart(container: HTMLElement, element: ChartElement): void {
  const state: MountedChart = { element, frame: 0, geometry: [] };
  const host = container.ownerDocument.createElement('div');
  host.style.cssText =
    'position:relative;width:100%;height:100%;overflow:hidden;pointer-events:none';
  const canvas = container.ownerDocument.createElement('canvas');
  canvas.dataset.ografChartCanvas = 'true';
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  host.appendChild(canvas);
  container.appendChild(host);

  const radial = element.preset === 'radar' || element.preset === 'polar-area';
  const cartesian = !radial && element.preset !== 'pie' && element.preset !== 'doughnut';
  const type: ChartType =
    element.preset === 'horizontal-bar' || element.preset === 'stacked-bar'
      ? 'bar'
      : element.preset === 'area'
        ? 'line'
        : element.preset === 'polar-area'
          ? 'polarArea'
          : element.preset;
  const clockAnimation = { duration: 0, animateRotate: true, animateScale: true };
  const config = {
    type,
    data: {
      labels: [...element.data.labels],
      datasets: element.data.datasets.map((dataset) => ({
        ...structuredClone(dataset),
        ...(element.preset === 'area' ? { fill: true } : {}),
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      devicePixelRatio: 1,
      animation: clockAnimation,
      events: [],
      indexAxis: element.preset === 'horizontal-bar' ? 'y' : 'x',
      plugins: {
        legend: {
          display: element.showLegend,
          labels: { color: element.textColor, font: { size: element.fontSize } },
        },
        tooltip: { enabled: false },
      },
      ...(radial
        ? {
            scales: {
              r: {
                grid: { display: element.showGrid, color: '#ffffff44' },
                angleLines: { display: element.showGrid, color: '#ffffff44' },
                pointLabels: { color: element.textColor, font: { size: element.fontSize } },
                ticks: {
                  color: element.textColor,
                  backdropColor: 'transparent',
                  font: { size: element.fontSize },
                },
              },
            },
          }
        : cartesian
          ? {
              scales: {
                x: {
                  stacked: element.preset === 'stacked-bar',
                  grid: { display: element.showGrid },
                  ticks: { color: element.textColor, font: { size: element.fontSize } },
                },
                y: {
                  stacked: element.preset === 'stacked-bar',
                  beginAtZero: true,
                  grid: { display: element.showGrid },
                  ticks: { color: element.textColor, font: { size: element.fontSize } },
                },
              },
            }
          : {}),
      elements: { line: { fill: element.preset === 'area' } },
    },
    plugins: [animationPlugin(state)],
  } as ChartConfiguration;
  state.chart = new Chart(canvas, config);
  mountedCharts.set(container, state);
}

/** Redraw a frame without changing the final axis ranges or advancing a private timer. */
export function renderChartAnimationAtFrame(
  container: HTMLElement,
  _element: ChartElement,
  frame: number,
): void {
  const state = mountedCharts.get(container);
  if (!state?.chart) return;
  const override = container.dataset.ografChartAnimationFrame;
  state.frame = override === undefined ? frame : Number(override);
  applyGeometry(state);
  state.chart.draw();
}

export function disposeChart(container: HTMLElement): void {
  mountedCharts.get(container)?.chart?.destroy();
  mountedCharts.delete(container);
}
