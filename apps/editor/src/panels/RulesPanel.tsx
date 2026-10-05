import { useEffect, useMemo, useState } from 'react';
import {
  createVisualRuleCondition,
  isVisualRuleState,
  isVisualRuleStateAction,
  parseShaderAnimationProperty,
  visualRuleConditionsHold,
  visualRuleList,
  visualRuleRange,
  visualRuleTrigger,
  VISUAL_RULE_EVENT_OPERATORS,
  VISUAL_RULE_UNARY_OPERATORS,
  VISUAL_RULE_VISIBILITY_KEY,
  type FieldDefinition,
  type Layer,
  type LayerVisualRule,
  type VisualRuleAction,
  type VisualRuleCondition,
  type VisualRuleOperator,
  type VisualRuleTrigger,
} from '@ograf-editor/scene-model';
import { bindableProperties, editorVisualRuleEngine } from '../state/dataBinding';
import { useProjectStore, useActiveComposition } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTestDataStore } from '../state/testDataStore';
import { isSoundEventCue, soundEventSource } from '../state/soundEvents';
import { Panel } from './Panel';
import './RulesPanel.css';

const TRIGGER_GROUPS: Array<{ label: string; options: Array<[VisualRuleTrigger, string]> }> = [
  { label: 'Data', options: [['data', 'Data condition']] },
  {
    label: 'Pointer',
    options: [
      ['hover', 'While hovered'],
      ['click', 'Clicked'],
      ['double-click', 'Double-clicked'],
      ['pointer-enter', 'Mouse over'],
      ['pointer-leave', 'Mouse leave'],
    ],
  },
  {
    label: 'Playout',
    options: [
      ['play', 'Played in'],
      ['step', 'Step reached'],
      ['stop', 'Taken out'],
      ['custom-action', 'Custom action ran'],
    ],
  },
];

const OPERATOR_OPTIONS: Array<[VisualRuleOperator, string]> = [
  ['equals', 'Equals'],
  ['not-equals', 'Does not equal'],
  ['greater-than', 'Greater than'],
  ['greater-or-equal', 'At least'],
  ['less-than', 'Less than'],
  ['less-or-equal', 'At most'],
  ['between', 'Between'],
  ['contains', 'Contains'],
  ['not-contains', 'Does not contain'],
  ['starts-with', 'Starts with'],
  ['ends-with', 'Ends with'],
  ['one-of', 'Is one of'],
  ['not-one-of', 'Is not one of'],
  ['empty', 'Is empty'],
  ['not-empty', 'Is not empty'],
  ['changed', 'Changed'],
  ['increased', 'Increased'],
  ['decreased', 'Decreased'],
];

const TEXT_OPERATORS = new Set<VisualRuleOperator>([
  'equals',
  'not-equals',
  'contains',
  'not-contains',
  'starts-with',
  'ends-with',
  'one-of',
  'not-one-of',
]);
const NUMERIC_OPERATORS = new Set<VisualRuleOperator>([
  'greater-than',
  'less-than',
  'greater-or-equal',
  'less-or-equal',
]);
const LIST_OPERATORS = new Set<VisualRuleOperator>(['between', 'one-of', 'not-one-of']);
const NUMERIC_FIELD_TYPES = new Set(['number', 'integer', 'percentage', 'duration-ms']);

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

/**
 * Stores typed values: numbers for numeric fields and comparisons, booleans for switches. The
 * engine also coerces when comparing, so older text values keep matching.
 */
function typedConditionValue(
  field: FieldDefinition | undefined,
  condition: VisualRuleCondition,
  raw: string,
): unknown {
  const numericField =
    condition.sourcePath.length === 0 && field !== undefined && NUMERIC_FIELD_TYPES.has(field.type);
  if (
    NUMERIC_OPERATORS.has(condition.operator) ||
    (numericField && (condition.operator === 'equals' || condition.operator === 'not-equals'))
  ) {
    const parsed = Number(raw);
    return raw.trim() !== '' && Number.isFinite(parsed) ? parsed : raw;
  }
  if (condition.sourcePath.length === 0 && field?.type === 'boolean')
    return raw === 'true' ? true : raw === 'false' ? false : raw;
  return raw;
}

