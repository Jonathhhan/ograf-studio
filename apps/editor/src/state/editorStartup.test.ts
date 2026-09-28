import { afterEach, describe, expect, it } from 'vitest';
import { scriptingErrors } from '@ograf-editor/scene-model';
import { initializeEditorSession } from './editorStartup';
import { useProjectStore } from './projectStore';

afterEach(() => useProjectStore.getState().newProject());

describe('scripting project recovery', () => {
  it.each([[''], ['helpers'], ['helpers.js', 'helpers.js'], ['helpers.js', 'helpers.mjs']])(
    'restores editable module filename errors: %j',
    (...fileNames) => {
      const store = useProjectStore.getState();
      store.newProject();
      store.updateCompositionSettings({
        scripting: {
          enabled: false,
          source: '',
          modules: fileNames.map((fileName) => ({ fileName, source: 'export const gap = 25;' })),
        },
      });
      const saved = JSON.parse(JSON.stringify(useProjectStore.getState().project));
      expect(() => initializeEditorSession(saved)).not.toThrow();
      const restored = useProjectStore.getState().project.compositions[0]!;
      expect(restored.scripting).toEqual(saved.compositions[0].scripting);
      // Recovery keeps the user's code; export still requires correcting the filenames.
      expect(scriptingErrors(restored).length).toBeGreaterThan(0);
      store.updateCompositionSettings({
        scripting: {
          ...restored.scripting!,
          modules: [{ fileName: 'helpers.js', source: 'export const gap = 25;' }],
        },
      });
      expect(scriptingErrors(useProjectStore.getState().project.compositions[0])).toEqual([]);
    },
  );
});

it('recovers retired expression targets at startup without losing their source or changing the saved input', () => {
  const store = useProjectStore.getState();
  store.newProject();
  const id = store.addLayer('text');
  const saved = JSON.parse(JSON.stringify(useProjectStore.getState().project));
  const layer = saved.compositions[0].layers.find((entry: { id: string }) => entry.id === id);
  layer.expressions = {
    x: '10',
    transformOriginX: '0.25',
    transformOriginY: '',
    strokeWidth: '4',
    'fill.stops[0].offset': '0.5',
  };
  layer.expressionsEnabled = { x: true, transformOriginX: false, strokeWidth: true };
  const before = JSON.stringify(saved);
  expect(() => initializeEditorSession(saved)).not.toThrow();
  const composition = useProjectStore.getState().project.compositions[0]!;
  const recovered = composition.layers.find((entry) => entry.id === id)!;
  expect(recovered.expressions).toEqual({ x: '10' });
  expect(recovered.expressionsEnabled).toEqual({ x: true });
  expect(recovered.legacyExpressions).toEqual({
    transformOriginX: { source: '0.25', enabled: false },
    transformOriginY: { source: '', enabled: true },
    strokeWidth: { source: '4', enabled: true },
    'fill.stops[0].offset': { source: '0.5', enabled: true },
  });
  expect(scriptingErrors(composition)).toEqual([]);
  expect(JSON.stringify(saved)).toBe(before);
  expect(() =>
    initializeEditorSession(JSON.parse(JSON.stringify(useProjectStore.getState().project))),
  ).not.toThrow();
  expect(
    useProjectStore.getState().project.compositions[0]!.layers.find((entry) => entry.id === id)!
      .legacyExpressions,
  ).toEqual(recovered.legacyExpressions);
});
