import {
  SCRIPT_ELEMENT_PROPERTIES,
  TRANSFORM_ANIMATION_PROPERTIES,
} from '@ograf-editor/scene-model';
import { useActiveComposition } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';

export function ScriptPropertyReference() {
  const composition = useActiveComposition();
  const selectedId = useSelectionStore((state) => state.selectedLayerId);
  const layer = composition.layers.find((entry) => entry.id === selectedId);
  if (!layer) return null;
  const reference = `layerById(${JSON.stringify(layer.id)})`;
  const properties = [
    ...TRANSFORM_ANIMATION_PROPERTIES,
    'isVisible',
    'blendMode',
    ...SCRIPT_ELEMENT_PROPERTIES[layer.element.type].map((key) =>
      key === 'name' ? 'element.name' : key,
    ),
    ...Object.keys(layer.effects).map((key) => `effects.${key}`),
  ];
  return (
    <details className="scripts-property-reference">
      <summary>Script properties: {layer.name}</summary>
      <p>
        Read or assign these properties in the composition script. Changes apply to the current
        frame.
      </p>
      <code>{reference}</code>
      <ul>
        {properties.map((property) => (
          <li key={property}>
            <code>{property}</code>
          </li>
        ))}
      </ul>
      <p>
        Nested objects use normal JavaScript access, such as <code>fill.stops[0].color</code> or{' '}
        <code>effects.stack[0].params.radius</code>. Available members depend on the layer’s paint
        and effects.
      </p>
      <p>
        <code>id</code>, <code>name</code>, and <code>type</code> are read-only. Use{' '}
        <code>properties()</code> to list the available top-level properties.
      </p>
    </details>
  );
}
