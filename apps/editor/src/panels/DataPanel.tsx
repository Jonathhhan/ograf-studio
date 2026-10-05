import { PropertyRow } from '../components/PropertyRow';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { DataConnectionsSection } from './DataConnectionsSection';
import { Fragment, useEffect, useMemo, useState } from 'react';

import {
  createFieldDefinition,
  defaultConstraintsForFieldType,
  defaultOptionsForFieldType,
  defaultValueForFieldType,
  type FieldConstraints,
  type FieldDefinition,
  type FieldOption,
  type FieldType,
} from '@ograf-editor/scene-model';
import { compileCustomActions, compileDataSchema } from '@ograf-editor/codegen';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useTestDataStore } from '../state/testDataStore';
import { resolvePreviewFieldValue } from '../state/previewFieldValue';

import { Panel } from './Panel';
import { DataFieldInput } from './DataFieldInput';
import './DataPanel.css';

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'duration-ms', label: 'Duration (ms)' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'color', label: 'Color' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image-url', label: 'Image URL' },
  { value: 'file-path', label: 'File Path' },
  { value: 'select', label: 'Select' },
  { value: 'select-multiple', label: 'Select Multiple' },
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'Array / Collection' },
];

function optionsText(options: FieldOption[]): string {
  return options.map((option) => `${option.value}|${option.label}`).join('\n');
}

function parseOptions(value: string): FieldOption[] {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const separator = line.indexOf('|');
      const optionValue = (separator >= 0 ? line.slice(0, separator) : line).trim();
      const label = (separator >= 0 ? line.slice(separator + 1) : optionValue).trim();
      return { value: optionValue, label: label || optionValue };
    })
    .filter((option) => option.value.length > 0);
}

