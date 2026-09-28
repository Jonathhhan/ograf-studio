import { useState } from 'react';
import {
  expressionSyntaxError,
  EXPRESSION_PROPERTIES,
  animatablePropertyLabel,
} from '@ograf-editor/scene-model';
import { JavaScriptEditor } from '../components/JavaScriptEditor';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useExpressionDiagnosticsStore } from '../state/expressionDiagnosticsStore';

export function LayerExpressionsEditor() {
  const composition = useActiveComposition();
  const selectedLayerId = useSelectionStore((s) => s.selectedLayerId);
  const layer = composition.layers.find((candidate) => candidate.id === selectedLayerId);
  const expressionDiagnostics = useExpressionDiagnosticsStore();
  const updateLayerExpressions = useProjectStore((s) => s.updateLayerExpressions);
  const setLayerExpressionEnabled = useProjectStore((s) => s.setLayerExpressionEnabled);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (!layer || layer.isGuide) return <p>Select a layer to edit its expressions.</p>;
  return (
    <section className="scripts-expressions">
      <h3>Expressions: {layer.name}</h3>
      {EXPRESSION_PROPERTIES.map((key) => {
        const label = animatablePropertyLabel(key, layer);
        const source = layer.expressions?.[key] ?? '';
        const runtimeError =
          expressionDiagnostics.compositionId === composition.id &&
          layer.expressionsEnabled?.[key] !== false
            ? expressionDiagnostics.diagnostics.find(
                (entry) =>
                  entry.layerId === layer.id && entry.property === key && entry.source === source,
              )?.message
            : undefined;
        const error = expressionSyntaxError(source) ?? runtimeError;
        const identity = `${layer.id}:${key}`;
        const bodyId = `expression-body-${identity}`;
        const errorId = `expression-error-${identity}`;
        const open = expanded[identity] ?? false;
        return (
          <section key={identity} className="scripts-expression-row" data-empty={!source.trim()}>
            <div className="scripts-expression-header">
              <input
                type="checkbox"
                aria-label={`${label} expression enabled`}
                checked={layer.expressionsEnabled?.[key] !== false}
                disabled={layer.isLocked}
                onChange={(event) => setLayerExpressionEnabled(layer.id, key, event.target.checked)}
              />
              <button
                type="button"
                className="scripts-expression-disclosure"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => setExpanded((current) => ({ ...current, [identity]: !open }))}
              >
                {open ? '\u25be' : '\u25b8'} {label}
                {error ? ' (error)' : ''}
              </button>
            </div>
            <div id={bodyId} className="scripts-expression-value" hidden={!open}>
              {open && (
                <JavaScriptEditor
                  context={{ composition, mode: 'expression', layer }}
                  invalid={Boolean(error)}
                  describedBy={error ? errorId : undefined}
                  label={`${label} expression`}
                  placeholder="Use authored value"
                  value={source}
                  readOnly={layer.isLocked}
                  onChange={(expression) =>
                    updateLayerExpressions(layer.id, {
                      ...layer.expressions,
                      [key]: expression,
                    })
                  }
                />
              )}
              {error && (
                <p id={errorId} className="inspector-error">
                  {error}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </section>
  );
}
