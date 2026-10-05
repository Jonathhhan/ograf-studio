import { describe, expect, it } from 'vitest';
import {
  assetReference,
  createAsset,
  createFieldDefinition,
  createProject,
} from '@ograf-editor/scene-model';
import {
  buildPreviewDataFromTestValues,
  buildPreviewFormFromTestValues,
  resolvePreviewDataRecord,
  resolvePreviewFormValue,
} from './previewData';

describe('preview data', () => {
  it('falls back when a persisted test value is not a current Select option', () => {
    const field = createFieldDefinition('select', {
      defaultValue: 'latin',
      options: [
        { value: 'latin', label: 'Latin' },
        { value: 'arabic', label: 'Arabic' },
      ],
    });

    expect(resolvePreviewFormValue(field, 'arabic')).toBe('arabic');
    expect(resolvePreviewFormValue(field, 'old-font-stack')).toBe('latin');
  });

  it('uses field defaults while preserving explicit falsey test values', () => {
    const composition = createProject().compositions[0]!;
    const headline = createFieldDefinition('text', { key: 'headline', defaultValue: 'Default' });
    const count = createFieldDefinition('number', { key: 'count', defaultValue: 7 });
    composition.dataFields.push(headline, count);

    expect(buildPreviewDataFromTestValues(composition, { [headline.id]: '' })).toMatchObject({
      headline: '',
      count: 7,
    });
  });

  it('builds keyed preview forms from field-id test values', () => {
    const composition = createProject().compositions[0]!;
    const inFrames = createFieldDefinition('integer', { key: 'inFrames', defaultValue: 10 });
    const outFrames = createFieldDefinition('integer', { key: 'outFrames', defaultValue: 10 });
    composition.dataFields.push(inFrames, outFrames);

    expect(buildPreviewFormFromTestValues(composition, { [outFrames.id]: 50 })).toMatchObject({
      inFrames: 10,
      outFrames: 50,
    });
  });

  it('converts numeric form text into numeric runtime data', () => {
    const composition = createProject().compositions[0]!;
    for (const type of ['number', 'integer', 'duration-ms', 'percentage'] as const)
      composition.dataFields.push(createFieldDefinition(type, { key: type, defaultValue: 0 }));
    expect(
      resolvePreviewDataRecord(composition, {
        number: '-12.5',
        integer: '12',
        'duration-ms': '250',
        percentage: '100',
      }),
    ).toMatchObject({ number: -12.5, integer: 12, 'duration-ms': 250, percentage: 100 });
  });

  it('fills cleared nested preview leaves before displaying forms or sending runtime data', () => {
    const composition = createProject().compositions[0]!;
    const field = createFieldDefinition('object', {
      key: 'player',
      defaultValue: { name: 'Authored name', score: 1 },
    });
    composition.dataFields.push(field);
    const partial = { score: 9 };
    expect(resolvePreviewFormValue(field, partial)).toEqual({ name: 'Authored name', score: 9 });
    expect(buildPreviewDataFromTestValues(composition, { [field.id]: partial })).toEqual({
      player: { name: 'Authored name', score: 9 },
    });
  });

  it('resolves local image assets for both test-value and keyed-form payloads', () => {
    const composition = createProject().compositions[0]!;
    const asset = createAsset({
      name: 'Portrait',
      mimeType: 'image/png',
      dataUri: 'data:image/png;base64,cG9ydHJhaXQ=',
    });
    const portrait = createFieldDefinition('image-url', {
      key: 'portrait',
      defaultValue: assetReference(asset.id),
    });
    composition.assets.push(asset);
    composition.dataFields.push(portrait);

    expect(buildPreviewDataFromTestValues(composition, {})).toEqual({
      portrait: asset.dataUri,
    });
    expect(resolvePreviewDataRecord(composition, { portrait: assetReference(asset.id) })).toEqual({
      portrait: asset.dataUri,
    });
  });
});
