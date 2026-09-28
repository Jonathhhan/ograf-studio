import { beforeEach, describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  createRectangleLayer,
  createLayerVisualRule,
} from '@ograf-editor/scene-model';
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
    expect(useTestDataStore.getState().visualRuleStateOverrides[layer.id]).toEqual({
      properties: { fill: '#00ff00' },
    });

    useTestDataStore.getState().setValue(field.id, 0, [layer], [field]);
    expect(useTestDataStore.getState().visualRuleStateOverrides[layer.id]).toEqual({
      properties: { fill: '#ff0000' },
    });
  });
});
