import { useEffect, useMemo, useState } from 'react';
import {
  parseShaderAnimationProperty,
  visualRuleMatches,
  visualRuleValue,
  type LayerVisualRule,
  type VisualRuleAction,
} from '@ograf-editor/scene-model';
import { bindableProperties } from '../state/dataBinding';
import { useProjectStore, useActiveComposition } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTestDataStore } from '../state/testDataStore';
import { isSoundEventCue } from '../state/soundEvents';
import { Panel } from './Panel';
import './RulesPanel.css';

const EVENT_OPERATORS = new Set(['changed', 'increased', 'decreased']);

function replaceAction(
  rule: LayerVisualRule,
  index: number,
  action: VisualRuleAction,
): VisualRuleAction[] {
  return rule.actions.map((candidate, candidateIndex) =>
    candidateIndex === index ? action : candidate,
  );
}

function isColorPropertyAction(action: Extract<VisualRuleAction, { type: 'property' }>): boolean {
  return (
    action.targetProperty === 'fill' ||
    action.targetProperty === 'color' ||
    action.targetProperty === 'strokeColor' ||
    action.targetProperty === 'dropShadowColor' ||
    /(?:color|\.color|\.r|\.g|\.b|\.a)$/i.test(action.targetProperty) ||
    /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(String(action.value ?? ''))
  );
}

