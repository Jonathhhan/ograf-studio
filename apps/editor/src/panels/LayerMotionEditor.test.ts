import { beforeEach, describe, expect, it } from 'vitest';
import { getLayerPropertyValueAtFrame } from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import { getActiveComposition, useProjectStore } from '../state/projectStore';

describe('Animate In / Out', () => {
  beforeEach(() => useProjectStore.getState().newProject());

  it('bakes one choice into every selected unlocked layer', () => {
    const store = useProjectStore.getState();
    const first = store.addLayer('rectangle');
    const second = store.addLayer('text');
    const locked = store.addLayer('ellipse');
    useProjectStore.setState((current) => {
      const composition = getActiveComposition(current.project, current.activeCompositionId);
      const lockedLayer = composition.layers.find((layer) => layer.id === locked)!;
      return {
        project: {
          ...current.project,
          compositions: current.project.compositions.map((candidate) =>
            candidate.id === composition.id
              ? {
                  ...candidate,
                  layers: candidate.layers.map((layer) =>
                    layer === lockedLayer ? { ...layer, isLocked: true } : layer,
                  ),
                }
              : candidate,
          ),
        },
      };
    });

    useProjectStore
      .getState()
      .setLayerMotion([first, second, locked], 'in', { style: 'fade', durationFrames: 6 });
    const state = useProjectStore.getState();
    const composition = getActiveComposition(state.project, state.activeCompositionId);
    const byId = (id: string) => composition.layers.find((layer) => layer.id === id)!;

    for (const id of [first, second]) {
      expect(getLayerPropertyValueAtFrame(byId(id), 'opacity', 0)).toBe(0);
      expect(getLayerPropertyValueAtFrame(byId(id), 'opacity', 12)).toBe(1);
      expect(byId(id).motion?.in).toMatchObject({ style: 'fade', durationFrames: 6 });
    }
    expect(byId(locked).motion).toBeUndefined();
    expect(validateProject(state.project).errors).toEqual([]);
  });
});
