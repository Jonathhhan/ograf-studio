import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import {
  createComposition,
  createFieldDefinition,
  createTextLayer,
  createLayerOfKind,
} from '@ograf-editor/scene-model';
import {
  createScriptCompletionSource,
  moduleExportCompletions,
  type ScriptEditorContext,
} from './scriptCompletions';

function fixture() {
  const composition = createComposition();
  const layer = createTextLayer();
  layer.name = 'Title';
  const rectangle = createLayerOfKind('rectangle');
  rectangle.name = 'Box';
  composition.layers = [layer, rectangle];
  composition.dataFields = [
    createFieldDefinition('text', { key: 'headline' }),
    createFieldDefinition('number', { key: 'left margin' }),
  ];
  composition.scripting = {
    enabled: true,
    source: '',
    modules: [
      {
        fileName: 'helpers.js',
        source:
          'throw new Error("Never execute for completion"); export function gap() { return 25; } export class Layout {}',
      },
    ],
  };
  return { composition, layer, mode: 'composition' as const };
}
function complete(source: string, config: ScriptEditorContext = fixture()) {
  const state = EditorState.create({ doc: source, extensions: [javascript()] });
  return createScriptCompletionSource(config)(new CompletionContext(state, source.length, true));
}
const labels = (source: string, config?: ScriptEditorContext) =>
  complete(source, config)?.options.map((item) => item.label) ?? [];

