import { describe, expect, it } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import {
  createAutosaveStorage,
  MAX_AUTOSAVE_SNAPSHOTS,
  useAutosaveStatus,
  type AutosaveBackend,
  type AutosaveSnapshot,
} from './autosaveStorage';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}
const unavailable: AutosaveBackend = {
  append: async () => {
    throw new Error('Unavailable');
  },
  list: async () => {
    throw new Error('Unavailable');
  },
  clear: async () => {},
};

describe('autosave recovery', () => {
  it('retains bounded fallback snapshots and restores legacy browser saves', async () => {
    const local = memoryStorage();
    const original = createProject({ name: 'Legacy' });
    local.setItem('ograf-editor:autosave-project', JSON.stringify(original));
    const recovery = createAutosaveStorage(unavailable, () => local);
    expect(recovery.load()?.name).toBe('Legacy');
    for (let index = 0; index < 12; index++)
      await recovery.save({ ...original, name: `Draft ${index}` });
    const snapshots = await recovery.list();
    expect(new Set(snapshots.map((entry) => entry.id)).size).toBe(MAX_AUTOSAVE_SNAPSHOTS);
    expect((await recovery.latest())?.name).toBe('Draft 11');
    expect(snapshots.some((entry) => entry.project.name === 'Draft 10')).toBe(true);
  });

  it('uses durable storage when the synchronous browser mirror exceeds quota', async () => {
    const snapshots: AutosaveSnapshot[] = [];
    const recovery = createAutosaveStorage(
      {
        append: async (snapshot) => {
          snapshots.unshift(snapshot);
        },
        list: async () => snapshots,
        clear: async () => {},
      },
      () => {
        throw new Error('Quota exceeded');
      },
    );
    await recovery.save(createProject({ name: 'Large project' }));
    expect(useAutosaveStatus.getState().state).toBe('saved');
    expect((await recovery.latest())?.name).toBe('Large project');
  });

  it('reports complete persistence failure instead of claiming success', async () => {
    const recovery = createAutosaveStorage(unavailable, () => {
      throw new Error('Quota exceeded');
    });
    await recovery.save(createProject());
    expect(useAutosaveStatus.getState()).toMatchObject({
      state: 'error',
      message: expect.stringContaining('Save Project now'),
    });
  });

  it('serializes writes and restores a newer pagehide mirror over older durable history', async () => {
    const local = memoryStorage();
    const stored: AutosaveSnapshot[] = [];
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recovery = createAutosaveStorage(
      {
        append: async (snapshot) => {
          await blocked;
          stored.unshift(snapshot);
        },
        list: async () => stored,
        clear: async () => {},
      },
      () => local,
    );
    const first = recovery.save(createProject({ name: 'First' }));
    const second = recovery.save(createProject({ name: 'Latest' }));
    expect((await recovery.latest())?.name).toBe('Latest');
    release();
    await Promise.all([first, second]);
    expect(stored.map((entry) => entry.project.name)).toEqual(['Latest', 'First']);
  });
});
