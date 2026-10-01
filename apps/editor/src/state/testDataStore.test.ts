import { beforeEach, describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  createRectangleLayer,
  createLayerVisualRule,
} from '@ograf-editor/scene-model';
import { editorVisualRuleEffects } from './dataBinding';
import { useTestDataStore } from './testDataStore';

describe('testDataStore visual-rule event state', () => {
  beforeEach(() => useTestDataStore.getState().resetAll());

  it('keeps the latest increased/decreased paint action latched', () => {
    const field = createFieldDefinition('integer', { defaultValue: 0 });
    const layer = createRectangleLayer();
    layer.visualRules = [
      createLayerVisualRule({
        fieldId: field.id,
        operator: 'increased',
        actions: [{ type: 'property', targetProperty: 'fill', value: '#00ff00' }],
      }),
      createLayerVisualRule({
        fieldId: field.id,
        operator: 'decreased',
        actions: [{ type: 'property', targetProperty: 'fill', value: '#ff0000' }],
      }),
    ];

    useTestDataStore.getState().setValue(field.id, 1, [layer], [field]);
    expect(useTestDataStore.getState().visualRuleStateOverrides[layer.id]).toMatchObject({
      properties: { fill: '#00ff00' },
    });

    useTestDataStore.getState().setValue(field.id, 0, [layer], [field]);
    expect(useTestDataStore.getState().visualRuleStateOverrides[layer.id]).toMatchObject({
      properties: { fill: '#ff0000' },
    });
  });

  it('simulates an event rule on another layer and resets the simulation', () => {
    const button = createRectangleLayer();
    const panel = createRectangleLayer();
    panel.isVisible = false;
    const rule = createLayerVisualRule({
      trigger: 'click',
      actions: [{ type: 'toggle-visibility', targetLayerId: panel.id }],
    });
    button.visualRules = [rule];
    const layers = [button, panel];

    useTestDataStore.getState().simulateVisualRule(button.id, rule, layers, []);
    const shown = useTestDataStore.getState().visualRuleStateOverrides;
    expect(editorVisualRuleEffects(layers, [], {}, shown).get(panel.id)?.visibility).toBe(true);

    useTestDataStore.getState().simulateVisualRule(button.id, rule, layers, []);
    expect(useTestDataStore.getState().visualRuleStateOverrides[panel.id]?.visibility).toBe(false);

    useTestDataStore.getState().resetVisualRuleSimulation();
    expect(useTestDataStore.getState().visualRuleStateOverrides).toEqual({});
  });

  it('lets a data state rule take back a value an earlier event wrote', () => {
    const score = createFieldDefinition('integer', { defaultValue: 0 });
    const status = createFieldDefinition('text', { defaultValue: '' });
    const layer = createRectangleLayer();
    layer.visualRules = [
      createLayerVisualRule({
        fieldId: score.id,
        operator: 'increased',
        actions: [{ type: 'property', targetProperty: 'fill', value: '#00ff00' }],
      }),
      createLayerVisualRule({
        fieldId: status.id,
        operator: 'equals',
        value: 'FT',
        actions: [{ type: 'property', targetProperty: 'fill', value: '#888888' }],
      }),
    ];
    const fields = [score, status];

    useTestDataStore.getState().setValue(score.id, 1, [layer], fields);
    useTestDataStore.getState().setValue(status.id, 'FT', [layer], fields);
    const { values, visualRuleStateOverrides } = useTestDataStore.getState();
    expect(visualRuleStateOverrides[layer.id]).toBeUndefined();
    expect(
      editorVisualRuleEffects([layer], fields, values, visualRuleStateOverrides).get(layer.id)
        ?.properties.fill,
    ).toBe('#888888');
  });
});
