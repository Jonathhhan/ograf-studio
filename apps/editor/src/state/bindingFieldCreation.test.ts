import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDefaultGradient,
  createMediaPaint,
  createRectangleLayer,
} from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import { createNextBinding, nextBindingProperty } from './bindingFieldCreation';
import { resolveEffectiveElement } from './dataBinding';
import { getActiveComposition, useProjectStore } from './projectStore';

function activeComposition() {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
}

describe('Add Binding field creation', () => {
  beforeEach(() => useProjectStore.getState().newProject());

  it('creates and binds a text field in one action when the project has no fields', () => {
    const layerId = useProjectStore.getState().addLayer('text');
    useProjectStore.getState().updateLayerElement(layerId, { content: 'Live score' });
    expect(activeComposition().dataFields).toHaveLength(0);

    const fieldId = useProjectStore.getState().addLayerBinding(layerId);
    const composition = activeComposition();
    const layer = composition.layers.find((candidate) => candidate.id === layerId)!;
    const field = composition.dataFields[0]!;

    expect(fieldId).toBe(field.id);
    expect(field).toMatchObject({
      key: 'text_content',
      label: 'Text: Text Content',
      type: 'text',
      defaultValue: 'Live score',
    });
    expect(layer.bindings).toEqual([{ fieldId, targetProperty: 'content' }]);
    expect(resolveEffectiveElement(layer, {}, [], composition.dataFields)).toMatchObject({
      content: 'Live score',
    });
    expect(validateProject(useProjectStore.getState().project).valid).toBe(true);
  });

  it('creates a fresh compatible field even when unrelated fields already exist', () => {
    useProjectStore.getState().addDataField('number');
    const layerId = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().updateLayerElement(layerId, { fill: '#aa3355' });

    const fieldId = useProjectStore.getState().addLayerBinding(layerId);
    const composition = activeComposition();
    const field = composition.dataFields.find((candidate) => candidate.id === fieldId);
    const layer = composition.layers.find((candidate) => candidate.id === layerId)!;

    expect(composition.dataFields).toHaveLength(2);
    expect(field).toMatchObject({ type: 'color', defaultValue: '#aa3355' });
    expect(layer.bindings).toEqual([{ fieldId, targetProperty: 'fill' }]);
    expect(resolveEffectiveElement(layer, {}, [], composition.dataFields)).toMatchObject({
      fill: '#aa3355',
    });
  });

  it('creates unique keys for repeated names and moves to the next free property', () => {
    const firstId = useProjectStore.getState().addLayer('text');
    const secondId = useProjectStore.getState().addLayer('text');
    useProjectStore.getState().addLayerBinding(firstId);
    useProjectStore.getState().addLayerBinding(secondId);
    const nextFieldId = useProjectStore.getState().addLayerBinding(secondId);
    const composition = activeComposition();
    expect(composition.dataFields.map((field) => field.key)).toEqual([
      'text_content',
      'text_content_2',
      'text_color',
    ]);
    expect(composition.dataFields.find((field) => field.id === nextFieldId)).toMatchObject({
      type: 'color',
      defaultValue: '#ffffff',
    });
  });

  it('keeps locked layers unchanged', () => {
    const layerId = useProjectStore.getState().addLayer('text');
    useProjectStore.getState().toggleLayerLock(layerId);
    expect(useProjectStore.getState().addLayerBinding(layerId)).toBeNull();
    expect(activeComposition().dataFields).toHaveLength(0);
    expect(activeComposition().layers[0]?.bindings).toHaveLength(0);
  });

  it('copies a gradient default and skips unsupported media paint bindings', () => {
    const layer = createRectangleLayer();
    if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    layer.element.fill = createDefaultGradient();
    const created = createNextBinding(layer, []);
    expect(created?.field.type).toBe('gradient');
    expect(created?.field.defaultValue).toEqual(layer.element.fill);
    expect(created?.field.defaultValue).not.toBe(layer.element.fill);

    layer.element.fill = createMediaPaint({ source: { kind: 'live', tag: 'camera' } });
    expect(nextBindingProperty(layer)?.value).toBe('dropShadowColor');
  });
});
