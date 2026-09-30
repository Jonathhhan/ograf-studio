import type { Project } from '@ograf-editor/scene-model';
import { create } from 'zustand';

const LEGACY_KEY = 'ograf-editor:autosave-project';
const CURRENT_KEY = 'ograf-editor:autosave-current';
const HISTORY_KEY = 'ograf-editor:autosave-history';
export const MAX_AUTOSAVE_SNAPSHOTS = 10;
export interface AutosaveSnapshot {
  id: string;
  savedAt: number;
  project: Project;
}
export const useAutosaveStatus = create<{
  state: 'idle' | 'pending' | 'saved' | 'error' | 'paused';
  message: string;
}>(() => ({ state: 'idle', message: '' }));

export interface AutosaveBackend {
  append(snapshot: AutosaveSnapshot): Promise<void>;
  list(): Promise<AutosaveSnapshot[]>;
  latest?(): Promise<AutosaveSnapshot | undefined>;
  clear(): Promise<void>;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ograf-editor-recovery', 2);
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error('Recovery storage did not respond.'));
    }, 3000);
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains('snapshots')
        ? request.transaction!.objectStore('snapshots')
        : request.result.createObjectStore('snapshots', { keyPath: 'id' });
      if (!store.indexNames.contains('savedAt')) store.createIndex('savedAt', 'savedAt');
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
    request.onblocked = () => {
      expired = true;
      clearTimeout(timer);
      reject(new Error('Recovery storage is blocked by another tab.'));
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (expired) request.result.close();
      else {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      }
    };
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('snapshots', mode);
    let result: T;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('Recovery transaction failed.'));
    };
    try {
      operation(tx.objectStore('snapshots'), (value) => {
        result = value;
      });
    } catch (error) {
      tx.abort();
      db.close();
      reject(error);
    }
  });
}

const newestFirst = (snapshots: AutosaveSnapshot[]) =>
  snapshots.sort((a, b) => b.savedAt - a.savedAt || b.id.localeCompare(a.id));
const indexedDbBackend: AutosaveBackend = {
  append: (snapshot) =>
    transaction<void>('readwrite', (store, done) => {
      store.put(snapshot);
      const request = store.index('savedAt').openKeyCursor(null, 'prev');
      let retained = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          done();
          return;
        }
        if (++retained > MAX_AUTOSAVE_SNAPSHOTS) store.delete(cursor.primaryKey);
        cursor.continue();
      };
    }),
  latest: () =>
    transaction<AutosaveSnapshot | undefined>('readonly', (store, done) => {
      const request = store.index('savedAt').openCursor(null, 'prev');
      request.onsuccess = () => done(request.result?.value as AutosaveSnapshot | undefined);
    }),
  list: () =>
    transaction<AutosaveSnapshot[]>('readonly', (store, done) => {
      const request = store.getAll();
      request.onsuccess = () => done(newestFirst(request.result as AutosaveSnapshot[]));
    }),
  clear: () =>
    transaction<void>('readwrite', (store, done) => {
      store.clear();
      done();
    }),
};

const validProject = (value: unknown): value is Project =>
  Boolean(
    value &&
    typeof value === 'object' &&
    'compositions' in value &&
    Array.isArray(value.compositions),
  );

