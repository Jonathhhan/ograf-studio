import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createChartElement } from '@ograf-editor/scene-model';
import { ChartEditor } from './ChartEditor';

describe('Chart.js gallery editor', () => {
  it('shows all nine selectable previews and direct data controls', () => {
    const markup = renderToStaticMarkup(
      createElement(ChartEditor, { element: createChartElement(), onChange: () => {} }),
    );
    expect(markup.match(/aria-pressed=/g)).toHaveLength(9);
    expect(markup).toContain('Chart type gallery');
    expect(markup).toContain('Horizontal');
    expect(markup).toContain('Doughnut');
    expect(markup).toContain('Polar area');
    expect(markup).toContain('Chart rows');
    expect(markup).toContain('Advanced · edit JSON');
  });
});