function frameInput(value: number | undefined): string {
  return value ? String(value) : '';
}

function framesFrom(raw: string): number | undefined {
  const frames = Math.max(0, Math.round(Number(raw)));
  return Number.isFinite(frames) && frames > 0 ? frames : undefined;
}

/** A patch that may clear optional keys by setting them to `undefined`. */
type Loose<T> = { [K in keyof T]?: T[K] | undefined };

interface ConditionEditorProps {
  condition: VisualRuleCondition;
  fields: FieldDefinition[];
  allowChangeOperators: boolean;
  onChange: (patch: Loose<VisualRuleCondition>) => void;
  labelPrefix?: string;
}

function ConditionEditor({
  condition,
  fields,
  allowChangeOperators,
  onChange,
  labelPrefix = 'Condition',
}: ConditionEditorProps) {
  const field = fields.find((candidate) => candidate.id === condition.fieldId);
  const unary = VISUAL_RULE_UNARY_OPERATORS.has(condition.operator);
  const list = LIST_OPERATORS.has(condition.operator);
  const range = condition.operator === 'between' ? visualRuleRange(condition.value) : null;
  return (
    <>
      <select
        aria-label={`${labelPrefix} field`}
        value={condition.fieldId}
        onChange={(event) => onChange({ fieldId: event.target.value })}
      >
        {fields.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.label || candidate.key}
          </option>
        ))}
      </select>
      <select
        aria-label={`${labelPrefix} operator`}
        value={condition.operator}
        onChange={(event) => {
          const operator = event.target.value as VisualRuleOperator;
          onChange({
            operator,
            ...(LIST_OPERATORS.has(operator) ? { compareFieldId: undefined } : {}),
          });
        }}
      >
        {OPERATOR_OPTIONS.filter(
          ([operator]) => allowChangeOperators || !VISUAL_RULE_EVENT_OPERATORS.has(operator),
        ).map(([operator, label]) => (
          <option key={operator} value={operator}>
            {label}
          </option>
        ))}
      </select>
      {unary ? null : (
        <>
          {list ? null : (
            <select
              className="rules-compare-source"
              aria-label={`${labelPrefix} compares with`}
              title="Compare with a value or with another data field"
              value={condition.compareFieldId ?? ''}
              onChange={(event) => onChange({ compareFieldId: event.target.value || undefined })}
            >
              <option value="">value</option>
              {fields
                .filter((candidate) => candidate.id !== condition.fieldId)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    ▸ {candidate.label || candidate.key}
                  </option>
                ))}
            </select>
          )}
          {condition.compareFieldId ? null : condition.operator === 'between' ? (
            <span className="rules-range">
              <input
                aria-label={`${labelPrefix} minimum`}
                type="number"
                value={range ? range[0] : ''}
                onChange={(event) =>
                  onChange({ value: [Number(event.target.value), range ? range[1] : 0] })
                }
              />
              <input
                aria-label={`${labelPrefix} maximum`}
                type="number"
                value={range ? range[1] : ''}
                onChange={(event) =>
                  onChange({ value: [range ? range[0] : 0, Number(event.target.value)] })
                }
              />
            </span>
          ) : condition.sourcePath.length === 0 &&
            field?.type === 'boolean' &&
            (condition.operator === 'equals' || condition.operator === 'not-equals') ? (
            <select
              aria-label="Comparison value"
              value={String(condition.value ?? 'true')}
              onChange={(event) =>
                onChange({ value: typedConditionValue(field, condition, event.target.value) })
              }
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <input
              aria-label="Comparison value"
              placeholder={list ? 'A, B, C' : undefined}
              value={
                list && Array.isArray(condition.value)
                  ? visualRuleList(condition.value).join(', ')
                  : String(condition.value ?? '')
              }
              onChange={(event) =>
                onChange({
                  value: list
                    ? event.target.value
                    : typedConditionValue(field, condition, event.target.value),
                })
              }
            />
          )}
          {TEXT_OPERATORS.has(condition.operator) ? (
            <button
              type="button"
              className={`rules-ignore-case ${condition.ignoreCase ? 'active' : ''}`}
              aria-pressed={Boolean(condition.ignoreCase)}
              aria-label="Ignore letter case"
              title={condition.ignoreCase ? 'Ignoring letter case' : 'Matching letter case'}
              onClick={() => onChange({ ignoreCase: !condition.ignoreCase || undefined })}
            >
              Aa
            </button>
          ) : null}
        </>
      )}
    </>
  );
}

