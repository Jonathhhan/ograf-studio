/** Scripting views over Studio's scalar transform fields; never stored in project geometry. */
export const SCRIPT_VECTOR_NAMES = ['position', 'size', 'transformOrigin'] as const;
export type ScriptVectorName = (typeof SCRIPT_VECTOR_NAMES)[number];
type Axis = 0 | 1;
type Read = (property: string) => number;
type Write = (property: string, value: number) => void;

export function isScriptVectorName(name: string): name is ScriptVectorName {
  return (SCRIPT_VECTOR_NAMES as readonly string[]).includes(name);
}

const fields = {
  position: ['x', 'y'],
  size: ['width', 'height'],
  transformOrigin: ['transformOriginX', 'transformOriginY'],
} as const;

function readScriptVectorComponent(name: ScriptVectorName, axis: Axis, read: Read): number {
  return read(fields[name][axis]);
}

export function readScriptVector(name: ScriptVectorName, read: Read): readonly [number, number] {
  return Object.freeze([
    readScriptVectorComponent(name, 0, read),
    readScriptVectorComponent(name, 1, read),
  ]);
}

function finite(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Vector components must be finite numbers.');
}

function scalarValue(name: ScriptVectorName, value: unknown): number {
  finite(value);
  if (name === 'transformOrigin' && (value < 0 || value > 1))
    throw new Error('transformOrigin components must be between 0 and 1.');
  return value;
}

/** Fixed-length live arrays. Non-enumerable aliases preserve existing scalar object spreads. */
export function defineScriptVectors(target: object, read: Read, write?: Write): void {
  for (const name of SCRIPT_VECTOR_NAMES) {
    const vector: [number, number] = [0, 0];
    for (const axis of [0, 1] as const)
      Object.defineProperty(vector, axis, {
        enumerable: true,
        get: () => readScriptVectorComponent(name, axis, read),
        ...(write
          ? {
              set: (value: unknown) => write(fields[name][axis], scalarValue(name, value)),
            }
          : {}),
      });
    Object.freeze(vector);
    Object.defineProperty(target, name, {
      get: () => vector,
      ...(write
        ? {
            set: (value: unknown) => {
              if (!Array.isArray(value) || value.length !== 2)
                throw new Error(name + ' must be an array of two finite numbers.');
              const first = scalarValue(name, value[0]);
              const second = scalarValue(name, value[1]);
              write(fields[name][0], first);
              write(fields[name][1], second);
            },
          }
        : {}),
    });
  }
}
