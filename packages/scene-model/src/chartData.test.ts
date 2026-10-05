import { describe, expect, it } from 'vitest';
import { createChartElement, createChartLayer, defaultTransformFor } from './factory';
import { parseChartData } from './chartData';
import { applyElementDataValue } from './boundPaint';

describe('Chart.js authoring data', () => {
  it('creates a reusable chart layer with a visible canvas-sized default', () => {
    expect(createChartLayer().element.type).toBe('chart');
    expect(defaultTransformFor('chart')).toMatchObject({ width: 640, height: 360 });
  });

  it('normalizes a JSON data binding without mutating authored data', () => {
    const original = createChartElement();
    const value = JSON.stringify({
      labels: ['One', 'Two'],
      datasets: [
        { label: 'Results', data: [4, 8], backgroundColor: '#2563eb', borderColor: '#2563eb' },
      ],
    });
    const updated = applyElementDataValue(original, 'data', value);
    expect(updated.type === 'chart' && updated.data.labels).toEqual(['One', 'Two']);
    expect(original.data.labels).toHaveLength(4);
  });

  it('rejects executable or oversized data instead of passing it into Chart.js', () => {
    expect(() => parseChartData('{"labels":[],"datasets":[]}')).toThrow();
    expect(() =>
      parseChartData({
        labels: ['x'],
        datasets: [{ label: 'x', data: [1], backgroundColor: 'url(js)', borderColor: '#2563eb' }],
      }),
    ).toThrow();
  });
});
