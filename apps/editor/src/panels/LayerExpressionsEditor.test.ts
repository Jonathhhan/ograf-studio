import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createComposition, createLayerOfKind } from '@ograf-editor/scene-model';
import { LayerExpressionsEditor } from './LayerExpressionsEditor';
vi.mock('../components/JavaScriptEditor', () => ({ JavaScriptEditor: () => null }));

const layer = createLayerOfKind('rectangle');
const composition = createComposition({ layers: [layer] });
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
  useExpressionDiagnosticsStore: () => ({ compositionId: composition.id, diagnostics: [] }),
}));

describe('expression field presentation', () => {
  it('renders five grouped expression fields and no separate geometry components', () => {
    const html = renderToStaticMarkup(createElement(LayerExpressionsEditor));
    for (const label of ['Position', 'Size', 'Transform Origin', 'Rotation', 'Opacity'])
      expect(html).toContain(`aria-label="${label} expression enabled"`);
    expect(html.match(/type="checkbox"/g)).toHaveLength(5);
    expect(html).not.toContain('aria-label="Width expression enabled"');
    expect(html).not.toContain('aria-label="Position X expression enabled"');
  });
});
