import { describe, expect, it } from 'vitest';
import {
  createFieldDefinition,
  createRectangleLayer,
  createTextLayer,
  createLayerVisualRule,
} from '@ograf-editor/scene-model';
import {
  previewBindingData,
  resolveDesignerElement,
  resolveDesignerEffects,
  resolveEffectiveElement,
  resolveEffectiveEffects,
} from './dataBinding';
import {
  buildPreviewDataFromTestValues,
  buildPreviewFormFromTestValues,
  resolvePreviewDataRecord,
  resolvePreviewFormValue,
} from './previewData';
import { createComposition } from '@ograf-editor/scene-model';
describe('designer binding values', () => {
  it('shows editable bound values while runtime visual rules keep their own output', () => {
    const layer = createRectangleLayer();
    const fill = createFieldDefinition('color', { defaultValue: '#00ff00' });
    const shadow = createFieldDefinition('color', { defaultValue: '#0000ff' });
    const fields = [fill, shadow];
    layer.bindings = [
      { fieldId: fill.id, targetProperty: 'fill' },
      { fieldId: shadow.id, targetProperty: 'dropShadowColor' },
    ];
    layer.visualRules = [
      createLayerVisualRule({
        fieldId: fill.id,
        operator: 'equals',
        value: '#00ff00',
        actions: [
          { type: 'property', targetProperty: 'fill', value: '#ff0000' },
          { type: 'property', targetProperty: 'dropShadowColor', value: '#ff0000' },
        ],
      }),
    ];
    expect(resolveDesignerElement(layer, {}, fields)).toMatchObject({ fill: '#00ff00' });
    expect(resolveDesignerEffects(layer, layer.effects, {}, fields)).toMatchObject({
      dropShadowColor: '#0000ff',
    });
    expect(resolveEffectiveElement(layer, {}, [], fields)).toMatchObject({ fill: '#ff0000' });
    expect(resolveEffectiveEffects(layer, layer.effects, {}, fields)).toMatchObject({
      dropShadowColor: '#ff0000',
    });
  });
});

describe('resolveEffectiveElement', () => {
  it('uses the declared field default when no explicit test value exists', () => {
    const layer = createRectangleLayer();
    const field = createFieldDefinition('color', {
      defaultValue: '#ff0000',
    });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'fill' }];
    if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle layer.');
    layer.element.fill = '#0000ff';

    expect(resolveEffectiveElement(layer, {}, [], [field])).toMatchObject({ fill: '#ff0000' });
    expect(resolveEffectiveElement(layer, { [field.id]: '#00ff00' }, [], [field])).toMatchObject({
      fill: '#00ff00',
    });
  });

  it('applies multiple independent bindings to one layer in order', () => {
    const layer = createTextLayer();
    const content = createFieldDefinition('text', { defaultValue: 'Studio headline' });
    const color = createFieldDefinition('color', { defaultValue: '#ff3366' });
    layer.bindings = [
      { fieldId: content.id, targetProperty: 'content' },
      { fieldId: color.id, targetProperty: 'color' },
    ];

    expect(resolveEffectiveElement(layer, {}, [], [content, color])).toMatchObject({
      content: 'Studio headline',
      color: '#ff3366',
    });
  });

  it('maps one select field to multiple typography properties', () => {
    const layer = createTextLayer();
    const typography = createFieldDefinition('select', {
      defaultValue: 'latin',
      options: [
        { value: 'latin', label: 'Latin' },
        { value: 'arabic', label: 'Arabic' },
      ],
    });
    layer.bindings = [
      {
        fieldId: typography.id,
        targetProperty: 'fontFamily',
        valueMap: { latin: 'Arial', arabic: 'Noto Sans Arabic' },
      },
      {
        fieldId: typography.id,
        targetProperty: 'fontSize',
        valueMap: { latin: '64', arabic: '72' },
      },
      {
        fieldId: typography.id,
        targetProperty: 'lineHeight',
        valueMap: { latin: '1.1', arabic: '1.3' },
      },
    ];

    expect(resolveEffectiveElement(layer, {}, [], [typography])).toMatchObject({
      fontFamily: 'Arial',
      fontSize: 64,
      lineHeight: 1.1,
    });
    expect(
      resolveEffectiveElement(layer, { [typography.id]: 'arabic' }, [], [typography]),
    ).toMatchObject({
      fontFamily: 'Noto Sans Arabic',
      fontSize: 72,
      lineHeight: 1.3,
    });
  });

  it('previews the first runtime collection item through a nested source path', () => {
    const layer = createTextLayer();
    const field = createFieldDefinition('array', {
      items: createFieldDefinition('object', {
        key: 'item',
        properties: [createFieldDefinition('text', { key: 'name' })],
        defaultValue: { name: '' },
      }),
      defaultValue: [{ name: 'Ada' }, { name: 'Lin' }],
    });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'content', sourcePath: ['name'] }];
    expect(resolveEffectiveElement(layer, {}, [], [field])).toMatchObject({ content: 'Ada' });
    expect(
      resolveEffectiveElement(layer, { [field.id]: [{ name: 'Grace' }] }, [], [field]),
    ).toMatchObject({ content: 'Grace' });
  });
});

