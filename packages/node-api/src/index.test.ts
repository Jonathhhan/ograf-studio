import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  studioNodeApi,
  assertStudioCapabilities,
  createProject,
  migrateProject,
  validateProject,
  compileDescriptor,
  renderCompositionFrameSvg,
  createLayerOfKind,
} from './index';
describe('Studio Node API v1', () => {
  it('validates required capabilities before authoring', () => {
    expect(studioNodeApi.version).toBe(1);
    expect(() =>
      assertStudioCapabilities(['compositionScripts', 'transformHierarchy2D']),
    ).not.toThrow();
    expect(() => assertStudioCapabilities(['missing' as never])).toThrow('missing');
  });
  it('supports Dev chart models and migrated projects without a browser', () => {
    const project = createProject();
    project.compositions[0]!.layers.push(createLayerOfKind('chart'));
    const migrated = migrateProject(project),
      comp = migrated.compositions[0]!;
    expect(validateProject(migrated).valid).toBe(true);
    expect(compileDescriptor(comp).layers[0]!.element.type).toBe('chart');
    expect(renderCompositionFrameSvg(migrated, comp.id, 0).svg).toContain('<svg');
  });
});

for (const name of ['atlas-news-package', 'news-lower-third']) {
  it('loads and samples the Dev template ' + name, () => {
    const project = migrateProject(
      JSON.parse(
        readFileSync(new URL('../../../templates/' + name + '.ogs', import.meta.url), 'utf8'),
      ),
    );
    expect(validateProject(project).valid).toBe(true);
    for (const comp of project.compositions) {
      expect(compileDescriptor(comp).layers.length).toBeGreaterThan(0);
      const baseline = renderCompositionFrameSvg(project, comp.id, 12).svg;
      for (const frame of [0, 25, 50])
        expect(renderCompositionFrameSvg(project, comp.id, frame).svg).toContain('<svg');
      expect(renderCompositionFrameSvg(project, comp.id, 12).svg).toBe(baseline);
    }
  });
}
