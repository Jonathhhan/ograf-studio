import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createFieldDefinition,
  createLayerOfKind,
  createLayerVisualRule,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import {
  layerHasRuntimeVisualInputs,
  pointerVisualRuleActions,
  resolveVisualRuleElement,
  triggeredVisualRuleActions,
  updateVisualRuleStateOverride,
  visualRuleLayerVisible,
} from './runtimeVisualRules';

describe('compiled visual rules', () => {
  const fixture = () => {
    const field = createFieldDefinition('text', { key: 'result', defaultValue: '' });
    const layer = createLayerOfKind('rectangle');
    layer.visualRules = [
      createLayerVisualRule({
        id: 'gold',
        fieldId: field.id,
        operator: 'equals',
        value: 'GOLD',
        actions: [
          { type: 'visibility', visible: true },
          { type: 'property', targetProperty: 'fill', value: '#d4af37' },
        ],
      }),
      createLayerVisualRule({
        id: 'empty',
        fieldId: field.id,
        operator: 'empty',
        actions: [{ type: 'visibility', visible: false }],
      }),
      createLayerVisualRule({
        id: 'changed',
        fieldId: field.id,
        operator: 'changed',
        actions: [{ type: 'custom-action', actionId: 'flash' }],
      }),
    ];
    return compileDescriptor(createComposition({ layers: [layer], dataFields: [field] }))
      .layers[0]!;
  };

  it('sets properties and visibility from current data', () => {
    const layer = fixture();
    expect(layer.bindings).toEqual([]);
    expect(layerHasRuntimeVisualInputs(layer)).toBe(true);
    expect(resolveVisualRuleElement(layer, { result: 'GOLD' })).toMatchObject({ fill: '#d4af37' });
    expect(visualRuleLayerVisible(layer, { result: '' })).toBe(false);
    expect(visualRuleLayerVisible(layer, { result: 'GOLD' })).toBe(true);
  });

  it('does not schedule refreshes for a completely static layer', () => {
    const layer = { ...fixture(), visualRules: [] };
    expect(layerHasRuntimeVisualInputs(layer)).toBe(false);
  });

  it('emits custom actions only for matching data changes', () => {
    const layer = fixture();
    expect(triggeredVisualRuleActions(layer, { result: 'GOLD' }, { result: 'SILVER' })).toEqual([
      { type: 'custom-action', actionId: 'flash' },
    ]);
    expect(triggeredVisualRuleActions(layer, { result: 'GOLD' }, {})).toEqual([]);
    expect(triggeredVisualRuleActions(layer, { result: 'GOLD' }, { result: 'GOLD' })).toEqual([]);
  });

  it('latches visual actions emitted by increased and decreased events', () => {
    const layer = fixture();
    layer.visualRules = [
      {
        id: 'up',
        name: 'Score up',
        enabled: true,
        dataKey: 'result',
        sourcePath: [],
        operator: 'increased',
        actions: [{ type: 'property', targetProperty: 'fill', value: '#00ff00' }],
      },
      {
        id: 'down',
        name: 'Score down',
        enabled: true,
        dataKey: 'result',
        sourcePath: [],
        operator: 'decreased',
        actions: [{ type: 'property', targetProperty: 'fill', value: '#ff0000' }],
      },
    ];

    const increased = updateVisualRuleStateOverride(layer, { result: 2 }, { result: 1 });
    expect(increased).toEqual({ properties: { fill: '#00ff00' } });
    expect(updateVisualRuleStateOverride(layer, { result: 2 }, { result: 2 }, increased)).toBe(
      increased,
    );
    expect(updateVisualRuleStateOverride(layer, { result: 1 }, { result: 2 }, increased)).toEqual({
      properties: { fill: '#ff0000' },
    });
  });

  it('compiles pointer rules without data fields and keeps them out of data evaluation', () => {
    const layer = createLayerOfKind('rectangle');
    layer.visualRules = [
      createLayerVisualRule({
        trigger: 'pointer-enter',
        fieldId: '',
        actions: [{ type: 'property', targetProperty: 'fill', value: '#ffffff' }],
      }),
      createLayerVisualRule({
        trigger: 'click',
        fieldId: '',
        actions: [{ type: 'custom-action', actionId: 'open' }],
      }),
    ];
    const compiled = compileDescriptor(createComposition({ layers: [layer], dataFields: [] }))
      .layers[0]!;

    expect(compiled.visualRules).toHaveLength(2);
    expect(layerHasRuntimeVisualInputs(compiled)).toBe(true);
    expect(resolveVisualRuleElement(compiled, {})).toEqual(compiled.element);
    expect(triggeredVisualRuleActions(compiled, {}, {})).toEqual([]);
    expect(pointerVisualRuleActions(compiled, 'pointer-enter')).toEqual([
      { type: 'property', targetProperty: 'fill', value: '#ffffff' },
    ]);
    expect(pointerVisualRuleActions(compiled, 'click')).toEqual([
      { type: 'custom-action', actionId: 'open' },
    ]);
  });
});
