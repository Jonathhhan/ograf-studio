import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useTestDataStore } from '../state/testDataStore';
import { mapConnectionPayload, readDataConnection } from '../state/dataConnections';
import { CollapsibleSection } from '../components/CollapsibleSection';

export function DataConnectionsSection() {
  const composition = useActiveComposition();
  const add = useProjectStore((state) => state.addDataConnection);
  const update = useProjectStore((state) => state.updateDataConnection);
  const remove = useProjectStore((state) => state.removeDataConnection);
  const setValues = useTestDataStore((state) => state.setValues);
  const [status, setStatus] = useState<Record<string, string>>({});
  const fileInputs = useRef(new Map<string, HTMLInputElement>());
  const connections = useMemo(
    () => composition.dataConnections ?? [],
    [composition.dataConnections],
  );

  const refresh = useCallback(
    async (connection: (typeof connections)[number]) => {
      try {
        setStatus((current) => ({ ...current, [connection.id]: 'Connecting…' }));
        const payload = await readDataConnection(connection);
        const previous = useTestDataStore.getState().values;
        setValues(
          mapConnectionPayload(connection, composition.dataFields, payload, previous),
          composition.layers,
          composition.dataFields,
        );
        setStatus((current) => ({
          ...current,
          [connection.id]: `Connected · ${new Date().toLocaleTimeString()}`,
        }));
      } catch (cause) {
        setStatus((current) => ({
          ...current,
          [connection.id]: cause instanceof Error ? cause.message : String(cause),
        }));
      }
    },
    [composition.dataFields, composition.layers, setValues],
  );

  useEffect(() => {
    const timers = connections.flatMap((connection) => {
      if (!connection.enabled || connection.source !== 'url' || connection.refreshMs <= 0)
        return [];
      void refresh(connection);
      return [window.setInterval(() => void refresh(connection), connection.refreshMs)];
    });
    return () => timers.forEach(window.clearInterval);
  }, [connections, refresh]);

  return (
    <CollapsibleSection
      sectionId="data.connections"
      title="Data Connections"
      className="data-panel-section"
      actions={
        <button type="button" onClick={() => add()}>
          + Add Connection
        </button>
      }
    >
      <p className="inspector-hint">
        Editor preview only. Exported OGraf packages still receive ordinary GDD data from playout.
      </p>
      {connections.length === 0 ? (
        <p className="panel-placeholder">No CSV or JSON preview connection yet.</p>
      ) : (
        connections.map((connection) => (
          <div className="data-field-schema-node" key={connection.id}>
            <input
              aria-label="Data connection name"
              value={connection.name}
              onChange={(event) => update(connection.id, { name: event.target.value })}
            />
            <label>
              Format
              <select
                value={connection.format}
                onChange={(event) =>
                  update(connection.id, { format: event.target.value as 'json' | 'csv' })
                }
              >
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
              </select>
            </label>
            <label>
              Source
              <select
                value={connection.source}
                onChange={(event) =>
                  update(connection.id, { source: event.target.value as 'url' | 'embedded' })
                }
              >
                <option value="url">URL</option>
                <option value="embedded">Imported / pasted</option>
              </select>
            </label>
            {connection.source === 'url' ? (
              <label>
                URL
                <input
                  type="url"
                  placeholder="https://example.com/data.json"
                  value={connection.url}
                  onChange={(event) => update(connection.id, { url: event.target.value })}
                />
              </label>
            ) : (
              <>
                <textarea
                  aria-label="Embedded data"
                  rows={4}
                  value={connection.embeddedText}
                  onChange={(event) => update(connection.id, { embeddedText: event.target.value })}
                />
                <button
                  type="button"
                  onClick={() => fileInputs.current.get(connection.id)?.click()}
                >
                  Import CSV / JSON…
                </button>
                <input
                  ref={(element) => {
                    if (element) fileInputs.current.set(connection.id, element);
                    else fileInputs.current.delete(connection.id);
                  }}
                  type="file"
                  accept=".json,.csv,application/json,text/csv"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    void file.text().then((embeddedText) =>
                      update(connection.id, {
                        embeddedText,
                        format: file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json',
                      }),
                    );
                  }}
                />
              </>
            )}
            <label>
              Refresh ms
              <input
                type="number"
                min={0}
                value={connection.refreshMs}
                onChange={(event) =>
                  update(connection.id, { refreshMs: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Missing data
              <select
                value={connection.missing}
                onChange={(event) =>
                  update(connection.id, {
                    missing: event.target.value as typeof connection.missing,
                  })
                }
              >
                <option value="default">Use field default</option>
                <option value="empty">Use empty value</option>
                <option value="keep-last">Keep last value</option>
              </select>
            </label>
            {composition.dataFields.map((field) => {
              const mapping = connection.mappings.find(
                (candidate) => candidate.fieldId === field.id,
              );
              return (
                <label key={field.id}>
                  {field.label || field.key} path / column
                  <input
                    value={mapping?.sourcePath ?? ''}
                    placeholder={field.key}
                    onChange={(event) => {
                      const others = connection.mappings.filter(
                        (candidate) => candidate.fieldId !== field.id,
                      );
                      update(connection.id, {
                        mappings: event.target.value
                          ? [...others, { fieldId: field.id, sourcePath: event.target.value }]
                          : others,
                      });
                    }}
                  />
                </label>
              );
            })}
            <div className="resources-tree-actions wrap">
              <button type="button" onClick={() => void refresh(connection)}>
                Refresh now
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={connection.enabled}
                  onChange={(event) => update(connection.id, { enabled: event.target.checked })}
                />
                Enabled
              </label>
              <button
                type="button"
                className="data-table-delete"
                onClick={() => remove(connection.id)}
              >
                Remove
              </button>
            </div>
            {status[connection.id] ? (
              <p className="inspector-hint">{status[connection.id]}</p>
            ) : null}
          </div>
        ))
      )}
    </CollapsibleSection>
  );
}
