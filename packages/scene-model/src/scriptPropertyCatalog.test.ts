import { describe, expect, it } from 'vitest';
import { createDefaultTransform, createLayerOfKind, createShaderElement } from './factory';
import { SCRIPT_ELEMENT_CATALOG, scriptLayerPropertyCatalog } from './scriptPropertyCatalog';
import { scriptLayerReference } from './scriptLayerProperties';
import type { Element } from './types';

describe('script property catalog contract', () => {
  it.each(Object.keys(SCRIPT_ELEMENT_CATALOG) as Element['type'][])(
    'matches actual %s layer access',
    (type) => {
      const layer = createLayerOfKind(type);
      if (type === 'shader') layer.element = createShaderElement();
      const { reference } = scriptLayerReference(
        createDefaultTransform(),
        { element: layer.element, effects: layer.effects, isVisible: true, blendMode: 'normal' },
        { id: layer.id, name: layer.name },
        () => {},
        { property: () => {}, sourceRectAtTime: () => {} },
      );
      const catalog = scriptLayerPropertyCatalog(type, 'composition');
      expect(Object.getOwnPropertyNames(reference).sort()).toEqual(Object.keys(catalog).sort());
      for (const [key, spec] of Object.entries(catalog)) {
        const descriptor = Object.getOwnPropertyDescriptor(reference, key)!;
        expect(Boolean(descriptor.set), key).toBe(!spec.readOnly);
      }
    },
  );
  it('uses the catalog enum choices to validate writes', () => {
    const layer = createLayerOfKind('text');
    const draft = scriptLayerReference(
      createDefaultTransform(),
      { element: layer.element, effects: layer.effects, isVisible: true, blendMode: 'normal' },
      { id: layer.id, name: layer.name },
      () => {},
      {},
    );
    (draft.reference as any).textAlign = 'diagonal';
    expect(() => draft.finish()).toThrow('Invalid textAlign');
    for (const value of SCRIPT_ELEMENT_CATALOG.text.textAlign!.values!) {
      (draft.reference as any).textAlign = value;
      expect(() => draft.finish()).not.toThrow();
    }
  });
});
