import { easedProgress } from './layerAnimation';
import type { EasingPreset, KeyframeRole } from './types';

export type ExpressionScope = Record<string, number | string>;
export type ExpressionLayerResolver = (name: string, property: string) => number;
export const EXPRESSION_API_VERSION = 1;
export type ExpressionLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
export interface ExpressionEvaluationOptions {
  apiVersion?: number;
  resolveLayerById?: ExpressionLayerResolver;
  onLog?: (level: ExpressionLogLevel, args: unknown[]) => void;
}
type CompiledExpression = (
  scope: ExpressionScope,
  resolveLayer?: ExpressionLayerResolver,
  options?: ExpressionEvaluationOptions,
) => number;

/** Authored timeline positions; playback speed and data fields do not move these boundaries. */
export function expressionTimelineScope(
  keyframes: ReadonlyArray<{ frame: number; role: KeyframeRole }>,
  frame?: number,
): ExpressionScope {
  const startFrame = keyframes.find((key) => key.role === 'start')?.frame ?? 0;
  const endFrame = keyframes.find((key) => key.role === 'end')?.frame ?? startFrame;
  const steps = keyframes.filter((key) => key.role === 'step');
  const exitStart = steps.at(-1)?.frame ?? startFrame;
  return {
    'timeline.startFrame': startFrame,
    'timeline.endFrame': endFrame,
    ...(steps.length > 0
      ? {
          'timeline.firstStepFrame': steps[0]!.frame,
          'timeline.lastStepFrame': steps[steps.length - 1]!.frame,
        }
      : {}),
    ...(frame === undefined
      ? {}
      : {
          'timeline.exitProgress':
            endFrame > exitStart
              ? Math.min(1, Math.max(0, (frame - exitStart) / (endFrame - exitStart)))
              : Number(frame >= endFrame),
        }),
  };
}

/** Only scalar fields with identifier keys can be addressed as data.fieldKey. */
export function expressionDataScope(data: Record<string, unknown>): ExpressionScope {
  const scope: ExpressionScope = Object.create(null);
  for (const [name, value] of Object.entries(data))
    if (
      /^[A-Za-z_$][\w$]*$/.test(name) &&
      (typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)))
    )
      scope['data.' + name] = typeof value === 'boolean' ? Number(value) : value;
  return scope;
}

function numeric(value: unknown): number {
  if (typeof value !== 'number') throw new Error('Expected a number.');
  return value;
}

function helper(name: 'lerp' | 'clamp' | 'ease', ...args: unknown[]): number {
  if (args.length !== (name === 'ease' ? 4 : 3))
    throw new Error(
      name === 'ease'
        ? 'ease requires four arguments: start, end, progress and an easing preset.'
        : name + ' requires three arguments.',
    );
  const [a, b, c] = args.slice(0, 3).map(numeric) as [number, number, number];
  if (name === 'clamp') return Math.min(c, Math.max(b, a));
  if (name === 'lerp') return a + (b - a) * c;
  const preset = args[3];
  if (typeof preset !== 'string') throw new Error('Expected an easing preset name.');
  const progress = easedProgress(Math.min(1, Math.max(0, c)), preset as EasingPreset);
  if (progress === undefined) throw new Error('Unknown easing preset "' + preset + '".');
  return a + (b - a) * progress;
}

/** Preserve lazy getters: copying their values would eagerly evaluate unrelated dependencies. */
function evaluationScope(
  scope: ExpressionScope,
  resolveLayer?: ExpressionLayerResolver,
  options: ExpressionEvaluationOptions = {},
) {
  const context = Object.create(null);
  const thisLayer = Object.create(null);
  for (const key of Object.getOwnPropertyNames(scope)) {
    const descriptor = Object.getOwnPropertyDescriptor(scope, key)!;
    const dot = key.lastIndexOf('.');
    if (dot < 0) {
      Object.defineProperty(context, key, descriptor);
      Object.defineProperty(thisLayer, key, descriptor);
    } else {
      const name = key.slice(0, dot);
      if (!Object.hasOwn(context, name)) context[name] = Object.create(null);
      Object.defineProperty(context[name], key.slice(dot + 1), descriptor);
    }
  }
  Object.assign(context, {
    thisLayer,
    layerById: (id: string) =>
      new Proxy(Object.create(null), {
        get: (_target, property) => {
          if (typeof property !== 'string') return undefined;
          if (!options.resolveLayerById) throw new Error('Layer ID lookup is unavailable.');
          return options.resolveLayerById(id, property);
        },
      }),
    ...(options.onLog
      ? {
          console: new Proxy(console, {
            get: (target, property) => {
              if (['log', 'info', 'warn', 'error', 'debug'].includes(String(property)))
                return (...args: unknown[]) => options.onLog!(property as ExpressionLogLevel, args);
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          }),
        }
      : {}),
    layer: (name: string) =>
      new Proxy(Object.create(null), {
        get: (_target, property) => {
          if (typeof property !== 'string') return undefined;
          if (resolveLayer) return resolveLayer(name, property);
          const key = name + '.' + property;
          if (!Object.hasOwn(scope, key)) throw new Error('Unknown layer property "' + key + '".');
          return scope[key];
        },
      }),
    lerp: (...args: unknown[]) => helper('lerp', ...args),
    clamp: (...args: unknown[]) => helper('clamp', ...args),
    ease: (...args: unknown[]) => helper('ease', ...args),
  });
  return context;
}

/** Trusted project JavaScript, compiled by the host engine; this is not a sandbox. */
function compileExpression(source: string): CompiledExpression {
  const compile = (body: string) =>
    new Function(
      'scope',
      'with (scope) { return (function () { "use strict";\n' + body + '\n}).call(undefined); }',
    ) as (scope: object) => unknown;
  let execute: (scope: object) => unknown;
  try {
    execute = compile('return (\n' + source + '\n);');
  } catch {
    // Keep the existing single-formula syntax with an optional final semicolon/comments.
    const formula = source.replace(/;(\s*(?:\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\s)*)$/, '$1');
    try {
      execute = compile('return (\n' + formula + '\n);');
    } catch {
      execute = compile(source);
    }
  }
  return (scope, resolveLayer, options) => {
    const result = execute(evaluationScope(scope, resolveLayer, options));
    if (typeof result !== 'number') throw new Error('Expression result must be a number.');
    if (!Number.isFinite(result)) throw new Error('Expression result is not finite.');
    return result;
  };
}

// Bound retained source/closures while avoiding parsing unchanged formulas on every frame.
const compiledExpressions = new Map<string, CompiledExpression>();
function compiledExpression(source: string): CompiledExpression {
  const cached = compiledExpressions.get(source);
  if (cached) return cached;
  const compiled = compileExpression(source);
  if (compiledExpressions.size >= 256)
    compiledExpressions.delete(compiledExpressions.keys().next().value!);
  compiledExpressions.set(source, compiled);
  return compiled;
}

/** Checks grammar without reading data or evaluating layer dependencies. */
export function expressionSyntaxError(source: string): string | undefined {
  if (!source.trim()) return undefined;
  try {
    compiledExpression(source);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Evaluates with fresh local constants on every call, including recursive layer references. */
export function evaluateExpression(
  source: string,
  scope: ExpressionScope,
  resolveLayer?: ExpressionLayerResolver,
  options: ExpressionEvaluationOptions = {},
): number {
  const version = options.apiVersion ?? 1;
  if (version !== EXPRESSION_API_VERSION)
    throw new Error('Unsupported expression API version: ' + version);
  return compiledExpression(source)(scope, resolveLayer, options);
}