/** Pulls optional keys set to `undefined` out so they don't linger in the document. */
function withoutUndefined<T extends object>(value: Loose<T>): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function RulesPanel() {
  const composition = useActiveComposition();
  const selectedLayerId = useSelectionStore((state) => state.selectedLayerId);
  const testValues = useTestDataStore((state) => state.values);
  const simulateRule = useTestDataStore((state) => state.simulateVisualRule);
  const resetSimulation = useTestDataStore((state) => state.resetVisualRuleSimulation);
  const simulated = useTestDataStore(
    (state) => Object.keys(state.visualRuleStateOverrides).length > 0,
  );
  const addRule = useProjectStore((state) => state.addLayerVisualRule);
  const updateRule = useProjectStore((state) => state.updateLayerVisualRule);
  const replaceRule = useProjectStore((state) => state.replaceLayerVisualRule);
  const moveRule = useProjectStore((state) => state.moveLayerVisualRule);
  const duplicateRule = useProjectStore((state) => state.duplicateLayerVisualRule);
  const removeRule = useProjectStore((state) => state.removeLayerVisualRule);
  const addRuleSound = useProjectStore((state) => state.addRuleSoundFromAsset);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [newTrigger, setNewTrigger] = useState<VisualRuleTrigger>('data');
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
  const engine = useMemo(
    () => editorVisualRuleEngine(composition.layers, composition.dataFields),
    [composition.layers, composition.dataFields],
  );
  const layerById = useMemo(
    () => new Map(composition.layers.map((layer) => [layer.id, layer])),
    [composition.layers],
  );

  // Which matched state rules lose a property to a later rule on the same target.
  const overriddenBy = useMemo(() => {
    const lastWriter = new Map<string, { ruleId: string; name: string }>();
    const losers = new Map<string, string[]>();
    for (const { layer, rule } of entries) {
      if (!rule.enabled || !isVisualRuleState(rule) || visualRuleTrigger(rule) === 'hover')
        continue;
      if (!visualRuleConditionsHold(engine.reader, rule, layer.id, testValues)) continue;
      for (const action of rule.actions) {
        if (!isVisualRuleStateAction(action) || action.type === 'toggle-visibility') continue;
        const target = action.targetLayerId || layer.id;
        const key = `${target}\u0000${action.type === 'property' ? action.targetProperty : VISUAL_RULE_VISIBILITY_KEY}`;
        const previous = lastWriter.get(key);
        if (previous && previous.ruleId !== rule.id) {
          const targetName = layerById.get(target)?.name ?? 'object';
          losers.set(previous.ruleId, [
            ...(losers.get(previous.ruleId) ?? []),
            `"${rule.name}" sets the same ${action.type === 'property' ? action.targetProperty : 'visibility'} on ${targetName}`,
          ]);
        }
        lastWriter.set(key, { ruleId: rule.id, name: rule.name });
      }
    }
    return losers;
  }, [engine, entries, layerById, testValues]);

  const visibleEntries = selectedOnly
    ? entries.filter(
        (entry) =>
          entry.layer.id === selectedLayerId ||
          entry.rule.actions.some(
            (action) => isVisualRuleStateAction(action) && action.targetLayerId === selectedLayerId,
          ),
      )
    : entries;
  const targetLayer = composition.layers.find((layer) => layer.id === targetLayerId);
  const mediaCues = (composition.mediaCues ?? []).filter((cue) => !isSoundEventCue(cue));
  // Rules can play any audio cue, including manual ones that never play from the timeline.
  const ruleSounds = (composition.mediaCues ?? []).filter(
    (cue) => isSoundEventCue(cue) || soundEventSource(cue) !== null,
  );
  // Imported audio without a cue yet; choosing one creates a rule-only sound for it.
  const uncuedAudio = composition.assets.filter(
    (asset) =>
      asset.kind === 'audio' &&
      !(composition.mediaCues ?? []).some((cue) =>
        cue.sources.some((source) => source.kind === 'clip' && source.src === `asset:${asset.id}`),
      ),
  );
  const steps = composition.keyframes.filter((keyframe) => keyframe.role === 'step');
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

  const renderTriggerOptions = () =>
    TRIGGER_GROUPS.map((group) => (
      <optgroup key={group.label} label={group.label}>
        {group.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </optgroup>
    ));

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
          <select
            className="rules-toolbar-trigger"
            aria-label="New rule trigger"
            value={newTrigger}
            onChange={(event) => setNewTrigger(event.target.value as VisualRuleTrigger)}
          >
            {renderTriggerOptions()}
          </select>
          <button
            type="button"
            disabled={!targetLayer || targetLayer.isLocked}
            onClick={() => targetLayerId && addRule(targetLayerId, newTrigger)}
          >
            + Add Rule
          </button>
          {simulated ? (
            <button
              type="button"
              className="rules-reset-simulation"
              title="Clear rule results tried on the canvas"
              onClick={resetSimulation}
            >
              Reset test
            </button>
          ) : null}
        </div>

        {visibleEntries.length === 0 ? (
          <p className="panel-placeholder">
            {selectedOnly ? 'No rules affect the selected object.' : 'No rules yet.'}
          </p>
        ) : (
          <div className="rules-list">
            {visibleEntries.map(({ layer, rule, index }) => {
              const trigger = visualRuleTrigger(rule);
              const isData = trigger === 'data';
              const state = isVisualRuleState(rule);
              const matches =
                trigger !== 'data'
                  ? null
                  : state
                    ? visualRuleConditionsHold(engine.reader, rule, layer.id, testValues)
                    : null;
              const overridden = overriddenBy.get(rule.id);
              const guards = rule.conditions ?? [];
              const conditionCount = (isData ? 1 : 0) + guards.length;
              const setGuard = (guardIndex: number, patch: Loose<VisualRuleCondition>) =>
                updateRule(layer.id, rule.id, {
                  conditions: guards.map((guard, candidate) =>
                    candidate === guardIndex
                      ? withoutUndefined<VisualRuleCondition>({ ...guard, ...patch })
                      : guard,
                  ),
                });
              const actionTypes: Array<[VisualRuleAction['type'], string]> = [
                ['visibility', 'Show / hide object'],
                ...(state
                  ? []
                  : ([['toggle-visibility', 'Toggle object visibility']] as Array<
                      [VisualRuleAction['type'], string]
                    >)),
                ['property', 'Set object or shader property'],
                ['play-sound', 'Play Sound Event'],
                ['take-media', 'Start video / live source'],
                ['shader-animation', 'Play Shader Animation'],
                ['custom-action', 'Trigger Custom Action'],
              ];
              return (
                <section
                  className={`rules-card ${overridden ? 'overridden' : ''}`}
                  key={`${layer.id}:${rule.id}`}
                >
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
                    {overridden ? (
                      <span
                        className="rules-match overridden"
                        title={`Overridden: ${overridden.join('; ')}`}
                      >
                        Overridden
                      </span>
                    ) : null}
                    <span
                      className={`rules-match ${matches === null ? 'event' : matches ? 'matched' : ''}`}
                    >
                      {matches === null ? 'Event' : matches ? 'Matched' : 'Not matched'}
                    </span>
                    {state && trigger !== 'hover' ? null : (
                      <button
                        type="button"
                        className="rules-simulate"
                        aria-label={`Try ${rule.name} on the canvas`}
                        title="Try this rule's show/hide and property actions on the canvas"
                        onClick={() =>
                          simulateRule(layer.id, rule, composition.layers, composition.dataFields)
                        }
                      >
                        ▶
                      </button>
                    )}
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
                    <div className="rules-conditions">
                      <div className="rules-condition-grid">
                        <span className="rules-when">When</span>
                        <select
                          className="rules-trigger"
                          aria-label="Rule trigger"
                          value={trigger}
                          onChange={(event) => {
                            const next = event.target.value as VisualRuleTrigger;
                            const becomesState = next === 'data' || next === 'hover';
                            replaceRule(
                              layer.id,
                              rule.id,
                              withoutUndefined<LayerVisualRule>({
                                ...rule,
                                trigger: next,
                                eventId:
                                  next === 'custom-action'
                                    ? (composition.customActions[0]?.actionId ?? '')
                                    : undefined,
                                delayFrames: becomesState ? undefined : rule.delayFrames,
                                actions: becomesState
                                  ? rule.actions.map((action) =>
                                      action.type === 'toggle-visibility'
                                        ? withoutUndefined<VisualRuleAction>({
                                            type: 'visibility' as const,
                                            visible: true,
                                            targetLayerId: action.targetLayerId,
                                            transitionFrames: action.transitionFrames,
                                          })
                                        : action,
                                    )
                                  : rule.actions,
                              }),
                            );
                          }}
                        >
                          {renderTriggerOptions()}
                        </select>
                        {isData ? (
                          <ConditionEditor
                            condition={rule}
                            fields={composition.dataFields}
                            allowChangeOperators
                            onChange={(patch) =>
                              replaceRule(
                                layer.id,
                                rule.id,
                                withoutUndefined<LayerVisualRule>({ ...rule, ...patch }),
                              )
                            }
                          />
                        ) : trigger === 'step' ? (
                          <select
                            aria-label="Step"
                            value={rule.eventId ?? ''}
                            onChange={(event) =>
                              replaceRule(
                                layer.id,
                                rule.id,
                                withoutUndefined<LayerVisualRule>({
                                  ...rule,
                                  eventId: event.target.value || undefined,
                                }),
                              )
                            }
                          >
                            <option value="">Any step</option>
                            {steps.map((step) => (
                              <option key={step.id} value={step.id}>
                                {step.name}
                              </option>
                            ))}
                          </select>
                        ) : trigger === 'custom-action' ? (
                          <select
                            aria-label="Custom action"
                            value={rule.eventId ?? ''}
                            onChange={(event) =>
                              updateRule(layer.id, rule.id, { eventId: event.target.value })
                            }
                          >
                            <option value="">Choose action</option>
                            {composition.customActions.map((candidate) => (
                              <option key={candidate.id} value={candidate.actionId}>
                                {candidate.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {state ? null : (
                          <label className="rules-frames" title="Wait before running the actions">
                            after
                            <input
                              aria-label="Delay in frames"
                              type="number"
                              min={0}
                              placeholder="0"
                              value={frameInput(rule.delayFrames)}
                              onChange={(event) =>
                                replaceRule(
                                  layer.id,
                                  rule.id,
                                  withoutUndefined<LayerVisualRule>({
                                    ...rule,
                                    delayFrames: framesFrom(event.target.value),
                                  }),
                                )
                              }
                            />
                            fr
                          </label>
                        )}
                      </div>
                      {guards.map((guard, guardIndex) => (
                        <div
                          className="rules-condition-grid rules-extra-condition"
                          key={`${rule.id}:condition:${guardIndex}`}
                        >
                          {guardIndex === 0 && !isData ? (
                            <span className="rules-when">only if</span>
                          ) : (
                            <select
                              className="rules-match-mode"
                              aria-label="Combine conditions"
                              value={rule.match ?? 'all'}
                              onChange={(event) =>
                                updateRule(layer.id, rule.id, {
                                  match: event.target.value as 'all' | 'any',
                                })
                              }
                            >
                              <option value="all">and</option>
                              <option value="any">or</option>
                            </select>
                          )}
                          <ConditionEditor
                            condition={guard}
                            fields={composition.dataFields}
                            allowChangeOperators={isData}
                            labelPrefix={`Condition ${guardIndex + 2}`}
                            onChange={(patch) => setGuard(guardIndex, patch)}
                          />
                          <button
                            type="button"
                            aria-label="Remove condition"
                            onClick={() => {
                              const conditions = guards.filter(
                                (_, candidate) => candidate !== guardIndex,
                              );
                              replaceRule(
                                layer.id,
                                rule.id,
                                withoutUndefined<LayerVisualRule>({
                                  ...rule,
                                  conditions: conditions.length ? conditions : undefined,
                                  match: conditions.length ? rule.match : undefined,
                                }),
                              );
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="rules-add-condition"
                        disabled={composition.dataFields.length === 0}
                        title={
                          composition.dataFields.length === 0
                            ? 'Add a data field first'
                            : conditionCount === 0
                              ? 'Only run when a data condition holds'
                              : 'Add another condition'
                        }
                        onClick={() =>
                          updateRule(layer.id, rule.id, {
                            conditions: [
                              ...guards,
                              createVisualRuleCondition({
                                fieldId: composition.dataFields[0]?.id ?? '',
                                operator: 'not-empty',
                              }),
                            ],
                          })
                        }
                      >
                        + {conditionCount === 0 ? 'condition' : isData ? 'and / or' : 'condition'}
                      </button>
                    </div>

                    <span className="rules-arrow">→</span>
                    <div className="rules-actions">
                      {rule.actions.map((action, actionIndex) => {
                        const actionTarget = isVisualRuleStateAction(action)
                          ? (layerById.get(action.targetLayerId || layer.id) ?? layer)
                          : layer;
                        const setAction = (next: Loose<VisualRuleAction>) =>
                          updateRule(layer.id, rule.id, {
                            actions: replaceAction(
                              rule,
                              actionIndex,
                              withoutUndefined<VisualRuleAction>(next),
                            ),
                          });
                        return (
                          <div className="rules-action" key={`${rule.id}:action:${actionIndex}`}>
                            <select
                              aria-label="Rule action type"
                              value={action.type}
                              onChange={(event) => {
                                const type = event.target.value as VisualRuleAction['type'];
                                const keep = isVisualRuleStateAction(action)
                                  ? {
                                      targetLayerId: action.targetLayerId,
                                      transitionFrames: action.transitionFrames,
                                    }
                                  : {};
                                const next: Loose<VisualRuleAction> =
                                  type === 'property'
                                    ? { type, targetProperty: 'fill', value: '#ffffff', ...keep }
                                    : type === 'visibility'
                                      ? { type, visible: true, ...keep }
                                      : type === 'toggle-visibility'
                                        ? { type, ...keep }
                                        : type === 'play-sound'
                                          ? { type, cueId: ruleSounds[0]?.id ?? '' }
                                          : type === 'take-media'
                                            ? { type, cueId: mediaCues[0]?.id ?? '' }
                                            : type === 'shader-animation'
                                              ? { type, actionId: shaderActions[0]?.actionId ?? '' }
                                              : {
                                                  type: 'custom-action',
                                                  actionId:
                                                    composition.customActions[0]?.actionId ?? '',
                                                };
                                setAction(next);
                              }}
                            >
                              {actionTypes.map(([type, label]) => (
                                <option key={type} value={type}>
                                  {label}
                                </option>
                              ))}
                            </select>

                            {isVisualRuleStateAction(action) ? (
                              <select
                                className="rules-action-target"
                                aria-label="Action target object"
                                title="Object this action changes"
                                value={action.targetLayerId ?? ''}
                                onChange={(event) =>
                                  setAction({
                                    ...action,
                                    targetLayerId: event.target.value || undefined,
                                  })
                                }
                              >
                                <option value="">{layer.name} (this)</option>
                                {composition.layers
                                  .filter((candidate: Layer) => candidate.id !== layer.id)
                                  .map((candidate) => (
                                    <option key={candidate.id} value={candidate.id}>
                                      {candidate.name}
                                    </option>
                                  ))}
                              </select>
                            ) : null}

                            {action.type === 'visibility' ? (
                              <select
                                aria-label="Show or hide"
                                value={action.visible ? 'show' : 'hide'}
                                onChange={(event) =>
                                  setAction({ ...action, visible: event.target.value === 'show' })
                                }
                              >
                                <option value="show">Show</option>
                                <option value="hide">Hide</option>
                              </select>
                            ) : action.type === 'toggle-visibility' ? null : action.type ===
                              'property' ? (
                              <>
                                <select
                                  aria-label="Action property"
                                  value={action.targetProperty}
                                  onChange={(event) =>
                                    setAction({ ...action, targetProperty: event.target.value })
                                  }
                                >
                                  {bindableProperties(
                                    actionTarget.element,
                                    actionTarget.effects,
                                  ).map((property) => (
                                    <option key={property.value} value={property.value}>
                                      {property.label}
                                    </option>
                                  ))}
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
                                      setAction({ ...action, value: event.target.value })
                                    }
                                  />
                                ) : (
                                  <input
                                    aria-label="Action value"
                                    value={String(action.value ?? '')}
                                    onChange={(event) =>
                                      setAction({ ...action, value: event.target.value })
                                    }
                                  />
                                )}
                                {parseShaderAnimationProperty(action.targetProperty) ? (
                                  <small>Shader parameter</small>
                                ) : null}
                              </>
                            ) : action.type === 'play-sound' ? (
                              <select
                                aria-label="Sound"
                                value={action.cueId}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setAction({
                                    ...action,
                                    cueId: value.startsWith('asset:')
                                      ? addRuleSound(value.slice('asset:'.length))
                                      : value,
                                  });
                                }}
                              >
                                <option value="">
                                  {ruleSounds.length || uncuedAudio.length
                                    ? 'Choose sound'
                                    : 'Import audio in Resources'}
                                </option>
                                {ruleSounds.map((cue) => (
                                  <option key={cue.id} value={cue.id}>
                                    {cue.name}
                                  </option>
                                ))}
                                {uncuedAudio.length ? (
                                  <optgroup label="Imported audio">
                                    {uncuedAudio.map((asset) => (
                                      <option key={asset.id} value={`asset:${asset.id}`}>
                                        {asset.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                ) : null}
                              </select>
                            ) : action.type === 'take-media' ? (
                              <select
                                value={action.cueId}
                                onChange={(event) =>
                                  setAction({ ...action, cueId: event.target.value })
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
                                  setAction({ ...action, actionId: event.target.value })
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

                            {isVisualRuleStateAction(action) ? (
                              <label
                                className="rules-frames"
                                title={
                                  action.type === 'property'
                                    ? 'Animate numbers and colours over this many frames'
                                    : 'Fade over this many frames'
                                }
                              >
                                {action.type === 'property' ? 'over' : 'fade'}
                                <input
                                  aria-label="Transition frames"
                                  type="number"
                                  min={0}
                                  placeholder="0"
                                  value={frameInput(action.transitionFrames)}
                                  onChange={(event) =>
                                    setAction({
                                      ...action,
                                      transitionFrames: framesFrom(event.target.value),
                                    })
                                  }
                                />
                                fr
                              </label>
                            ) : null}

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
                        );
                      })}
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
