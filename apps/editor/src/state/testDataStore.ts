import { create } from 'zustand';

import {
  applyVisualRuleEventActions,
  collectVisualRuleStates,
  firedVisualRuleDataRules,
  releaseVisualRuleOverrides,
  type FieldDefinition,
  type FieldValue,
  type Layer,
  type LayerVisualRule,
  type VisualRuleEffect,
} from '@ograf-editor/scene-model';
import { editorVisualRuleEngine } from './dataBinding';

export type TestValue = FieldValue;

/** Event-rule output on the Studio canvas: change rules, and rules simulated from the Rules panel. */
export type VisualRuleStateOverride = VisualRuleEffect;

function toMap(record: Record<string, VisualRuleEffect>): Map<string, VisualRuleEffect> {
  return new Map(Object.entries(record));
}

function visibleOf(
  layers: readonly Layer[],
  fields: readonly FieldDefinition[],
  values: Record<string, TestValue>,
  overrides: ReadonlyMap<string, VisualRuleEffect>,
): (layerId: string) => boolean {
  const states = collectVisualRuleStates(editorVisualRuleEngine(layers, fields), values);
  return (layerId) =>
    overrides.get(layerId)?.visibility ??
    states.get(layerId)?.visibility ??
    layers.find((layer) => layer.id === layerId)?.isVisible ??
    true;
}

export function updateVisualRuleStateOverrides(
  current: Record<string, VisualRuleStateOverride>,
  layers: Layer[],
  fields: FieldDefinition[],
  previousValues: Record<string, TestValue>,
  nextValues: Record<string, TestValue>,
): Record<string, VisualRuleStateOverride> {
  if (!layers.some((layer) => layer.visualRules?.length)) return current;
  const engine = editorVisualRuleEngine(layers, fields);
  // Delays belong to playback; the canvas shows where a change rule lands.
  let overrides = releaseVisualRuleOverrides(
    engine,
    toMap(current),
    { data: previousValues },
    { data: nextValues },
  );
  for (const fired of firedVisualRuleDataRules(engine, nextValues, previousValues)) {
    if (fired.entered) continue;
    overrides = applyVisualRuleEventActions(
      engine,
      overrides,
      fired.rule.actions,
      fired.hostLayerId,
      visibleOf(layers, fields, nextValues, overrides),
    );
  }
  const changed =
    overrides.size !== Object.keys(current).length ||
    [...overrides].some(([layerId, effect]) => current[layerId] !== effect);
  return changed ? Object.fromEntries(overrides) : current;
}

interface TestDataState {
  /** fieldId -> live preview value. Design-time only — never persisted, never undo-able. */
  values: Record<string, TestValue>;
  visualRuleStateOverrides: Record<string, VisualRuleStateOverride>;
  setValue: (
    fieldId: string,
    value: TestValue,
    layers?: Layer[],
    fields?: FieldDefinition[],
  ) => void;
  setValues: (
    values: Record<string, TestValue>,
    layers?: Layer[],
    fields?: FieldDefinition[],
  ) => void;
  /** Runs one rule's show/hide/property actions on the canvas as if its trigger fired. */
  simulateVisualRule: (
    hostLayerId: string,
    rule: LayerVisualRule,
    layers: Layer[],
    fields: FieldDefinition[],
  ) => void;
  /** Clears simulated and change-rule results, keeping test values. */
  resetVisualRuleSimulation: () => void;
  resetAll: () => void;
}

export const useTestDataStore = create<TestDataState>((set) => ({
  values: {},
  visualRuleStateOverrides: {},
  setValue: (fieldId, value, layers = [], fields = []) =>
    set((state) => {
      const values = { ...state.values, [fieldId]: value };
      return {
        values,
        visualRuleStateOverrides: updateVisualRuleStateOverrides(
          state.visualRuleStateOverrides,
          layers,
          fields,
          state.values,
          values,
        ),
      };
    }),
  setValues: (patch, layers = [], fields = []) =>
    set((state) => {
      const values = { ...state.values, ...patch };
      return {
        values,
        visualRuleStateOverrides: updateVisualRuleStateOverrides(
          state.visualRuleStateOverrides,
          layers,
          fields,
          state.values,
          values,
        ),
      };
    }),
  simulateVisualRule: (hostLayerId, rule, layers, fields) =>
    set((state) => {
      const engine = editorVisualRuleEngine(layers, fields);
      const overrides = toMap(state.visualRuleStateOverrides);
      return {
        visualRuleStateOverrides: Object.fromEntries(
          applyVisualRuleEventActions(
            engine,
            overrides,
            rule.actions,
            hostLayerId,
            visibleOf(layers, fields, state.values, overrides),
          ),
        ),
      };
    }),
  resetVisualRuleSimulation: () => set({ visualRuleStateOverrides: {} }),
  resetAll: () => set({ values: {}, visualRuleStateOverrides: {} }),
}));