function constraintsWith(
  field: FieldDefinition,
  key: keyof FieldConstraints,
  value: number | string | undefined,
): FieldConstraints {
  const constraints = { ...field.constraints };
  if (value === undefined || value === '') delete constraints[key];
  else (constraints as Record<string, number | string>)[key] = value;
  return constraints;
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

type DataTab = 'fields' | 'lists' | 'actions' | 'connections' | 'schema';

const DATA_TABS: Array<{ id: DataTab; label: string; intro: string }> = [
  {
    id: 'fields',
    label: 'Fields',
    intro: 'Values playout fills in, such as names and scores. Test values preview them here.',
  },
  {
    id: 'lists',
    label: 'Lists',
    intro: 'Repeat a grouped item once for each entry of a list field.',
  },
  {
    id: 'actions',
    label: 'Actions',
    intro: 'Named buttons playout can press, such as "Flash score". Rules can react to them.',
  },
  {
    id: 'connections',
    label: 'Connections',
    intro: 'Preview with JSON or CSV data. Exports still receive ordinary playout data.',
  },
  {
    id: 'schema',
    label: 'Schema',
    intro: 'What playout sees: the data form and actions this graphic declares.',
  },
];

const DATA_TAB_STORAGE_KEY = 'ograf-studio:data-tab';

function initialDataTab(): DataTab {
  try {
    const saved = window.localStorage.getItem(DATA_TAB_STORAGE_KEY);
    if (DATA_TABS.some((candidate) => candidate.id === saved)) return saved as DataTab;
  } catch {
    // Fall back to Fields.
  }
  return 'fields';
}

export function DataPanel() {
  const composition = useActiveComposition();
  const addDataField = useProjectStore((s) => s.addDataField);
  const moveDataField = useProjectStore((s) => s.moveDataField);
  const removeDataField = useProjectStore((s) => s.removeDataField);
  const updateDataField = useProjectStore((s) => s.updateDataField);
  const addCustomAction = useProjectStore((s) => s.addCustomAction);
  const removeCustomAction = useProjectStore((s) => s.removeCustomAction);
  const updateCustomAction = useProjectStore((s) => s.updateCustomAction);

  const testValues = useTestDataStore((s) => s.values);
  const setTestValue = useTestDataStore((s) => s.setValue);
  const resetTestData = useTestDataStore((s) => s.resetAll);

  const [addFieldType, setAddFieldType] = useState<FieldType>('text');
  const [tab, setTab] = useState<DataTab>(initialDataTab);
  const chooseTab = (next: DataTab) => {
    setTab(next);
    try {
      window.localStorage.setItem(DATA_TAB_STORAGE_KEY, next);
    } catch {
      // The tab still switches when storage is blocked.
    }
  };

  const schema = compileDataSchema(composition);
  const compiledCustomActions = compileCustomActions(composition);

  return (
    <Panel title="Data">
      <div className="data-panel">
        <div className="data-tabs" role="tablist" aria-label="Data sections">
          {DATA_TABS.map(({ id, label }) => {
            const count =
              id === 'fields'
                ? composition.dataFields.length
                : id === 'lists'
                  ? composition.runtimeCollections.length
                  : id === 'actions'
                    ? composition.customActions.length
                    : id === 'connections'
                      ? (composition.dataConnections ?? []).length
                      : 0;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'active' : ''}
                onClick={() => chooseTab(id)}
              >
                {label}
                {count > 0 ? <span className="data-tab-count">{count}</span> : null}
              </button>
            );
          })}
        </div>
        <p className="data-tab-intro">
          {DATA_TABS.find((candidate) => candidate.id === tab)!.intro}
        </p>

        {tab === 'fields' ? (
          <>
            <CollapsibleSection
              sectionId="data.fields"
              title="Fields"
              className="data-panel-section"
              actions={
                <div className="data-panel-add-row">
                  <select
                    value={addFieldType}
                    onChange={(e) => setAddFieldType(e.target.value as FieldType)}
                  >
                    {FIELD_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => addDataField(addFieldType)}>
                    {'+ Add Field'}
                  </button>
                </div>
              }
            >
              {composition.dataFields.length === 0 ? (
                <p className="panel-placeholder">
                  No fields yet — add one to make this template data-driven.
                </p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Label</th>
                      <th>Type</th>
                      <th>Default</th>
                      <th>Req.</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {composition.dataFields.map((field, index) => (
                      <Fragment key={field.id}>
                        <tr>
                          <td>
                            <input
                              type="text"
                              value={field.key}
                              onChange={(e) => updateDataField(field.id, { key: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={field.label}
                              onChange={(e) => updateDataField(field.id, { label: e.target.value })}
                            />
                          </td>
                          <td>
                            <select
                              value={field.type}
                              disabled={!!field.generatedShaderParameter}
                              onChange={(e) => {
                                const type = e.target.value as FieldType;
                                const options = defaultOptionsForFieldType(type);
                                const defaults = createFieldDefinition(type);
                                updateDataField(field.id, {
                                  type,
                                  options,
                                  constraints: defaultConstraintsForFieldType(type),
                                  fileExtensions: [],
                                  defaultValue: defaultValueForFieldType(type, options),
                                  properties: defaults.properties,
                                  items: defaults.items,
                                });
                              }}
                            >
                              {FIELD_TYPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <DataFieldInput
                              field={field}
                              value={field.defaultValue}
                              onChange={(value) =>
                                updateDataField(field.id, { defaultValue: value })
                              }
                            />
                            {field.type === 'color' && (
                              <label>
                                <span>Default from Brand Kit</span>
                                <select
                                  aria-label={`${field.label} Brand Kit default`}
                                  value={field.defaultTokenId ?? ''}
                                  onChange={(event) =>
                                    updateDataField(field.id, {
                                      defaultTokenId: event.target.value || null,
                                    })
                                  }
                                >
                                  <option value="">Custom default</option>
                                  {composition.designSystem.tokens
                                    .filter((token) => token.type === 'color')
                                    .map((token) => (
                                      <option key={token.id} value={token.id}>
                                        {token.name}
                                      </option>
                                    ))}
                                </select>
                              </label>
                            )}
                          </td>
                          <td className="data-table-checkbox-cell">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(e) =>
                                updateDataField(field.id, { required: e.target.checked })
                              }
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="data-table-move"
                              aria-label={`Move ${field.label || field.key} up`}
                              title="Move up"
                              disabled={index === 0}
                              onClick={() => moveDataField(field.id, -1)}
                            >
                              {'↑'}
                            </button>
                            <button
                              type="button"
                              className="data-table-move"
                              aria-label={`Move ${field.label || field.key} down`}
                              title="Move down"
                              disabled={index === composition.dataFields.length - 1}
                              onClick={() => moveDataField(field.id, 1)}
                            >
                              {'↓'}
                            </button>
                            <button
                              type="button"
                              className="data-table-delete"
                              disabled={!!field.generatedShaderParameter}
                              title={
                                field.generatedShaderParameter
                                  ? 'Remove its #pragma ograf declaration in the shader to remove this field.'
                                  : undefined
                              }
                              onClick={() => removeDataField(field.id)}
                            >
                              {'✕'}
                            </button>
                          </td>
                        </tr>
                        <tr className="data-field-details-row">
                          <td colSpan={6}>
                            {field.generatedShaderParameter ? (
                              <p className="inspector-hint">
                                Defined by #pragma ograf {field.generatedShaderParameter.name}. Edit
                                the shader declaration to change its type or range.
                              </p>
                            ) : (
                              <FieldDetails field={field} update={updateDataField} />
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </CollapsibleSection>
            {composition.dataFields.length > 0 && (
              <CollapsibleSection
                sectionId="data.test-data"
                title="Test Data (live preview)"
                className="data-panel-section"
                actions={
                  <button type="button" onClick={resetTestData}>
                    Reset to defaults
                  </button>
                }
              >
                <div className="test-data-form">
                  {composition.dataFields.map((field) => (
                    <PropertyRow
                      help={`${field.description ? field.description + ' ' : ''}Test value for ${field.label || field.key} (${field.type}). Updates the editor preview without changing the field default or exported source.`}
                      className="data-value-row"
                      key={field.id}
                    >
                      <span>{field.label || field.key}</span>
                      <DataFieldInput
                        field={field}
                        value={resolvePreviewFieldValue(field, testValues[field.id])!}
                        onChange={(value) =>
                          setTestValue(field.id, value, composition.layers, composition.dataFields)
                        }
                      />
                    </PropertyRow>
                  ))}
                </div>
              </CollapsibleSection>
            )}
          </>
        ) : null}
        {tab === 'lists' ? <RuntimeCollectionsSection /> : null}
        {tab === 'actions' ? (
          <>
            <CollapsibleSection
              sectionId="data.custom-actions"
              title="Custom Actions"
              className="data-panel-section"
              actions={
                <button type="button" onClick={() => addCustomAction()}>
                  {'+ Add Action'}
                </button>
              }
            >
              {composition.customActions.length === 0 ? (
                <p className="panel-placeholder">No custom actions yet.</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Action ID</th>
                      <th>Name</th>
                      <th>Description</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {composition.customActions.map((action) => (
                      <tr key={action.id}>
                        <td>
                          <input
                            type="text"
                            value={action.actionId}
                            onChange={(e) =>
                              updateCustomAction(action.id, { actionId: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={action.name}
                            onChange={(e) =>
                              updateCustomAction(action.id, { name: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={action.description}
                            onChange={(e) =>
                              updateCustomAction(action.id, { description: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="data-table-delete"
                            onClick={() => removeCustomAction(action.id)}
                          >
                            {'✕'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CollapsibleSection>
          </>
        ) : null}
        {tab === 'connections' ? <DataConnectionsSection /> : null}
        {tab === 'schema' ? (
          <>
            <CollapsibleSection
              sectionId="data.compiled-schema"
              title="Compiled Schema Preview"
              className="data-panel-section"
            >
              <pre className="data-json-preview">{JSON.stringify(schema, null, 2)}</pre>
              {compiledCustomActions.length > 0 && (
                <pre className="data-json-preview">
                  {JSON.stringify(compiledCustomActions, null, 2)}
                </pre>
              )}
            </CollapsibleSection>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function FieldDetails({
  field,
  update,
}: {
  field: FieldDefinition;
  update: (
    fieldId: string,
    patch: Partial<
      Pick<
        FieldDefinition,
        | 'description'
        | 'defaultValue'
        | 'options'
        | 'constraints'
        | 'fileExtensions'
        | 'properties'
        | 'items'
      >
    >,
  ) => void;
}) {
  const setConstraint = (key: keyof FieldConstraints, value: number | string | undefined) =>
    update(field.id, { constraints: constraintsWith(field, key, value) });
  return (
    <div className="data-field-details">
      <label>
        <span>Description</span>
        <input
          type="text"
          value={field.description}
          placeholder="Operator-facing help text"
          onChange={(event) => update(field.id, { description: event.target.value })}
        />
      </label>
      {(field.type === 'select' || field.type === 'select-multiple') && (
        <label className="data-field-options">
          <span>Options · one value|label per line</span>
          <textarea
            rows={Math.max(2, field.options.length)}
            value={optionsText(field.options)}
            onChange={(event) => {
              const options = parseOptions(event.target.value);
              const values = new Set(options.map((option) => option.value));
              const defaultValue =
                field.type === 'select-multiple'
                  ? Array.isArray(field.defaultValue)
                    ? field.defaultValue.filter(
                        (value): value is string => typeof value === 'string' && values.has(value),
                      )
                    : []
                  : typeof field.defaultValue === 'string' && values.has(field.defaultValue)
                    ? field.defaultValue
                    : (options[0]?.value ?? '');
              update(field.id, { options, defaultValue });
            }}
          />
        </label>
      )}
      {(field.type === 'file-path' || field.type === 'image-url') && (
        <label>
          <span>Allowed extensions</span>
          <input
            type="text"
            value={field.fileExtensions.join(', ')}
            placeholder="png, svg, jpg"
            onChange={(event) =>
              update(field.id, {
                fileExtensions: [
                  ...new Set(
                    event.target.value
                      .split(',')
                      .map((extension) => extension.trim().replace(/^\./, '').toLowerCase())
                      .filter(Boolean),
                  ),
                ],
              })
            }
          />
        </label>
      )}
      <div className="data-field-constraints">
        <label>
          <span>Min length</span>
          <input
            type="number"
            min={0}
            value={field.constraints.minLength ?? ''}
            onChange={(event) => setConstraint('minLength', optionalNumber(event.target.value))}
          />
        </label>
        <label>
          <span>Max length</span>
          <input
            type="number"
            min={0}
            value={field.constraints.maxLength ?? ''}
            onChange={(event) => setConstraint('maxLength', optionalNumber(event.target.value))}
          />
        </label>
        <label>
          <span>Minimum</span>
          <input
            type="number"
            value={field.constraints.minimum ?? ''}
            onChange={(event) => setConstraint('minimum', optionalNumber(event.target.value))}
          />
        </label>
        <label>
          <span>Maximum</span>
          <input
            type="number"
            value={field.constraints.maximum ?? ''}
            onChange={(event) => setConstraint('maximum', optionalNumber(event.target.value))}
          />
        </label>
        <label>
          <span>Step</span>
          <input
            type="number"
            min={0}
            value={field.constraints.step ?? ''}
            onChange={(event) => setConstraint('step', optionalNumber(event.target.value))}
          />
        </label>
        <label className="data-field-pattern">
          <span>Pattern</span>
          <input
            type="text"
            value={field.constraints.pattern ?? ''}
            placeholder="JSON Schema regular expression"
            onChange={(event) => setConstraint('pattern', event.target.value)}
          />
        </label>
        {field.type === 'array' && (
          <>
            <label>
              <span>Min items</span>
              <input
                type="number"
                min={0}
                value={field.constraints.minItems ?? ''}
                onChange={(event) => setConstraint('minItems', optionalNumber(event.target.value))}
              />
            </label>
            <label>
              <span>Max items / capacity</span>
              <input
                type="number"
                min={1}
                max={100}
                value={field.constraints.maxItems ?? ''}
                onChange={(event) => setConstraint('maxItems', optionalNumber(event.target.value))}
              />
            </label>
          </>
        )}
      </div>
      <FieldSchemaEditor field={field} update={update} />
    </div>
  );
}

function resetFieldType(field: FieldDefinition, type: FieldType): FieldDefinition {
  return createFieldDefinition(type, {
    id: field.id,
    key: field.key,
    label: field.label,
    description: field.description,
    required: field.required,
  });
}

function FieldSchemaEditor({
  field,
  update,
}: {
  field: FieldDefinition;
  update: (
    fieldId: string,
    patch: Partial<
      Pick<
        FieldDefinition,
        | 'description'
        | 'defaultValue'
        | 'options'
        | 'constraints'
        | 'fileExtensions'
        | 'properties'
        | 'items'
      >
    >,
  ) => void;
}) {
  if (field.type === 'object') {
    const replace = (id: string, next: FieldDefinition) =>
      update(field.id, {
        properties: field.properties.map((property) => (property.id === id ? next : property)),
      });
    return (
      <div className="data-field-schema-editor">
        <div className="data-panel-section-header">
          <strong>Object properties</strong>
          <button
            type="button"
            onClick={() => {
              const keys = new Set(field.properties.map((property) => property.key));
              let index = field.properties.length + 1;
              while (keys.has(`property_${index}`)) index++;
              const property = createFieldDefinition('text', {
                key: `property_${index}`,
                label: `Property ${index}`,
              });
              update(field.id, { properties: [...field.properties, property] });
            }}
          >
            + Property
          </button>
        </div>
        {field.properties.map((property) => (
          <div className="data-field-schema-node" key={property.id}>
            <div className="data-panel-add-row">
              <input
                aria-label="Property key"
                value={property.key}
                onChange={(event) => replace(property.id, { ...property, key: event.target.value })}
              />
              <input
                aria-label="Property label"
                value={property.label}
                onChange={(event) =>
                  replace(property.id, { ...property, label: event.target.value })
                }
              />
              <select
                aria-label="Property type"
                value={property.type}
                onChange={(event) =>
                  replace(property.id, resetFieldType(property, event.target.value as FieldType))
                }
              >
                {FIELD_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <label>
                <span>Required</span>
                <input
                  type="checkbox"
                  checked={property.required}
                  onChange={(event) =>
                    replace(property.id, { ...property, required: event.target.checked })
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  update(field.id, {
                    properties: field.properties.filter(
                      (candidate) => candidate.id !== property.id,
                    ),
                  })
                }
              >
                Remove
              </button>
            </div>
            <FieldDetails
              field={property}
              update={(_, patch) => replace(property.id, { ...property, ...patch })}
            />
          </div>
        ))}
      </div>
    );
  }
  if (field.type === 'array') {
    const item = field.items ?? createFieldDefinition('object', { key: 'item', label: 'Item' });
    return (
      <div className="data-field-schema-editor">
        <label>
          <span>Item schema</span>
          <select
            value={item.type}
            onChange={(event) =>
              update(field.id, {
                items: resetFieldType(item, event.target.value as FieldType),
              })
            }
          >
            {FIELD_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <FieldDetails
          field={item}
          update={(_, patch) => update(field.id, { items: { ...item, ...patch } })}
        />
      </div>
    );
  }
  return null;
}

function RuntimeCollectionsSection() {
  const composition = useActiveComposition();
  const addRuntimeCollection = useProjectStore((state) => state.addRuntimeCollection);
  const updateRuntimeCollection = useProjectStore((state) => state.updateRuntimeCollection);
  const removeRuntimeCollection = useProjectStore((state) => state.removeRuntimeCollection);
  const arrayFields = useMemo(
    () =>
      composition.dataFields.filter(
        (field) => field.type === 'array' && field.items?.type === 'object',
      ),
    [composition.dataFields],
  );
  const groups = useMemo(
    () =>
      [...new Set(composition.layers.map((layer) => layer.groupId).filter(Boolean))] as string[],
    [composition.layers],
  );
  const [fieldId, setFieldId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(72);
  const [capacity, setCapacity] = useState(12);
  useEffect(() => {
    if (!arrayFields.some((field) => field.id === fieldId)) setFieldId(arrayFields[0]?.id ?? '');
    if (!groups.includes(groupId)) setGroupId(groups[0] ?? '');
  }, [arrayFields, fieldId, groupId, groups]);
  return (
    <CollapsibleSection
      sectionId="data.runtime-collections"
      title="Repeating lists"
      className="data-panel-section"
    >
      <p className="panel-placeholder">
        Repeat a grouped item once for each entry of a list field. Every copy shares the item's
        animation; entries beyond the maximum are not shown.
      </p>
      <div className="data-panel-add-row">
        <select value={fieldId} onChange={(event) => setFieldId(event.target.value)}>
          {arrayFields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.label || field.key}
            </option>
          ))}
        </select>
        <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
          {groups.map((id) => (
            <option key={id} value={id}>
              {composition.layers.find((layer) => layer.groupId === id)?.name ?? id}
            </option>
          ))}
        </select>
        <label>
          X step
          <input
            type="number"
            value={offsetX}
            onChange={(event) => setOffsetX(Number(event.target.value))}
          />
        </label>
        <label>
          Y step
          <input
            type="number"
            value={offsetY}
            onChange={(event) => setOffsetY(Number(event.target.value))}
          />
        </label>
        <label>
          Max items
          <input
            type="number"
            min={1}
            max={100}
            value={capacity}
            onChange={(event) => setCapacity(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          disabled={
            !fieldId ||
            !groupId ||
            composition.runtimeCollections.some((item) => item.fieldId === fieldId)
          }
          onClick={() =>
            addRuntimeCollection(
              fieldId,
              composition.layers
                .filter((layer) => layer.groupId === groupId)
                .map((layer) => layer.id),
              { x: offsetX, y: offsetY },
              capacity,
            )
          }
        >
          + Make repeating list
        </button>
      </div>
      {composition.runtimeCollections.map((collection) => (
        <div className="data-field-schema-node" key={collection.id}>
          <input
            value={collection.name}
            onChange={(event) =>
              updateRuntimeCollection(collection.id, { name: event.target.value })
            }
          />
          <input
            aria-label="Collection X offset"
            type="number"
            value={collection.offsetPerItem.x}
            onChange={(event) =>
              updateRuntimeCollection(collection.id, {
                offsetPerItem: { ...collection.offsetPerItem, x: Number(event.target.value) },
              })
            }
          />
          <input
            aria-label="Collection Y offset"
            type="number"
            value={collection.offsetPerItem.y}
            onChange={(event) =>
              updateRuntimeCollection(collection.id, {
                offsetPerItem: { ...collection.offsetPerItem, y: Number(event.target.value) },
              })
            }
          />
          <input
            aria-label="Collection capacity"
            type="number"
            min={1}
            max={100}
            value={collection.capacity}
            onChange={(event) =>
              updateRuntimeCollection(collection.id, { capacity: Number(event.target.value) })
            }
          />
          <input
            aria-label="Collection stable key path"
            placeholder="id"
            value={(collection.itemKeyPath ?? []).join('.')}
            onChange={(event) =>
              updateRuntimeCollection(collection.id, {
                itemKeyPath: event.target.value.split('.').filter(Boolean),
              })
            }
          />
          <input
            aria-label="Collection sort path"
            placeholder="score"
            value={(collection.sortPath ?? []).join('.')}
            onChange={(event) =>
              updateRuntimeCollection(collection.id, {
                sortPath: event.target.value.split('.').filter(Boolean),
              })
            }
          />
          <select
            aria-label="Collection sort direction"
            value={collection.sortDirection ?? 'none'}
            onChange={(event) =>
              updateRuntimeCollection(collection.id, {
                sortDirection: event.target.value as 'none' | 'ascending' | 'descending',
              })
            }
          >
            <option value="none">Authored order</option>
            <option value="ascending">Ascending</option>
            <option value="descending">Descending</option>
          </select>
          <input
            aria-label="Collection page size"
            type="number"
            min={0}
            max={collection.capacity}
            value={collection.pageSize ?? 0}
            onChange={(event) =>
              updateRuntimeCollection(collection.id, { pageSize: Number(event.target.value) })
            }
          />
          <input
            aria-label="Collection page index"
            type="number"
            min={0}
            value={collection.page ?? 0}
            onChange={(event) =>
              updateRuntimeCollection(collection.id, { page: Number(event.target.value) })
            }
          />
          <span>truncate · {collection.prototypeLayerIds.length} prototype layers</span>
          <button type="button" onClick={() => removeRuntimeCollection(collection.id)}>
            Remove
          </button>
        </div>
      ))}
    </CollapsibleSection>
  );
}
