import { create } from 'zustand';
import { useProjectStore } from './projectStore';
import { useTestDataStore } from './testDataStore';
import { createLinkedJsonReader, parseLinkedJson } from './linkedJsonReader';

interface Link {
  key: string;
  name: string;
  handle: FileSystemFileHandle;
}
interface Status {
  name: string;
  error?: string;
}
export const useLinkedJsonFiles = create<{ links: Record<string, Status> }>(() => ({ links: {} }));
export const linkedJsonKey = (project: string, composition: string, field: string) =>
  JSON.stringify([project, composition, field]);
const links = new Map<string, Link>();
const readers = new Map<string, ReturnType<typeof createLinkedJsonReader>>();
let ready: Promise<void> | undefined;

function storage<T>(operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('ograf-linked-json', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('links', { keyPath: 'key' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('links', 'readwrite');
      const request = operation(transaction.objectStore('links'));
      transaction.oncomplete = () => {
        db.close();
        resolve(request.result);
      };
      transaction.onerror = transaction.onabort = () => {
        db.close();
        reject(transaction.error);
      };
    };
  });
}
function status(key: string, value?: Status) {
  useLinkedJsonFiles.setState((state) => {
    if (state.links[key]?.name === value?.name && state.links[key]?.error === value?.error)
      return state;
    const next = { ...state.links };
    if (value) next[key] = value;
    else delete next[key];
    return { links: next };
  });
}
async function initialize() {
  ready ??= storage((store) => store.getAll())
    .then((saved: Link[]) => {
      for (const link of saved) {
        links.set(link.key, link);
        status(link.key, { name: link.name });
      }
    })
    .catch((error) => {
      ready = undefined;
      throw error;
    });
  return ready;
}
export async function linkJsonFile(key: string) {
  if (!window.showOpenFilePicker)
    throw new Error(
      'Linking files requires a browser with file-system access, such as Chrome or Edge.',
    );
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [{ description: 'JSON data', accept: { 'application/json': ['.json'] } }],
  });
  if (!handle) return;
  const file = await handle.getFile();
  if (file.size > 1024 * 1024) throw new Error('JSON file exceeds 1 MB.');
  parseLinkedJson(await file.text());
  await initialize();
  const link = { key, name: file.name, handle };
  await storage((store) => store.put(link));
  readers.get(key)?.dispose();
  readers.delete(key);
  links.set(key, link);
  status(key, { name: link.name });
  await reloadLinkedJsonFile(key);
}
export async function unlinkJsonFile(key: string) {
  await initialize();
  await storage((store) => store.delete(key));
  readers.get(key)?.dispose();
  readers.delete(key);
  links.delete(key);
  status(key);
}
export async function reloadLinkedJsonFile(key: string) {
  await initialize();
  const link = links.get(key);
  if (!link) return;
  const [projectId, compositionId, fieldId] = JSON.parse(key) as string[];
  const project = useProjectStore.getState().project;
  const composition = project.compositions.find((c) => c.id === compositionId);
  const field = composition?.dataFields.find((f) => f.id === fieldId);
  if (project.id !== projectId || !composition || field?.type !== 'object') return;
  let reader = readers.get(key);
  if (!reader) {
    const stillCurrent = () =>
      links.get(key) === link &&
      useProjectStore.getState().project.id === project.id &&
      useProjectStore
        .getState()
        .project.compositions.find((c) => c.id === composition.id)
        ?.dataFields.some((f) => f.id === field.id && f.type === 'object');
    reader = createLinkedJsonReader(
      () => link.handle.getFile(),
      (value) => {
        if (!stillCurrent()) return;
        const current = useProjectStore
          .getState()
          .project.compositions.find((c) => c.id === composition.id)!
          .dataFields.find((f) => f.id === field.id)!;
        if (JSON.stringify(current.defaultValue) !== JSON.stringify(value)) {
          useProjectStore.setState((state) => ({
            project: {
              ...state.project,
              compositions: state.project.compositions.map((c) =>
                c.id !== composition.id
                  ? c
                  : {
                      ...c,
                      dataFields: c.dataFields.map((f) =>
                        f.id !== field.id ? f : { ...f, defaultValue: value },
                      ),
                    },
              ),
            },
          }));
        }
        if (JSON.stringify(useTestDataStore.getState().values[field.id]) !== JSON.stringify(value))
          useTestDataStore.getState().setValue(field.id, value);
      },
      (error) => {
        if (stillCurrent())
          status(key, {
            name: link.name,
            ...(error ? { error: `${error} Re-link the file if access was revoked.` } : {}),
          });
      },
    );
    readers.set(key, reader);
  }
  await reader.refresh();
}
export function installLinkedJsonFiles() {
  // Restore connections only. Reading a file requires an explicit Link or Reload action.
  void initialize().catch(() => {});
  return () => {
    for (const reader of readers.values()) reader.dispose();
    readers.clear();
  };
}
