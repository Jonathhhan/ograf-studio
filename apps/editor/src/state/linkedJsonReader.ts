import type { FieldObjectValue } from '@ograf-editor/scene-model';

export function parseLinkedJson(text: string): FieldObjectValue {
  const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The JSON file must contain an object.');
  const check = (value: unknown, depth: number) => {
    if (depth > 100) throw new Error('JSON nesting exceeds 100 levels.');
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('JSON numbers must be finite.');
    if (value && typeof value === 'object')
      for (const child of Object.values(value)) check(child, depth + 1);
  };
  check(value, 0);
  return value as FieldObjectValue;
}

/** Serialized reads; disposal also discards a read already in flight. */
export function createLinkedJsonReader(
  read: () => Promise<{ size: number; text(): Promise<string> }>,
  accept: (value: FieldObjectValue) => void,
  report: (error?: string) => void,
) {
  let disposed = false;
  let pending: Promise<void> | undefined;
  let previous: string | undefined;
  let parsed: FieldObjectValue | undefined;
  return {
    refresh(): Promise<void> {
      if (disposed) return Promise.resolve();
      if (pending) return pending;
      pending = (async () => {
        try {
          const file = await read();
          if (file.size > 1024 * 1024) throw new Error('JSON file exceeds 1 MB.');
          const text = await file.text();
          if (disposed) return;
          if (text !== previous) {
            parsed = parseLinkedJson(text);
            previous = text;
          }
          accept(parsed!);
          report();
        } catch (error) {
          if (!disposed) report(error instanceof Error ? error.message : String(error));
        }
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    dispose() {
      disposed = true;
    },
  };
}
