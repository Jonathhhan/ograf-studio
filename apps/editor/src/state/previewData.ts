import {
  resolveAssetValue,
  type Composition,
  type FieldDefinition,
  type FieldValue,
} from '@ograf-editor/scene-model';

function hasOwn(record: Record<string, FieldValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Shared effective value for forms, bindings and scripts after field schema edits. */
export function resolvePreviewFormValue(
  field: FieldDefinition,
  testValue: FieldValue | undefined,
): FieldValue {
  if (
    field.type === 'select' &&
    (typeof testValue !== 'string' || !field.options.some((option) => option.value === testValue))
  )
    return field.defaultValue;
  const value = testValue ?? field.defaultValue;
  if (field.type === 'select-multiple') {
    if (!Array.isArray(value)) return field.defaultValue;
    return value.filter(
      (item) => typeof item === 'string' && field.options.some((option) => option.value === item),
    );
  }
  if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => {
        const child = field.properties.find((property) => property.key === key);
        return [key, child ? resolvePreviewFormValue(child, childValue) : childValue];
      }),
    );
  }
  if (field.type === 'array' && field.items && Array.isArray(value))
    return value.map((item) => resolvePreviewFormValue(field.items!, item));
  return value;
}

function resolveFieldValue(
  composition: Composition,
  field: Composition['dataFields'][number],
  value: FieldValue,
): FieldValue {
  value = resolvePreviewFormValue(field, value);
  if (
    ['number', 'integer', 'duration-ms', 'percentage'].includes(field.type) &&
    typeof value === 'string' &&
    value.trim() !== ''
  ) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  if (field.type === 'image-url' && typeof value === 'string') {
    return resolveAssetValue(value, composition.assets);
  }
  if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, FieldValue>;
    return Object.fromEntries(
      Object.entries(record).map(([key, childValue]) => {
        const child = field.properties.find((property) => property.key === key);
        return [key, child ? resolveFieldValue(composition, child, childValue) : childValue];
      }),
    );
  }
  if (field.type === 'array' && field.items && Array.isArray(value)) {
    return value.map((item) => resolveFieldValue(composition, field.items!, item));
  }
  return value;
}

/** Builds the data payload used by in-editor runtime previews. Test values win over declared field
 * defaults, and editor-only `asset:<id>` image values become browser-loadable data URIs. */
export function buildPreviewDataFromTestValues(
  composition: Composition,
  testValuesByFieldId: Record<string, FieldValue>,
): Record<string, FieldValue> {
  return Object.fromEntries(
    composition.dataFields.map((field) => {
      const value = hasOwn(testValuesByFieldId, field.id)
        ? testValuesByFieldId[field.id]!
        : field.defaultValue;
      return [field.key, resolveFieldValue(composition, field, value)];
    }),
  );
}

/** Builds the key-addressed Preview & Export form from the same field-id test data used by Data. */
export function buildPreviewFormFromTestValues(
  composition: Composition,
  testValuesByFieldId: Record<string, FieldValue>,
): Record<string, FieldValue> {
  return Object.fromEntries(
    composition.dataFields.map((field) => [
      field.key,
      resolvePreviewFormValue(
        field,
        hasOwn(testValuesByFieldId, field.id) ? testValuesByFieldId[field.id] : undefined,
      ),
    ]),
  );
}

/** Resolves a key-addressed data form before it is sent to the in-browser Graphic instance. */
export function resolvePreviewDataRecord(
  composition: Composition,
  valuesByFieldKey: Record<string, FieldValue>,
): Record<string, FieldValue> {
  return Object.fromEntries(
    composition.dataFields.map((field) => {
      const value = hasOwn(valuesByFieldKey, field.key)
        ? valuesByFieldKey[field.key]!
        : field.defaultValue;
      return [field.key, resolveFieldValue(composition, field, value)];
    }),
  );
}
