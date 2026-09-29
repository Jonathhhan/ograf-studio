import { describe, expect, it } from 'vitest';
import { createLayerOfKind, createProject } from '@ograf-editor/scene-model';
import { withoutProjectScripts } from './safeStart';

describe('safe project recovery', () => {
  it('disables executable entry points on a detached copy while preserving code and originals', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    composition.scripting = {
      source: 'while(true) {}',
      enabled: true,
      modules: [{ fileName: 'helpers.js', source: 'while(true) {}' }],
    };
    const layer = createLayerOfKind('text');
    layer.expressions = { text: 'while(true) {}', x: 'while(true) {}' };
    composition.layers = [layer];
    const original = JSON.stringify(project);
    const copy = withoutProjectScripts(project);
    expect(copy.compositions[0]!.scripting?.enabled).toBe(false);
    expect(copy.compositions[0]!.layers[0]!.expressionsEnabled).toEqual({ text: false, x: false });
    expect(copy.compositions[0]!.scripting?.modules).toEqual(composition.scripting.modules);
    expect(JSON.stringify(project)).toBe(original);
  });
});