describe('project JavaScript completion', () => {
  it('offers only the referenced layer type and resolves const aliases', () => {
    expect(labels('layer("Title").')).toContain('fontSize');
    expect(labels("layer('Box').")).not.toContain('fontSize');
    expect(labels('const title = layer("Title"); title.')).toContain('fontSize');
    expect(labels('layer("Title").element.')).toContain('fontSize');
    expect(labels('layer("Title").effects.')).toContain('dropShadowEnabled');
  });
  it('completes time-sampled property names and reference members', () => {
    expect(labels('layer("Title").property("')).toEqual([
      'x',
      'y',
      'width',
      'height',
      'rotation',
      'opacity',
      'scaleX',
      'scaleY',
      'skewX',
      'position',
      'size',
      'transformOrigin',
    ]);
    expect(labels('layer("Title").property("x").')).toEqual(['name', 'value', 'valueAtTime']);
    expect(labels('const title = layer("Title"); title.property("x").')).toContain('valueAtTime');
    const config = { ...fixture(), mode: 'expression' as const };
    expect(labels('thisLayer.property("x").', config)).toContain('valueAtTime');
    expect(
      labels(`layerById(${JSON.stringify(config.layer.id)}).property("x").`, config),
    ).toContain('valueAtTime');
    expect(complete('layer("Title").property("x").val')?.from).toBe(
      'layer("Title").property("x").'.length,
    );
  });
  it('completes source bounds without evaluating content', () => {
    expect(labels('layer("Title").sourceRectAtTime(time - 0.2, true).')).toEqual([
      'left',
      'top',
      'width',
      'height',
    ]);
    expect(labels('const title = layer("Title"); title.sourceRectAtTime().')).toContain('width');
    const result = complete('layer("Title").sourceRectAtTime().');
    expect(result?.options.every((entry) => entry.detail?.includes('read-only'))).toBe(true);
  });
  it('offers vector aliases while keeping the scalar API', () => {
    for (const mode of ['expression', 'composition'] as const) {
      const config = { ...fixture(), mode };
      expect(labels('layer("Title").', config)).toEqual(
        expect.arrayContaining([
          'x',
          'y',
          'width',
          'height',
          'position',
          'size',
          'transformOrigin',
        ]),
      );
      expect(labels('layer("Title").property("transformOrigin").', config)).toContain(
        'valueAtTime',
      );
      expect(
        complete('layer("Title").property("size").', config)?.options.find(
          (item) => item.label === 'value',
        )?.detail,
      ).toContain('array');
    }
    expect(labels('', { ...fixture(), mode: 'expression', property: 'text' })).toEqual(
      expect.arrayContaining(['position', 'size', 'transformOrigin', 'text']),
    );
    expect(labels('', fixture())).not.toContain('transformOrigin');
    expect(
      complete('thisLayer.', { ...fixture(), mode: 'expression' })?.options.find(
        (item) => item.label === 'transformOrigin',
      )?.detail,
    ).toContain('read-only');
    expect(labels('text.', { ...fixture(), mode: 'expression', property: 'text' })).toEqual(
      expect.arrayContaining(['fontSize', 'fontFamily', 'direction', 'lineHeight', 'setText']),
    );
  });
  it('offers current globals and vector members in v1 completion', () => {
    const config = fixture();
    config.composition.expressionApiVersion = 1;
    expect(labels('', config)).toContain('json');
    expect(labels('', { ...config, mode: 'expression' })).toEqual(
      expect.arrayContaining(['position', 'size', 'transformOrigin']),
    );
    expect(labels('layer("Title").', config)).toEqual(
      expect.arrayContaining(['position', 'size', 'transformOrigin']),
    );
    expect(labels('layer("Title").property("', config)).toEqual(
      expect.arrayContaining(['position', 'size', 'transformOrigin']),
    );
  });
  it('does not complete unsupported sampling properties or shadowed references', () => {
    expect(labels('layer("Title").property("fontSize").')).not.toContain('valueAtTime');
    expect(labels('layer("Missing").sourceRectAtTime().')).not.toContain('left');
    expect(labels('function test(layer) { layer("Title").property("')).toEqual([]);
    expect(
      labels('const title = layer("Title"); function test(title) { title.sourceRectAtTime().'),
    ).not.toContain('left');
    expect(labels('// layer("Title").property("')).toEqual([]);
  });
  it('keeps expressions read-only and limited to transform access', () => {
    const config = { ...fixture(), mode: 'expression' as const };
    expect(labels('thisLayer.', config)).toContain('sourceRectAtTime');
    expect(labels('layer("Title").', config)).not.toContain('fontSize');
    expect(labels('thisLayer.', config)).not.toContain('transformOriginX');
    expect(
      complete('thisLayer.', config)?.options.find((item) => item.label === 'x')?.detail,
    ).toContain('read-only');
    expect(labels('val', config)).toContain('valueAtTime');
    expect(labels('val')).not.toContain('valueAtTime');
  });
  it('provides layer names, stable IDs and escaped names without ambiguous name lookups', () => {
    const config = fixture();
    expect(labels('layer("', config)).toEqual(['Title', 'Box']);
    expect(labels('layerById("', config)).toContain(config.layer.id);
    config.composition.layers[1]!.name = 'Title';
    expect(labels('layer("', config)).not.toContain('Title');
    expect(labels('layer("Title").', config)).not.toContain('fontSize');
    config.layer.name = 'A "quoted" title';
    expect(labels(`layer(${JSON.stringify(config.layer.name)}).`, config)).toContain('fontSize');
  });
  it('includes data schema keys and uses bracket access for non-identifiers', () => {
    expect(labels('data.')).toEqual(['headline', 'left margin']);
    const result = complete('data.left')!;
    const item = result.options.find((item) => item.label === 'left margin')!;
    let change: any;
    (item.apply as Function)(
      {
        dispatch: (spec: any) => {
          change = spec.changes;
        },
      },
      item,
      result.from,
      9,
    );
    expect(change).toEqual({ from: 4, to: 9, insert: '["left margin"]' });
  });
  it('reads helper declarations without executing the module', () => {
    expect(labels('helpers.')).toEqual(['gap', 'Layout']);
    expect(labels('modules.helpers.')).toEqual(['gap', 'Layout']);
    expect(
      moduleExportCompletions(
        '// export const fake = 1;\nexport { foo as bar }; export default 1;',
      ).map((item) => item.label),
    ).toEqual(['bar', 'default']);
  });
  it('does not inject scene globals into modules, strings or comments', () => {
    expect(labels('', { ...fixture(), mode: 'module' })).toEqual([]);
    expect(labels('// layer("Title").')).toEqual([]);
    expect(labels('"hello data.')).toEqual([]);
    expect(labels('const title = layer("Title"); function test(title) { title.')).toEqual([]);
    expect(labels('function test(data) { data.')).toEqual([]);
    expect(labels('const layer = () => ({}); layer("Title").')).toEqual([]);
  });
});