describe('effective Select data after schema edits', () => {
  it('uses the same fallback in forms, scripts, element bindings and effects', () => {
    const field = createFieldDefinition('select', {
      key: 'language',
      defaultValue: 'latin',
      options: [{ value: 'latin', label: 'Latin' }],
    });
    const composition = createComposition({ dataFields: [field] });
    const values = { [field.id]: 'arabic' };
    const layer = createTextLayer();
    layer.bindings = [
      {
        fieldId: field.id,
        targetProperty: 'fontFamily',
        valueMap: { latin: 'Arial', arabic: 'Noto Sans Arabic' },
      },
      {
        fieldId: field.id,
        targetProperty: 'dropShadowColor',
        valueMap: { latin: '#ff0000', arabic: '#0000ff' },
      },
    ];
    expect(resolvePreviewFormValue(field, values[field.id])).toBe('latin');
    expect(previewBindingData([field], values)).toEqual({ language: 'latin' });
    expect(buildPreviewDataFromTestValues(composition, values)).toEqual({ language: 'latin' });
    expect(buildPreviewFormFromTestValues(composition, values)).toEqual({ language: 'latin' });
    expect(resolvePreviewDataRecord(composition, { language: 'arabic' })).toEqual({
      language: 'latin',
    });
    expect(resolveEffectiveElement(layer, values, [], [field])).toMatchObject({
      fontFamily: 'Arial',
    });
    expect(resolveEffectiveEffects(layer, layer.effects, values, [field])).toMatchObject({
      dropShadowColor: '#ff0000',
    });
    expect(values[field.id]).toBe('arabic'); // Rendering must not mutate persisted test data.
  });
  it('filters removed multiple selections and resolves nested selection fields', () => {
    const choice = createFieldDefinition('select', {
      key: 'language',
      defaultValue: 'latin',
      options: [{ value: 'latin', label: 'Latin' }],
    });
    const multiple = createFieldDefinition('select-multiple', {
      key: 'languages',
      defaultValue: [],
      options: choice.options,
    });
    expect(resolvePreviewFormValue(multiple, ['arabic', 'latin'])).toEqual(['latin']);
    expect(resolvePreviewFormValue(multiple, [])).toEqual([]);
    expect(resolvePreviewFormValue(choice, 42)).toBe('latin');
    const object = createFieldDefinition('object', {
      key: 'item',
      properties: [choice],
      defaultValue: {},
    });
    const array = createFieldDefinition('array', { key: 'items', items: object, defaultValue: [] });
    expect(previewBindingData([array], { [array.id]: [{ language: 'arabic', score: 0 }] })).toEqual(
      { items: [{ language: 'latin', score: 0 }] },
    );
  });
});
