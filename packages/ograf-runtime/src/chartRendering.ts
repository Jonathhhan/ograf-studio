import Chart from 'chart.js/auto';
import type { ChartConfiguration, ChartType } from 'chart.js';
import type { ChartElement } from '@ograf-editor/scene-model';

const mountedCharts = new WeakMap<HTMLElement, Chart>();

/** Chart.js owns its canvas, but the OGraf document owns all chart inputs and timing. */
export function mountChart(container: HTMLElement, element: ChartElement): void {
  const host = container.ownerDocument.createElement('div');
  host.style.cssText =
    'position:relative;width:100%;height:100%;overflow:hidden;pointer-events:none';
  const canvas = container.ownerDocument.createElement('canvas');
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
      animation: false,
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
  } as ChartConfiguration;
  mountedCharts.set(container, new Chart(canvas, config));
}

export function disposeChart(container: HTMLElement): void {
  mountedCharts.get(container)?.destroy();
  mountedCharts.delete(container);
}
