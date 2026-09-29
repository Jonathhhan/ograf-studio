import { createScriptConsole } from './scriptConsole';
import { parseFrozenJsonResource } from './jsonResources';
import { transform } from 'sucrase';
import type { CompositionScripting } from './types';
import { SCRIPT_VECTOR_NAMES } from './scriptVectors';

const factories = new Map<
  string,
  (exports: object, require: (path: string) => object, console: Console) => void
>();
const libraries = new WeakMap<CompositionScripting, Map<number, Record<string, object>>>();
const reservedNames = new Set([
  'data',
  'comp',
  'timeline',
  'frame',
  'time',
  'thisLayer',
  'thisProperty',
  'value',
  'valueAtTime',
  'sourceRectAtTime',
  'layer',
  'layerById',
  'lerp',
  'clamp',
  'ease',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'position',
  'size',
  'transformOrigin',
  'json',
  'text',
  'transformOriginX',
  'transformOriginY',
  'modules',
  'scope',
  // A fixed vocabulary keeps project filenames portable across browser and Node hosts.
  ...(
    'globalThis Infinity NaN undefined Object Function Boolean Symbol Error AggregateError ' +
    'EvalError RangeError ReferenceError SyntaxError TypeError URIError Number BigInt Math Date ' +
    'String RegExp Array Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array ' +
    'Int32Array Uint32Array BigInt64Array BigUint64Array Float32Array Float64Array Map Set ' +
    'WeakMap WeakSet ArrayBuffer SharedArrayBuffer DataView Atomics JSON Promise Reflect Proxy ' +
    'Intl WebAssembly WeakRef FinalizationRegistry console eval parseInt parseFloat isNaN ' +
    'isFinite decodeURI decodeURIComponent encodeURI encodeURIComponent'
  ).split(' '),
]);
for (const name of SCRIPT_VECTOR_NAMES) reservedNames.add(name);

/** Flat project files use their basename as the expression namespace. */
export function scriptModuleName(fileName: string): string {
  const extension = '(?:m?js|json)';
  if (!new RegExp(`^[A-Za-z_$][\\w$]*\\.${extension}$`).test(fileName))
    throw new Error('Use a .js, .mjs or .json filename (letters, digits, _ or $).');
  const name = fileName.replace(/\.(?:m?js|json)$/, '');
  if (reservedNames.has(name)) throw new Error('Reserved module name: ' + name);
  // Let the host reject reserved JavaScript words, rather than maintaining a keyword parser.
  new Function('"use strict"; const ' + name + ' = 0;');
  return name;
}

function factory(source: string) {
  const cached = factories.get(source);
  if (cached) return cached;
  const code = transform(source, {
    transforms: ['imports'],
    disableESTransforms: true,
  }).code;
  const execute = new Function('exports', 'require', 'console', code) as (
    exports: object,
    require: (path: string) => object,
    console: Console,
  ) => void;
  if (factories.size >= 128) factories.delete(factories.keys().next().value!);
  factories.set(source, execute);
  return execute;
}

export function scriptModuleSyntaxError(source: string): string | undefined {
  try {
    factory(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

/** Immutable project settings own library state; unrelated compositions never share exports. */
export function scriptModules(
  settings?: CompositionScripting,
  apiVersion = 1,
): Record<string, object> {
  if (!settings?.modules.length) return Object.create(null);
  let byVersion = libraries.get(settings);
  if (!byVersion) libraries.set(settings, (byVersion = new Map()));
  const cached = byVersion.get(apiVersion);
  if (cached) return cached;
  const modules = Object.create(null) as Record<string, object>;
  const files = new Map<string, string>();
  const names = new Set<string>();
  for (const file of settings.modules) {
    const name = scriptModuleName(file.fileName);
    if (names.has(name)) throw new Error('Duplicate script resource name: ' + name);
    names.add(name);
    files.set(file.fileName, file.source);
    if (!file.fileName.endsWith('.json'))
      Object.defineProperty(modules, name, { enumerable: true, get: () => load(file.fileName) });
  }
  const loaded = new Map<string, object>();
  const failures = new Map<string, Error>();
  const loading = new Set<string>();
  const load = (fileName: string): object => {
    if (failures.has(fileName)) throw failures.get(fileName);
    if (loading.has(fileName))
      throw new Error('Circular module import: ' + [...loading, fileName].join(' -> '));
    if (loaded.has(fileName)) return loaded.get(fileName)!;
    const source = files.get(fileName);
    if (source === undefined)
      throw new Error('Module is not included in this composition: ' + fileName);
    loading.add(fileName);
    try {
      if (fileName.endsWith('.json')) {
        const resource = parseFrozenJsonResource(source);
        loaded.set(fileName, resource);
        return resource;
      }
      const exports = Object.create(null);
      factory(source)(
        exports,
        (path) => {
          if (!/^\.\/[A-Za-z_$][\w$]*\.(?:m?js|json)$/.test(path))
            throw new Error('Import a bundled file with a relative path, such as ./helpers.js.');
          return load(path.slice(2));
        },
        createScriptConsole(fileName),
      );
      const namespace = new Proxy(exports, {
        set: () => false,
        defineProperty: () => false,
        deleteProperty: () => false,
      });
      loaded.set(fileName, namespace);
      return namespace;
    } catch (error) {
      const failure = new Error(
        fileName + ': ' + (error instanceof Error ? error.message : String(error)),
      );
      failures.set(fileName, failure);
      throw failure;
    } finally {
      loading.delete(fileName);
    }
  };
  Object.defineProperty(modules, 'json', {
    enumerable: true,
    value: (fileName: string) => {
      if (typeof fileName !== 'string' || !fileName.endsWith('.json'))
        throw new Error('json() expects an included .json filename.');
      return load(fileName);
    },
  });
  Object.freeze(modules);
  byVersion.set(apiVersion, modules);
  return modules;
}
