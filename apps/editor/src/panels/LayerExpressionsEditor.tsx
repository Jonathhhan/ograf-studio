import { useState } from 'react';
import { expressionSyntaxError } from '@ograf-editor/scene-model';
import { PropertyRow } from '../components/PropertyRow';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useExpressionDiagnosticsStore } from '../state/expressionDiagnosticsStore';

const EXPRESSION_FIELDS = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: 'W' },
  { key: 'height', label: 'H' },
  { key: 'rotation', label: 'Rotation' },
  { key: 'opacity', label: 'Opacity (0\u20131)' },
] as const;

export function LayerExpressionsEditor() {
  const composition = useActiveComposition();
  const selectedLayerId = useSelectionStore((s) => s.selectedLayerId);
  const layer = composition.layers.find((candidate) => candidate.id === selectedLayerId);
  const expressionDiagnostics = useExpressionDiagnosticsStore();
  const [expressionReferenceId, setExpressionReferenceId] = useState('');
  const updateLayerExpressions = useProjectStore((s) => s.updateLayerExpressions);
  const setLayerExpressionEnabled = useProjectStore((s) => s.setLayerExpressionEnabled);
  if (!layer || layer.isGuide) return <p>Select a layer to edit its expressions.</p>;
  return (
    <section className="scripts-expressions">
      <h3>Expressions: {layer.name}</h3>
      <label className="scripts-reference">
        Stable layer reference
        <select
          value={expressionReferenceId}
          aria-label="Stable layer reference"
          onChange={(event) => setExpressionReferenceId(event.target.value)}
        >
          <option value="">Choose a layer...</option>
          {composition.layers
            .filter((candidate) => !candidate.isGuide)
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
        </select>
        {expressionReferenceId && (
          <input
            readOnly
            aria-label="Layer reference code"
            value={`layerById(${JSON.stringify(expressionReferenceId)})`}
            onFocus={(event) => event.target.select()}
          />
        )}
      </label>
      {EXPRESSION_FIELDS.map(({ key, label }) => {
        const source =
          layer.expressions?.[key as keyof NonNullable<typeof layer.expressions>] ?? '';
        const runtimeError =
          expressionDiagnostics.compositionId === composition.id &&
          layer.expressionsEnabled?.[key as keyof NonNullable<typeof layer.expressions>] !== false
            ? expressionDiagnostics.diagnostics.find(
                (entry) =>
                  entry.layerId === layer.id && entry.property === key && entry.source === source,
              )?.message
            : undefined;
        const error = expressionSyntaxError(source) ?? runtimeError;
        const errorId = `expression-error-${layer.id}-${key}`;
        return (
          <PropertyRow
            as="div"
            key={`expression-${key}`}
            className="scripts-expression-row"
            help={`Expression for ${label}`}
          >
            <label>
              <input
                type="checkbox"
                checked={
                  layer.expressionsEnabled?.[key as keyof NonNullable<typeof layer.expressions>] !==
                  false
                }
                disabled={layer.isLocked}
                onChange={(event) =>
                  setLayerExpressionEnabled(
                    layer.id,
                    key as keyof NonNullable<typeof layer.expressions>,
                    event.target.checked,
                  )
                }
              />{' '}
              {label}
            </label>
            <div className="scripts-expression-value">
              <textarea
                rows={4}
                spellCheck={false}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                aria-label={`${label} expression`}
                placeholder="Use authored value"
                value={source}
                disabled={layer.isLocked}
                onChange={(event) => {
                  const expression = event.target.value;
                  const expressions = { ...(layer.expressions ?? {}) };
                  const expressionKey = key as keyof NonNullable<typeof layer.expressions>;
                  if (expression.length) expressions[expressionKey] = expression;
                  else delete expressions[expressionKey];
                  updateLayerExpressions(
                    layer.id,
                    Object.keys(expressions).length ? expressions : undefined,
                  );
                }}
              />
              {error && (
                <p id={errorId} className="inspector-error">
                  {error}
                </p>
              )}
            </div>
          </PropertyRow>
        );
      })}
    </section>
  );
}