/** Injectable storage keeps quota, failure, and recovery behavior independently testable. */
export function createAutosaveStorage(
  backend: AutosaveBackend = indexedDbBackend,
  storage: () => Storage = () => localStorage,
) {
  let queue = Promise.resolve();
  let sequence = 0;
  const localHistory = (): AutosaveSnapshot[] => {
    try {
      const parsed: unknown = JSON.parse(storage().getItem(HISTORY_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((entry) => validProject(entry?.project)) : [];
    } catch {
      return [];
    }
  };
  const load = (): Project | null => {
    try {
      const current = JSON.parse(storage().getItem(CURRENT_KEY) ?? 'null');
      if (validProject(current?.project)) return current.project;
      const value: unknown = JSON.parse(storage().getItem(LEGACY_KEY) ?? 'null');
      return validProject(value) ? value : null;
    } catch {
      return null;
    }
  };
  const list = async (latestOnly = false): Promise<AutosaveSnapshot[]> => {
    const local = localHistory();
    try {
      const current = JSON.parse(storage().getItem(CURRENT_KEY) ?? 'null');
      if (validProject(current?.project)) local.push(current as AutosaveSnapshot);
    } catch {
      /* Use durable history when the mirror is unavailable. */
    }
    try {
      const remote =
        latestOnly && backend.latest
          ? [await backend.latest()].filter((entry): entry is AutosaveSnapshot => Boolean(entry))
          : await backend.list();
      const snapshots = newestFirst([
        ...new Map([...local, ...remote].map((entry) => [entry.id, entry])).values(),
      ]);
      if (snapshots.length) return snapshots;
      const legacy = load();
      return legacy ? [{ id: 'legacy', savedAt: 0, project: legacy }] : [];
    } catch {
      if (local.length)
        return newestFirst([...new Map(local.map((entry) => [entry.id, entry])).values()]);
      const legacy = load();
      return legacy ? [{ id: 'legacy', savedAt: 0, project: legacy }] : [];
    }
  };
  const save = (project: Project): Promise<void> => {
    const generation = ++sequence;
    const status = (value: ReturnType<typeof useAutosaveStatus.getState>) => {
      if (generation === sequence) useAutosaveStatus.setState(value);
    };
    let snapshot: AutosaveSnapshot;
    try {
      const savedAt = Date.now();
      snapshot = {
        id: `${savedAt}-${String(generation).padStart(8, '0')}-${crypto.randomUUID()}`,
        savedAt,
        project: structuredClone(project),
      };
    } catch {
      status({
        state: 'error',
        message:
          'Autosave failed: the project could not be serialized. Save Project to keep your work.',
      });
      return Promise.resolve();
    }
    // This synchronous mirror also protects the final edit during pagehide.
    let mirrored = false;
    try {
      storage().setItem(CURRENT_KEY, JSON.stringify(snapshot));
      mirrored = true;
    } catch {
      /* IndexedDB can still save larger projects. */
    }
    status({ state: 'pending', message: 'Saving recovery snapshot…' });
    queue = queue
      .then(async () => {
        try {
          await backend.append(snapshot);
          status({ state: 'saved', message: 'Recovery snapshot saved' });
        } catch {
          try {
            // One atomic write retains previous versions if quota is exhausted.
            storage().setItem(
              HISTORY_KEY,
              JSON.stringify([snapshot, ...localHistory()].slice(0, MAX_AUTOSAVE_SNAPSHOTS)),
            );
            status({
              state: 'saved',
              message: 'Recovery saved in browser fallback storage',
            });
          } catch {
            status({
              state: 'error',
              message: mirrored
                ? 'Only the latest autosave was saved; recovery history is unavailable. Save Project for a backup.'
                : 'Autosave failed: browser storage is unavailable or full. Save Project now to keep your work.',
            });
          }
        }
      })
      .catch(() => {
        status({
          state: 'error',
          message: 'Autosave failed. Save Project now to keep your work.',
        });
      });
    return queue;
  };
  return {
    save,
    load,
    list: () => list(),
    latest: async () => (await list(true))[0]?.project ?? load(),
    clear: async () => {
      await queue;
      storage().removeItem(LEGACY_KEY);
      storage().removeItem(CURRENT_KEY);
      storage().removeItem(HISTORY_KEY);
      await backend.clear();
    },
  };
}

const autosaves = createAutosaveStorage();
export const saveAutosave = autosaves.save;
export const loadAutosave = autosaves.load;
export const listAutosaveSnapshots = autosaves.list;
export const loadLatestAutosave = autosaves.latest;
export const clearAutosave = autosaves.clear;
