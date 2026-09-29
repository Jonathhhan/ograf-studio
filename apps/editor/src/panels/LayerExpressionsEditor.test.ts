import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComposition, createLayerOfKind } from '@ograf-editor/scene-model';
import { LayerExpressionsEditor } from './LayerExpressionsEditor';
vi.mock('../components/JavaScriptEditor', () => ({
  JavaScriptEditor: ({ label, value }: { label: string; value: string }) =>
    createElement('textarea', { 'aria-label': label, defaultValue: value }),
}));

const layer = createLayerOfKind('rectangle');
const composition = createComposition({ layers: [layer] });
const diagnostics: Array<{ layerId: string; property: string; source: string; message: string }> =
  [];
vi.mock('../state/projectStore', () => ({
  useActiveComposition: () => composition,
  useProjectStore: (selector: (state: object) => unknown) =>
    selector({ updateLayerExpressions: vi.fn(), setLayerExpressionEnabled: vi.fn() }),
}));
vi.mock('../state/selectionStore', () => ({
  useSelectionStore: (selector: (state: object) => unknown) =>
    selector({ selectedLayerId: layer.id }),
}));
vi.mock('../state/expressionDiagnosticsStore', () => ({
  useExpressionDiagnosticsStore: () => ({ compositionId: composition.id, diagnostics }),
}));

afterEach(() => {
  layer.expressions = undefined;
  layer.expressionsEnabled = undefined;
  diagnostics.length = 0;
});

describe('expression field presentation', () => {
  it('renders five grouped expression fields and no separate geometry components', () => {
    const html = renderToStaticMarkup(createElement(LayerExpressionsEditor));
    for (const label of ['Position', 'Size', 'Transform Origin', 'Rotation', 'Opacity'])
      expect(html).toContain(`aria-label="${label} expression enabled"`);
    expect(html.match(/type="checkbox"/g)).toHaveLength(5);
    expect(html).not.toContain('aria-label="Width expression enabled"');
    expect(html).not.toContain('aria-label="Position X expression enabled"');
  });

  it('keeps populated scalar source, toggles, and diagnostics accessible on older projects', () => {
    layer.expressions = { x: 'missing.x', width: '120', y: ' ' };
    layer.expressionsEnabled = { width: false };
    diagnostics.push({
      layerId: layer.id,
      property: 'x',
      source: 'missing.x',
      message: 'missing is not defined',
    });
    const html = renderToStaticMarkup(createElement(LayerExpressionsEditor));
    expect(html).toContain('aria-label="Legacy Position X expression enabled"');
    expect(html).toContain('aria-label="Legacy Width expression enabled"');
    expect(html).not.toContain('aria-label="Legacy Position Y expression enabled"');
    expect(html).toContain('aria-label="Legacy Position X expression">missing.x</textarea>');
    expect(html).toContain('aria-label="Legacy Width expression">120</textarea>');
    expect(html).toContain('missing is not defined');
    expect(html).toMatch(/aria-label="Legacy Width expression enabled"\s*\/>/);
  });
});
