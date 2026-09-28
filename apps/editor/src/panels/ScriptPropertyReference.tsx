import { scriptLayerPropertyCatalog, SCRIPT_EFFECT_CATALOG } from '@ograf-editor/scene-model';
import { useActiveComposition } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';

export function ScriptPropertyReference() {
  const composition = useActiveComposition();
  const selectedId = useSelectionStore((state) => state.selectedLayerId);
  const layer = composition.layers.find((entry) => entry.id === selectedId);
  if (!layer) return null;
  const reference = `layerById(${JSON.stringify(layer.id)})`;
  const properties = Object.entries({
    ...scriptLayerPropertyCatalog(layer.element.type, 'composition'),
    ...Object.fromEntries(
      Object.entries(SCRIPT_EFFECT_CATALOG).map(([key, spec]) => [`effects.${key}`, spec]),
    ),
  });
  return (
    <details className="scripts-property-reference">
      <summary>Script properties: {layer.name}</summary>
      <p>
        Read or assign these properties in the composition script. Changes apply to the current
        frame.
      </p>
      <code>{reference}</code>
      <ul>
        {properties.map(([property, spec]) => (
          <li key={property}>
            <code>{property}</code>
            <small title={spec.values?.join(', ') ?? spec.description}>
              {' '}
              {spec.type}
              {spec.readOnly ? ' · read-only' : ''}
            </small>
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
