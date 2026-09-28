import { create } from 'zustand';

import {
  visualRuleMatches,
  visualRuleValue,
  type FieldDefinition,
  type FieldValue,
  type Layer,
} from '@ograf-editor/scene-model';

export type TestValue = FieldValue;

export interface VisualRuleStateOverride {
  properties: Record<string, unknown>;
  visibility?: boolean;
}

const EVENT_OPERATORS = new Set(['changed', 'increased', 'decreased']);

function valueForField(
  values: Record<string, TestValue>,
  field: FieldDefinition | undefined,
): TestValue | undefined {
  if (!field) return undefined;
  return Object.hasOwn(values, field.id) ? values[field.id] : field.defaultValue;
}

export function updateVisualRuleStateOverrides(
  current: Record<string, VisualRuleStateOverride>,
  layers: Layer[],
  fields: FieldDefinition[],
  previousValues: Record<string, TestValue>,
  nextValues: Record<string, TestValue>,
): Record<string, VisualRuleStateOverride> {
  let result = current;
  for (const layer of layers) {
    let layerOverride = current[layer.id];
    for (const rule of layer.visualRules ?? []) {
      if (
        !rule.enabled ||
        (rule.trigger && rule.trigger !== 'data') ||
        !EVENT_OPERATORS.has(rule.operator)
      )
        continue;
      const field = fields.find((candidate) => candidate.id === rule.fieldId);
      const currentValue = visualRuleValue(valueForField(nextValues, field), rule.sourcePath);
      const previousValue = visualRuleValue(valueForField(previousValues, field), rule.sourcePath);
      if (!visualRuleMatches(rule.operator, currentValue, rule.value, previousValue)) continue;
      for (const action of rule.actions) {
        if (action.type === 'property') {
          layerOverride = {
            properties: {
              ...(layerOverride?.properties ?? {}),
              [action.targetProperty]: action.value,
            },
            ...(layerOverride?.visibility === undefined
              ? {}
              : { visibility: layerOverride.visibility }),
          };
        } else if (action.type === 'visibility') {
          layerOverride = {
            properties: { ...(layerOverride?.properties ?? {}) },
            visibility: action.visible,
          };
        }
      }
    }
    if (layerOverride !== current[layer.id]) {
      if (result === current) result = { ...current };
      if (layerOverride) result[layer.id] = layerOverride;
    }
  }
  return result;
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
  resetAll: () => set({ values: {}, visualRuleStateOverrides: {} }),
}));
