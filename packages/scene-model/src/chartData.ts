import type { ChartElement } from './types';

const COLOR = /^#[\da-f]{6}$/i;

/** Only a small, predictable, JSON-safe Chart.js data subset crosses the OGraf boundary. */
export function parseChartData(input: unknown): ChartElement['data'] {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Chart data must be an object.');
  const value = raw as Record<string, unknown>;
  if (
    !Array.isArray(value.labels) ||
    value.labels.length < 1 ||
    value.labels.length > 100 ||
    !value.labels.every((label) => typeof label === 'string' && label.length <= 120)
  )
    throw new Error('Chart labels must contain 1–100 short text entries.');
  if (!Array.isArray(value.datasets) || value.datasets.length < 1 || value.datasets.length > 12)
    throw new Error('A chart needs 1–12 datasets.');
  const labels = value.labels as string[];
  const datasets = value.datasets.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('Each chart dataset must be an object.');
    const dataset = item as Record<string, unknown>;
    if (typeof dataset.label !== 'string' || dataset.label.length > 120)
      throw new Error('Each chart dataset needs a short label.');
    if (
      !Array.isArray(dataset.data) ||
      dataset.data.length !== labels.length ||
      !dataset.data.every((point) => typeof point === 'number' && Number.isFinite(point))
    )
      throw new Error('Each dataset needs one finite number per label.');
    const colors = dataset.backgroundColor;
    if (
      !(typeof colors === 'string' && COLOR.test(colors)) &&
      !(
        Array.isArray(colors) &&
        colors.length === labels.length &&
        colors.every((color) => typeof color === 'string' && COLOR.test(color))
      )
    )
      throw new Error('Background colors must be #RRGGBB hex values.');
    if (typeof dataset.borderColor !== 'string' || !COLOR.test(dataset.borderColor))
      throw new Error('Each dataset needs a #RRGGBB border color.');
    return {
      label: dataset.label as string,
      data: [...dataset.data] as number[],
      backgroundColor: Array.isArray(colors) ? ([...colors] as string[]) : (colors as string),
      borderColor: dataset.borderColor as string,
    };
  });
  return { labels, datasets };
}
