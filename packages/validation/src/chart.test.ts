import { describe, expect, it } from 'vitest';
import {
  createChartLayer,
  createFieldDefinition,
  createProject,
  computeKeyframeFrames,
  defaultTransformForRole,
  createLayerKeyframe,
} from '@ograf-editor/scene-model';
import { validateProject } from './validateProject';

describe('Chart.js project validation', () => {
  it('accepts a chart and catches malformed datasets', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createChartLayer();
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('chart', keyframe.role),
      ),
    );
    composition.layers.push(layer);
    expect(validateProject(project).errors).toEqual([]);
    if (layer.element.type !== 'chart') throw new Error('Expected chart');
    layer.element.data.datasets[0]!.data = [1];
    expect(validateProject(project).errors.join(' ')).toContain('one finite number per label');
  });

  it('rejects malformed default data on a chart binding', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const layer = createChartLayer();
    layer.keyframes = composition.keyframes.map((keyframe, index) =>
      createLayerKeyframe(
        computeKeyframeFrames(composition)[index]!.frame,
        defaultTransformForRole('chart', keyframe.role),
      ),
    );
    const field = createFieldDefinition('textarea', { key: 'chart_data', defaultValue: '{bad' });
    layer.bindings = [{ fieldId: field.id, targetProperty: 'data' }];
    composition.layers.push(layer);
    composition.dataFields.push(field);
    expect(validateProject(project).errors.join(' ')).toContain('chart field default');
  });
});