export function RulesPanel() {
  const composition = useActiveComposition();
  const selectedLayerId = useSelectionStore((state) => state.selectedLayerId);
  const testValues = useTestDataStore((state) => state.values);
  const addRule = useProjectStore((state) => state.addLayerVisualRule);
  const updateRule = useProjectStore((state) => state.updateLayerVisualRule);
  const moveRule = useProjectStore((state) => state.moveLayerVisualRule);
  const duplicateRule = useProjectStore((state) => state.duplicateLayerVisualRule);
  const removeRule = useProjectStore((state) => state.removeLayerVisualRule);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [targetLayerId, setTargetLayerId] = useState(
    () => selectedLayerId ?? composition.layers[0]?.id ?? '',
  );

  useEffect(() => {
    if (selectedLayerId) setTargetLayerId(selectedLayerId);
    else if (!composition.layers.some((layer) => layer.id === targetLayerId))
      setTargetLayerId(composition.layers[0]?.id ?? '');
  }, [composition.layers, selectedLayerId, targetLayerId]);

  const entries = useMemo(
    () =>
      composition.layers.flatMap((layer) =>
        (layer.visualRules ?? []).map((rule, index) => ({ layer, rule, index })),
      ),
    [composition.layers],
  );
  const visibleEntries = selectedOnly
    ? entries.filter((entry) => entry.layer.id === selectedLayerId)
    : entries;
  const targetLayer = composition.layers.find((layer) => layer.id === targetLayerId);
  const soundEvents = (composition.mediaCues ?? []).filter(isSoundEventCue);
  const mediaCues = (composition.mediaCues ?? []).filter((cue) => !isSoundEventCue(cue));
  const shaderActionIds = new Set(
    composition.layers.flatMap((layer) => {
      const activation = layer.loop?.activation;
      if (
        activation?.type !== 'customAction' ||
        !Object.keys(layer.loop?.tracks ?? {}).some((property) =>
          Boolean(parseShaderAnimationProperty(property)),
        )
      ) {
        return [];
      }
      return [activation.customActionId];
    }),
  );
  const shaderActions = composition.customActions.filter((action) =>
    shaderActionIds.has(action.actionId),
  );

  return (
    <Panel title="Rules">
      <div className="rules-panel">
        <div className="rules-toolbar">
          <select
            aria-label="New rule target object"
            value={targetLayerId}
            onChange={(event) => setTargetLayerId(event.target.value)}
          >
            {composition.layers.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
                {layer.isLocked ? ' (locked)' : ''}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={selectedOnly}
              onChange={(event) => setSelectedOnly(event.target.checked)}
            />
            Selected object only
          </label>
          <button
            type="button"
            disabled={!targetLayer || targetLayer.isLocked || composition.dataFields.length === 0}
            onClick={() => targetLayerId && addRule(targetLayerId)}
          >
            + Add Rule
          </button>
        </div>

        {composition.dataFields.length === 0 ? (
          <p className="panel-placeholder">Add a Data field before creating rules.</p>
        ) : visibleEntries.length === 0 ? (
          <p className="panel-placeholder">
            {selectedOnly ? 'No rules affect the selected object.' : 'No rules yet.'}
          </p>
        ) : (
          <div className="rules-list">
            {visibleEntries.map(({ layer, rule, index }) => {
              const field = composition.dataFields.find(
                (candidate) => candidate.id === rule.fieldId,
              );
              const root = Object.hasOwn(testValues, rule.fieldId)
                ? testValues[rule.fieldId]
                : field?.defaultValue;
              const matches = EVENT_OPERATORS.has(rule.operator)
                ? null
                : visualRuleMatches(
                    rule.operator,
                    visualRuleValue(root, rule.sourcePath),
                    rule.value,
                  );
              const needsValue = ![
                'empty',
                'not-empty',
                'changed',
                'increased',
                'decreased',
              ].includes(rule.operator);
              return (
                <section className="rules-card" key={`${layer.id}:${rule.id}`}>
                  <header>
                    <label className="rules-enabled">
                      <input
                        aria-label={`Enable ${rule.name}`}
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(event) =>
                          updateRule(layer.id, rule.id, { enabled: event.target.checked })
                        }
                      />
                    </label>
                    <span className="rules-owner" title={layer.name}>
                      {layer.name}
                    </span>
                    <input
                      className="rules-name"
                      aria-label="Rule name"
                      value={rule.name}
                      onChange={(event) =>
                        updateRule(layer.id, rule.id, { name: event.target.value })
                      }
                    />
                    <span
                      className={`rules-match ${matches === null ? 'event' : matches ? 'matched' : ''}`}
                    >
                      {matches === null ? 'Event' : matches ? 'Matched' : 'Not matched'}
                    </span>
                    <button
                      type="button"
                      disabled={index === 0}
                      aria-label={`Move ${rule.name} up`}
                      onClick={() => moveRule(layer.id, rule.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === layer.visualRules.length - 1}
                      aria-label={`Move ${rule.name} down`}
                      onClick={() => moveRule(layer.id, rule.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="rules-duplicate-rule"
                      aria-label={`Duplicate ${rule.name}`}
                      title="Duplicate rule"
                      onClick={() => duplicateRule(layer.id, rule.id)}
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      className="rules-remove"
                      aria-label={`Remove ${rule.name}`}
                      onClick={() => removeRule(layer.id, rule.id)}
                    >
                      ×
                    </button>
                  </header>
                  <div className="rules-editor-row">
                    <div className="rules-condition-grid">
                      <span className="rules-when">When</span>
                      <select
                        aria-label="Condition field"
                        value={rule.fieldId}
                        onChange={(event) =>
                          updateRule(layer.id, rule.id, { fieldId: event.target.value })
                        }
                      >
                        {composition.dataFields.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.label || candidate.key}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Condition operator"
                        value={rule.operator}
                        onChange={(event) =>
                          updateRule(layer.id, rule.id, {
                            operator: event.target.value as LayerVisualRule['operator'],
                          })
                        }
                      >
                        <option value="equals">Equals</option>
                        <option value="not-equals">Does not equal</option>
                        <option value="empty">Is empty</option>
                        <option value="not-empty">Is not empty</option>
                        <option value="greater-than">Greater than</option>
                        <option value="less-than">Less than</option>
                        <option value="changed">Changed</option>
                        <option value="increased">Increased</option>
                        <option value="decreased">Decreased</option>
                      </select>
                      {needsValue ? (
                        <input
                          aria-label="Comparison value"
                          value={String(rule.value ?? '')}
                          onChange={(event) =>
                            updateRule(layer.id, rule.id, {
                              value: ['greater-than', 'less-than'].includes(rule.operator)
                                ? Number(event.target.value)
                                : event.target.value,
                            })
                          }
                        />
                      ) : null}
                    </div>

                    <span className="rules-arrow">→</span>
                    <div className="rules-actions">
                      {rule.actions.map((action, actionIndex) => (
                        <div className="rules-action" key={`${rule.id}:action:${actionIndex}`}>
                          <select
                            aria-label="Rule action type"
                            value={action.type}
                            onChange={(event) => {
                              const type = event.target.value as VisualRuleAction['type'];
                              const next: VisualRuleAction =
                                type === 'property'
                                  ? { type, targetProperty: 'fill', value: '#ffffff' }
                                  : type === 'visibility'
                                    ? { type, visible: true }
                                    : type === 'play-sound'
                                      ? { type, cueId: soundEvents[0]?.id ?? '' }
                                      : type === 'take-media'
                                        ? { type, cueId: mediaCues[0]?.id ?? '' }
                                        : type === 'shader-animation'
                                          ? { type, actionId: shaderActions[0]?.actionId ?? '' }
                                          : {
                                              type: 'custom-action',
                                              actionId:
                                                composition.customActions[0]?.actionId ?? '',
                                            };
                              updateRule(layer.id, rule.id, {
                                actions: replaceAction(rule, actionIndex, next),
                              });
                            }}
                          >
                            <option value="visibility">Show / hide object</option>
                            <option value="property">Set object or shader property</option>
                            <option value="play-sound">Play Sound Event</option>
                            <option value="take-media">Start video / live source</option>
                            <option value="shader-animation">Play Shader Animation</option>
                            <option value="custom-action">Trigger Custom Action</option>
                          </select>

                          {action.type === 'visibility' ? (
                            <select
                              value={action.visible ? 'show' : 'hide'}
                              onChange={(event) =>
                                updateRule(layer.id, rule.id, {
                                  actions: replaceAction(rule, actionIndex, {
                                    ...action,
                                    visible: event.target.value === 'show',
                                  }),
                                })
                              }
                            >
                              <option value="show">Show {layer.name}</option>
                              <option value="hide">Hide {layer.name}</option>
                            </select>
                          ) : action.type === 'property' ? (
                            <>
                              <select
                                value={action.targetProperty}
                                onChange={(event) =>
                                  updateRule(layer.id, rule.id, {
                                    actions: replaceAction(rule, actionIndex, {
                                      ...action,
                                      targetProperty: event.target.value,
                                    }),
                                  })
                                }
                              >
                                {bindableProperties(layer.element, layer.effects).map(
                                  (property) => (
                                    <option key={property.value} value={property.value}>
                                      {property.label}
                                    </option>
                                  ),
                                )}
                              </select>
                              {isColorPropertyAction(action) ? (
                                <input
                                  className="rules-color-value"
                                  aria-label="Action color"
                                  title="Choose action color"
                                  type="color"
                                  value={
                                    /^#[0-9a-f]{6}/i.test(String(action.value ?? ''))
                                      ? String(action.value).slice(0, 7)
                                      : '#ffffff'
                                  }
                                  onChange={(event) =>
                                    updateRule(layer.id, rule.id, {
                                      actions: replaceAction(rule, actionIndex, {
                                        ...action,
                                        value: event.target.value,
                                      }),
                                    })
                                  }
                                />
                              ) : (
                                <input
                                  aria-label="Action value"
                                  value={String(action.value ?? '')}
                                  onChange={(event) =>
                                    updateRule(layer.id, rule.id, {
                                      actions: replaceAction(rule, actionIndex, {
                                        ...action,
                                        value: event.target.value,
                                      }),
                                    })
                                  }
                                />
                              )}
                              {parseShaderAnimationProperty(action.targetProperty) ? (
                                <small>Shader parameter</small>
                              ) : null}
                            </>
                          ) : action.type === 'play-sound' ? (
                            <select
                              value={action.cueId}
                              onChange={(event) =>
                                updateRule(layer.id, rule.id, {
                                  actions: replaceAction(rule, actionIndex, {
                                    ...action,
                                    cueId: event.target.value,
                                  }),
                                })
                              }
                            >
                              <option value="">Choose sound</option>
                              {soundEvents.map((cue) => (
                                <option key={cue.id} value={cue.id}>
                                  {cue.name}
                                </option>
                              ))}
                            </select>
                          ) : action.type === 'take-media' ? (
                            <select
                              value={action.cueId}
                              onChange={(event) =>
                                updateRule(layer.id, rule.id, {
                                  actions: replaceAction(rule, actionIndex, {
                                    ...action,
                                    cueId: event.target.value,
                                  }),
                                })
                              }
                            >
                              <option value="">Choose video/live cue</option>
                              {mediaCues.map((cue) => (
                                <option key={cue.id} value={cue.id}>
                                  {cue.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <select
                              value={action.actionId}
                              onChange={(event) =>
                                updateRule(layer.id, rule.id, {
                                  actions: replaceAction(rule, actionIndex, {
                                    ...action,
                                    actionId: event.target.value,
                                  }),
                                })
                              }
                            >
                              <option value="">Choose action</option>
                              {(action.type === 'shader-animation'
                                ? shaderActions
                                : composition.customActions
                              ).map((candidate) => (
                                <option key={candidate.id} value={candidate.actionId}>
                                  {candidate.name}
                                </option>
                              ))}
                            </select>
                          )}

                          <button
                            type="button"
                            className="rules-duplicate-action"
                            aria-label="Duplicate action"
                            title="Duplicate action"
                            onClick={() => {
                              const actions = [...rule.actions];
                              actions.splice(actionIndex + 1, 0, structuredClone(action));
                              updateRule(layer.id, rule.id, { actions });
                            }}
                          >
                            ⧉
                          </button>
                          <button
                            type="button"
                            aria-label="Remove action"
                            disabled={rule.actions.length === 1}
                            onClick={() =>
                              updateRule(layer.id, rule.id, {
                                actions: rule.actions.filter(
                                  (_, candidateIndex) => candidateIndex !== actionIndex,
                                ),
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="rules-add-action"
                        title="Add another action"
                        onClick={() =>
                          updateRule(layer.id, rule.id, {
                            actions: [...rule.actions, { type: 'visibility', visible: true }],
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}
