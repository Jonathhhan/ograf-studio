import type {
  Composition,
  LayerVisualRule,
  VisualRuleAction,
  VisualRuleCondition,
  VisualRuleMatch,
  VisualRuleOperator,
  VisualRuleTrigger,
} from './types';
import { createId } from './id';

export function visualRuleValue(root: unknown, path: string[] = []): unknown {
  let value = root;
  for (const segment of path) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/* ------------------------------------------------------------------------------------------------
 * Vocabulary
 * --------------------------------------------------------------------------------------------- */

export const VISUAL_RULE_TRIGGER_VALUES = [
  'data',
  'hover',
  'click',
  'double-click',
  'pointer-enter',
  'pointer-leave',
  'play',
  'step',
  'stop',
  'custom-action',
] as const satisfies readonly VisualRuleTrigger[];

export const VISUAL_RULE_OPERATOR_VALUES = [
  'equals',
  'not-equals',
  'empty',
  'not-empty',
  'greater-than',
  'less-than',
  'greater-or-equal',
  'less-or-equal',
  'between',
  'contains',
  'not-contains',
  'starts-with',
  'ends-with',
  'one-of',
  'not-one-of',
  'changed',
  'increased',
  'decreased',
] as const satisfies readonly VisualRuleOperator[];

// Compile-time guards that the lists above stay complete.
type Missing<All, Listed> = Exclude<All, Listed> extends never ? true : never;
const _triggersComplete: Missing<VisualRuleTrigger, (typeof VISUAL_RULE_TRIGGER_VALUES)[number]> =
  true;
const _operatorsComplete: Missing<
  VisualRuleOperator,
  (typeof VISUAL_RULE_OPERATOR_VALUES)[number]
> = true;
void _triggersComplete;
void _operatorsComplete;

/* ------------------------------------------------------------------------------------------------
 * Comparison
 * --------------------------------------------------------------------------------------------- */

export const VISUAL_RULE_EVENT_OPERATORS: ReadonlySet<VisualRuleOperator> = new Set([
  'changed',
  'increased',
  'decreased',
]);

/** Operators that compare against nothing, so they need no value or comparison field. */
export const VISUAL_RULE_UNARY_OPERATORS: ReadonlySet<VisualRuleOperator> = new Set([
  'empty',
  'not-empty',
  'changed',
  'increased',
  'decreased',
]);

export interface VisualRuleMatchOptions {
  ignoreCase?: boolean;
}

function empty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** A finite number for numbers and numeric text; `null` for anything else, including ''. */
function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown, ignoreCase: boolean): string {
  const result =
    value === undefined || value === null
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return ignoreCase ? result.toLocaleLowerCase() : result;
}

/**
 * Authored comparison values usually arrive as text from an input box while data fields carry
 * numbers and booleans, so equality coerces: numerically when either side is a number, by
 * `true`/`false` spelling when either side is a boolean, and as text otherwise.
 */
function scalarEquals(current: unknown, expected: unknown, ignoreCase: boolean): boolean {
  if (current === expected) return true;
  if (current === undefined || current === null || expected === undefined || expected === null)
    return empty(current) && empty(expected);
  if (typeof current === 'number' || typeof expected === 'number') {
    const a = numeric(current);
    const b = numeric(expected);
    return a !== null && b !== null && a === b;
  }
  if (typeof current === 'boolean' || typeof expected === 'boolean')
    return text(current, true).trim() === text(expected, true).trim();
  return text(current, ignoreCase) === text(expected, ignoreCase);
}

/** A list from an array, or from comma-separated text. */
export function visualRuleList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string')
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
  return value === undefined || value === null ? [] : [value];
}

/** An inclusive `[min, max]` range from a pair or from `min, max` text. */
export function visualRuleRange(value: unknown): [number, number] | null {
  const [a, b] = visualRuleList(value).map(numeric);
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return a <= b ? [a, b] : [b, a];
}

function contains(current: unknown, expected: unknown, ignoreCase: boolean): boolean {
  if (Array.isArray(current))
    return current.some((entry) => scalarEquals(entry, expected, ignoreCase));
  const needle = text(expected, ignoreCase);
  return needle !== '' && text(current, ignoreCase).includes(needle);
}

export function visualRuleMatches(
  operator: VisualRuleOperator,
  current: unknown,
  expected?: unknown,
  previous?: unknown,
  options: VisualRuleMatchOptions = {},
): boolean {
  const ignoreCase = options.ignoreCase ?? false;
  const a = numeric(current);
  const b = numeric(expected);
  switch (operator) {
    case 'equals':
      return scalarEquals(current, expected, ignoreCase);
    case 'not-equals':
      return !scalarEquals(current, expected, ignoreCase);
    case 'empty':
      return empty(current);
    case 'not-empty':
      return !empty(current);
    case 'greater-than':
      return a !== null && b !== null && a > b;
    case 'less-than':
      return a !== null && b !== null && a < b;
    case 'greater-or-equal':
      return a !== null && b !== null && a >= b;
    case 'less-or-equal':
      return a !== null && b !== null && a <= b;
    case 'between': {
      const range = visualRuleRange(expected);
      return a !== null && range !== null && a >= range[0] && a <= range[1];
    }
    case 'contains':
      return contains(current, expected, ignoreCase);
    case 'not-contains':
      return !contains(current, expected, ignoreCase);
    case 'starts-with': {
      const needle = text(expected, ignoreCase);
      return needle !== '' && text(current, ignoreCase).startsWith(needle);
    }
    case 'ends-with': {
      const needle = text(expected, ignoreCase);
      return needle !== '' && text(current, ignoreCase).endsWith(needle);
    }
    case 'one-of':
      return visualRuleList(expected).some((entry) => scalarEquals(current, entry, ignoreCase));
    case 'not-one-of':
      return !visualRuleList(expected).some((entry) => scalarEquals(current, entry, ignoreCase));
    case 'changed':
      return previous !== undefined && !scalarEquals(current, previous, false);
    case 'increased': {
      const before = numeric(previous);
      return before !== null && a !== null && a > before;
    }
    case 'decreased': {
      const before = numeric(previous);
      return before !== null && a !== null && a < before;
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Trigger and action classification
 * --------------------------------------------------------------------------------------------- */

export const VISUAL_RULE_POINTER_TRIGGERS: ReadonlySet<VisualRuleTrigger> = new Set([
  'hover',
  'click',
  'double-click',
  'pointer-enter',
  'pointer-leave',
]);

export const VISUAL_RULE_LIFECYCLE_TRIGGERS: ReadonlySet<VisualRuleTrigger> = new Set([
  'play',
  'step',
  'stop',
  'custom-action',
]);

export type VisualRuleStateAction = Extract<
  VisualRuleAction,
  { type: 'visibility' } | { type: 'toggle-visibility' } | { type: 'property' }
>;
export type VisualRuleSideEffectAction = Exclude<VisualRuleAction, VisualRuleStateAction>;

export function isVisualRuleStateAction(action: VisualRuleAction): action is VisualRuleStateAction {
  return (
    action.type === 'visibility' ||
    action.type === 'toggle-visibility' ||
    action.type === 'property'
  );
}

export function isVisualRuleSideEffectAction(
  action: VisualRuleAction,
): action is VisualRuleSideEffectAction {
  return !isVisualRuleStateAction(action);
}

export interface VisualRuleConditionLike {
  sourcePath: string[];
  operator: VisualRuleOperator;
  value?: unknown;
  compareSourcePath?: string[];
  ignoreCase?: boolean;
}

export interface VisualRuleLike<
  C extends VisualRuleConditionLike = VisualRuleConditionLike,
> extends VisualRuleConditionLike {
  id: string;
  enabled: boolean;
  trigger?: VisualRuleTrigger;
  conditions?: C[];
  match?: VisualRuleMatch;
  eventId?: string;
  delayFrames?: number;
  actions: VisualRuleAction[];
}

export function visualRuleTrigger(rule: { trigger?: VisualRuleTrigger }): VisualRuleTrigger {
  return rule.trigger ?? 'data';
}

/** The primary condition belongs to data rules only; other triggers use `conditions` as a guard. */
export function visualRuleConditions<C extends VisualRuleConditionLike>(
  rule: VisualRuleLike<C> & C,
): C[] {
  return visualRuleTrigger(rule) === 'data'
    ? [rule, ...(rule.conditions ?? [])]
    : [...(rule.conditions ?? [])];
}

/** A data rule that watches for a change is an event, like a click, rather than a state. */
export function isVisualRuleEdgeDataRule<C extends VisualRuleConditionLike>(
  rule: VisualRuleLike<C> & C,
): boolean {
  return (
    visualRuleTrigger(rule) === 'data' &&
    visualRuleConditions(rule).some((condition) =>
      VISUAL_RULE_EVENT_OPERATORS.has(condition.operator),
    )
  );
}

/** State rules hold their visibility/property actions only while they match. */
export function isVisualRuleState<C extends VisualRuleConditionLike>(
  rule: VisualRuleLike<C> & C,
): boolean {
  const trigger = visualRuleTrigger(rule);
  return trigger === 'hover' || (trigger === 'data' && !isVisualRuleEdgeDataRule(rule));
}

/* ------------------------------------------------------------------------------------------------
 * Engine
 * --------------------------------------------------------------------------------------------- */

/**
 * Reads condition operands from a data snapshot. The editor keys data by field id and the runtime
 * by field key, so each side supplies its own reader; `hostLayerId` lets a runtime-collection row
 * read its own item.
 */
export interface VisualRuleDataReader<C, D> {
  read(condition: C, hostLayerId: string, data: D): unknown;
  /** `null` when the condition compares with its literal value. */
  readCompare(condition: C, hostLayerId: string, data: D): { value: unknown } | null;
}

export interface VisualRuleHost<R> {
  layerId: string;
  rules: readonly R[];
}

export interface VisualRuleEngine<C extends VisualRuleConditionLike, R, D> {
  hosts: readonly VisualRuleHost<R>[];
  reader: VisualRuleDataReader<C, D>;
  /** Maps an authored action target to the rendered layer ids it drives. */
  resolveTarget?: (targetLayerId: string, hostLayerId: string) => string[];
}

/** Paint and visibility produced by rules for one target layer. */
export interface VisualRuleEffect {
  properties: Record<string, unknown>;
  visibility?: boolean;
  /** Transition length in frames per property; `VISUAL_RULE_VISIBILITY_KEY` for visibility. */
  transitionFrames: Record<string, number>;
}

export const VISUAL_RULE_VISIBILITY_KEY = '@visibility';

export type VisualRuleEffects = ReadonlyMap<string, VisualRuleEffect>;

export interface FiredVisualRule<R> {
  hostLayerId: string;
  rule: R;
}

function conditionMatches<C extends VisualRuleConditionLike, D>(
  reader: VisualRuleDataReader<C, D>,
  condition: C,
  hostLayerId: string,
  current: D,
  previous: D | undefined,
): boolean {
  const compare = reader.readCompare(condition, hostLayerId, current);
  return visualRuleMatches(
    condition.operator,
    reader.read(condition, hostLayerId, current),
    compare ? compare.value : condition.value,
    previous === undefined ? undefined : reader.read(condition, hostLayerId, previous),
    { ignoreCase: condition.ignoreCase ?? false },
  );
}

/** Whether a rule's conditions hold; a rule without conditions (an unguarded event) holds. */
export function visualRuleConditionsHold<C extends VisualRuleConditionLike, D>(
  reader: VisualRuleDataReader<C, D>,
  rule: VisualRuleLike<C> & C,
  hostLayerId: string,
  current: D,
  previous?: D,
): boolean {
  const conditions = visualRuleConditions(rule);
  if (conditions.length === 0) return true;
  const test = (condition: C) =>
    conditionMatches(reader, condition, hostLayerId, current, previous);
  return rule.match === 'any' ? conditions.some(test) : conditions.every(test);
}

export function visualRuleActionTargets<C extends VisualRuleConditionLike, R, D>(
  engine: VisualRuleEngine<C, R, D>,
  action: VisualRuleStateAction,
  hostLayerId: string,
): string[] {
  const target = action.targetLayerId || hostLayerId;
  return engine.resolveTarget ? engine.resolveTarget(target, hostLayerId) : [target];
}

function withAction(
  effect: VisualRuleEffect | undefined,
  action: Exclude<VisualRuleStateAction, { type: 'toggle-visibility' }>,
  visibility?: boolean,
): VisualRuleEffect {
  const next: VisualRuleEffect = {
    properties: { ...effect?.properties },
    ...(effect?.visibility === undefined ? {} : { visibility: effect.visibility }),
    transitionFrames: { ...effect?.transitionFrames },
  };
  const key = action.type === 'property' ? action.targetProperty : VISUAL_RULE_VISIBILITY_KEY;
  if (action.type === 'property') next.properties[action.targetProperty] = action.value;
  else next.visibility = visibility ?? action.visible;
  if ((action.transitionFrames ?? 0) > 0) next.transitionFrames[key] = action.transitionFrames!;
  else delete next.transitionFrames[key];
  return next;
}

/**
 * Current state-rule output for every target layer. Rules apply in layer order, then rule order,
 * so a later rule wins a property that an earlier one also sets.
 */
export function collectVisualRuleStates<
  C extends VisualRuleConditionLike,
  R extends VisualRuleLike<C> & C,
  D,
>(
  engine: VisualRuleEngine<C, R, D>,
  data: D,
  hovered: ReadonlySet<string> = new Set(),
): Map<string, VisualRuleEffect> {
  const effects = new Map<string, VisualRuleEffect>();
  for (const host of engine.hosts) {
    for (const rule of host.rules) {
      if (!rule.enabled || !isVisualRuleState(rule)) continue;
      if (visualRuleTrigger(rule) === 'hover' && !hovered.has(host.layerId)) continue;
      if (!visualRuleConditionsHold(engine.reader, rule, host.layerId, data)) continue;
      for (const action of rule.actions) {
        if (!isVisualRuleStateAction(action) || action.type === 'toggle-visibility') continue;
        for (const target of visualRuleActionTargets(engine, action, host.layerId))
          effects.set(target, withAction(effects.get(target), action));
      }
    }
  }
  return effects;
}

/**
 * Applies event-rule visibility/property actions to the persistent event overrides. A toggle flips
 * the target's visibility as the viewer currently sees it.
 */
export function applyVisualRuleEventActions<C extends VisualRuleConditionLike, R, D>(
  engine: VisualRuleEngine<C, R, D>,
  overrides: ReadonlyMap<string, VisualRuleEffect>,
  actions: readonly VisualRuleAction[],
  hostLayerId: string,
  visibleOf: (layerId: string) => boolean,
): Map<string, VisualRuleEffect> {
  const next = new Map(overrides);
  for (const action of actions) {
    if (!isVisualRuleStateAction(action)) continue;
    for (const target of visualRuleActionTargets(engine, action, hostLayerId)) {
      if (action.type === 'toggle-visibility') {
        const current = next.get(target)?.visibility ?? visibleOf(target);
        next.set(
          target,
          withAction(
            next.get(target),
            {
              type: 'visibility',
              visible: !current,
              ...(action.transitionFrames ? { transitionFrames: action.transitionFrames } : {}),
            },
            !current,
          ),
        );
      } else next.set(target, withAction(next.get(target), action));
    }
  }
  return next;
}

/** Event overrides sit on top of state output. */
export function mergeVisualRuleEffects(
  state: VisualRuleEffect | undefined,
  override: VisualRuleEffect | undefined,
): VisualRuleEffect | undefined {
  if (!state) return override;
  if (!override) return state;
  const visibility = override.visibility ?? state.visibility;
  return {
    properties: { ...state.properties, ...override.properties },
    ...(visibility === undefined ? {} : { visibility }),
    transitionFrames: { ...state.transitionFrames, ...override.transitionFrames },
  };
}

function stateRuleHolds<C extends VisualRuleConditionLike, R extends VisualRuleLike<C> & C, D>(
  engine: VisualRuleEngine<C, R, D>,
  host: VisualRuleHost<R>,
  rule: R,
  data: D,
  hovered: ReadonlySet<string>,
): boolean {
  if (visualRuleTrigger(rule) === 'hover' && !hovered.has(host.layerId)) return false;
  return visualRuleConditionsHold(engine.reader, rule, host.layerId, data);
}

/**
 * Latest wins: when a state rule starts matching, it takes back the properties and visibility an
 * earlier event wrote for the same targets. Without this, one click or score change would mask a
 * data rule for the rest of the playout.
 */
export function releaseVisualRuleOverrides<
  C extends VisualRuleConditionLike,
  R extends VisualRuleLike<C> & C,
  D,
>(
  engine: VisualRuleEngine<C, R, D>,
  overrides: ReadonlyMap<string, VisualRuleEffect>,
  previous: { data: D; hovered?: ReadonlySet<string> },
  current: { data: D; hovered?: ReadonlySet<string> },
): Map<string, VisualRuleEffect> {
  const next = new Map(overrides);
  if (next.size === 0) return next;
  for (const host of engine.hosts) {
    for (const rule of host.rules) {
      if (!rule.enabled || !isVisualRuleState(rule)) continue;
      const before = stateRuleHolds(
        engine,
        host,
        rule,
        previous.data,
        previous.hovered ?? new Set(),
      );
      const after = stateRuleHolds(engine, host, rule, current.data, current.hovered ?? new Set());
      if (before || !after) continue;
      for (const action of rule.actions) {
        if (!isVisualRuleStateAction(action) || action.type === 'toggle-visibility') continue;
        for (const target of visualRuleActionTargets(engine, action, host.layerId)) {
          const effect = next.get(target);
          if (!effect) continue;
          const released: VisualRuleEffect = {
            properties: { ...effect.properties },
            ...(effect.visibility === undefined ? {} : { visibility: effect.visibility }),
            transitionFrames: { ...effect.transitionFrames },
          };
          if (action.type === 'property') delete released.properties[action.targetProperty];
          else delete released.visibility;
          if (Object.keys(released.properties).length === 0 && released.visibility === undefined)
            next.delete(target);
          else next.set(target, released);
        }
      }
    }
  }
  return next;
}

/**
 * Data-driven firing between two snapshots: change-watching rules whose conditions now hold, and
 * state rules that just started matching (their side-effect actions, such as sounds, run once).
 */
export function firedVisualRuleDataRules<
  C extends VisualRuleConditionLike,
  R extends VisualRuleLike<C> & C,
  D,
>(
  engine: VisualRuleEngine<C, R, D>,
  current: D,
  previous: D,
): Array<FiredVisualRule<R> & { entered: boolean }> {
  const fired: Array<FiredVisualRule<R> & { entered: boolean }> = [];
  for (const host of engine.hosts) {
    for (const rule of host.rules) {
      if (!rule.enabled || visualRuleTrigger(rule) !== 'data') continue;
      if (isVisualRuleEdgeDataRule(rule)) {
        if (visualRuleConditionsHold(engine.reader, rule, host.layerId, current, previous))
          fired.push({ hostLayerId: host.layerId, rule, entered: false });
      } else if (
        visualRuleConditionsHold(engine.reader, rule, host.layerId, current) &&
        !visualRuleConditionsHold(engine.reader, rule, host.layerId, previous)
      ) {
        fired.push({ hostLayerId: host.layerId, rule, entered: true });
      }
    }
  }
  return fired;
}

/**
 * Event rules answering one trigger. Pointer triggers belong to the layer under the pointer;
 * lifecycle triggers are global and may name a step or custom action in `eventId`.
 */
export function firedVisualRuleEventRules<
  C extends VisualRuleConditionLike,
  R extends VisualRuleLike<C> & C,
  D,
>(
  engine: VisualRuleEngine<C, R, D>,
  trigger: Exclude<VisualRuleTrigger, 'data' | 'hover'>,
  data: D,
  scope: { hostLayerId?: string; eventId?: string } = {},
): FiredVisualRule<R>[] {
  const fired: FiredVisualRule<R>[] = [];
  for (const host of engine.hosts) {
    if (scope.hostLayerId !== undefined && host.layerId !== scope.hostLayerId) continue;
    for (const rule of host.rules) {
      if (!rule.enabled || visualRuleTrigger(rule) !== trigger) continue;
      if (
        (trigger === 'step' || trigger === 'custom-action') &&
        rule.eventId &&
        rule.eventId !== scope.eventId
      )
        continue;
      if (!visualRuleConditionsHold(engine.reader, rule, host.layerId, data)) continue;
      fired.push({ hostLayerId: host.layerId, rule });
    }
  }
  return fired;
}

/* ------------------------------------------------------------------------------------------------
 * Transitions
 * --------------------------------------------------------------------------------------------- */

type Rgba = [number, number, number, number];

function parseHexColor(value: unknown): Rgba | null {
  if (typeof value !== 'string') return null;
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1]!;
  if (hex.length <= 4) hex = [...hex].map((digit) => digit + digit).join('');
  const channel = (index: number) => parseInt(hex.slice(index, index + 2), 16);
  return [channel(0), channel(2), channel(4), hex.length === 8 ? channel(6) : 255];
}

function formatHexColor([r, g, b, a]: Rgba): string {
  const hex = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${a >= 255 ? '' : hex(a)}`;
}

/** Smooth start and finish for rule transitions. */
export function visualRuleTransitionEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return t * t * (3 - 2 * t);
}

/**
 * Blends two rule values. Numbers, numeric text, hex colours and numeric vectors (shader colours)
 * interpolate; anything else switches to the target immediately.
 */
export function interpolateVisualRuleValue(from: unknown, to: unknown, progress: number): unknown {
  const t = visualRuleTransitionEase(progress);
  if (t >= 1) return to;
  if (typeof from === 'number' && typeof to === 'number') return from + (to - from) * t;
  const fromColor = parseHexColor(from);
  const toColor = parseHexColor(to);
  if (fromColor && toColor)
    return formatHexColor(
      fromColor.map((channel, index) => channel + (toColor[index]! - channel) * t) as Rgba,
    );
  if (
    Array.isArray(from) &&
    Array.isArray(to) &&
    from.length === to.length &&
    from.every((entry) => typeof entry === 'number') &&
    to.every((entry) => typeof entry === 'number')
  )
    return from.map((entry, index) => entry + ((to[index] as number) - entry) * t);
  const a = numeric(from);
  const b = numeric(to);
  if (a !== null && b !== null && typeof to === 'string') return String(a + (b - a) * t);
  return to;
}

/* ------------------------------------------------------------------------------------------------
 * Authoring
 * --------------------------------------------------------------------------------------------- */

export function createVisualRuleCondition(
  overrides: Partial<VisualRuleCondition> = {},
): VisualRuleCondition {
  return {
    fieldId: overrides.fieldId ?? '',
    sourcePath: overrides.sourcePath ?? [],
    operator: overrides.operator ?? 'equals',
    ...(overrides.value !== undefined ? { value: overrides.value } : {}),
    ...(overrides.compareFieldId ? { compareFieldId: overrides.compareFieldId } : {}),
    ...(overrides.compareSourcePath?.length
      ? { compareSourcePath: overrides.compareSourcePath }
      : {}),
    ...(overrides.ignoreCase ? { ignoreCase: true } : {}),
  };
}

export function createLayerVisualRule(overrides: Partial<LayerVisualRule> = {}): LayerVisualRule {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'Visual rule',
    enabled: overrides.enabled ?? true,
    trigger: overrides.trigger ?? 'data',
    fieldId: overrides.fieldId ?? '',
    sourcePath: overrides.sourcePath ?? [],
    operator: overrides.operator ?? 'equals',
    ...(overrides.value !== undefined ? { value: overrides.value } : {}),
    ...(overrides.compareFieldId ? { compareFieldId: overrides.compareFieldId } : {}),
    ...(overrides.compareSourcePath?.length
      ? { compareSourcePath: overrides.compareSourcePath }
      : {}),
    ...(overrides.ignoreCase ? { ignoreCase: true } : {}),
    ...(overrides.conditions?.length ? { conditions: overrides.conditions } : {}),
    ...(overrides.match ? { match: overrides.match } : {}),
    ...(overrides.eventId ? { eventId: overrides.eventId } : {}),
    ...(overrides.delayFrames ? { delayFrames: overrides.delayFrames } : {}),
    actions: overrides.actions ?? [{ type: 'visibility', visible: true }],
  };
}

/**
 * Fills the keys agents may omit (field, path, operator) so a rule arriving through an operation
 * has the complete document shape.
 */
export function normalizeLayerVisualRule(
  rule: Omit<LayerVisualRule, 'fieldId' | 'sourcePath' | 'operator' | 'conditions'> &
    Partial<Pick<LayerVisualRule, 'fieldId' | 'sourcePath' | 'operator'>> & {
      conditions?: Array<Partial<VisualRuleCondition> & { fieldId?: string }>;
    },
): LayerVisualRule {
  const condition = <C extends Partial<VisualRuleCondition>>(source: C) => ({
    ...source,
    fieldId: source.fieldId ?? '',
    sourcePath: source.sourcePath ?? [],
    operator: source.operator ?? 'equals',
  });
  return {
    ...condition(rule),
    ...(rule.conditions ? { conditions: rule.conditions.map(condition) } : {}),
  } as LayerVisualRule;
}

/** Every data field a rule reads, including comparison fields and extra conditions. */
export function visualRuleFieldIds(rule: LayerVisualRule): string[] {
  const ids = visualRuleConditions(rule).flatMap((condition) => [
    condition.fieldId,
    ...(condition.compareFieldId ? [condition.compareFieldId] : []),
  ]);
  return [...new Set(ids.filter(Boolean))];
}

/** Every other layer a rule's actions drive. */
export function visualRuleTargetLayerIds(rule: LayerVisualRule): string[] {
  return [
    ...new Set(
      rule.actions.flatMap((action) =>
        isVisualRuleStateAction(action) && action.targetLayerId ? [action.targetLayerId] : [],
      ),
    ),
  ];
}

/**
 * A copy for a duplicated layer or component instance: fresh id, and layer/field references
 * pointed at their copies. References outside the maps are kept.
 */
export function remapVisualRule(
  rule: LayerVisualRule,
  maps: {
    layerIds?: ReadonlyMap<string, string>;
    fieldIds?: ReadonlyMap<string, string>;
    id?: string;
  } = {},
): LayerVisualRule {
  const field = (id: string) => maps.fieldIds?.get(id) ?? id;
  const condition = <C extends VisualRuleCondition>(source: C): C => ({
    ...source,
    fieldId: source.fieldId ? field(source.fieldId) : source.fieldId,
    ...(source.compareFieldId ? { compareFieldId: field(source.compareFieldId) } : {}),
  });
  const copy = structuredClone(rule);
  return {
    ...condition(copy),
    id: maps.id ?? createId('visual-rule'),
    ...(copy.conditions ? { conditions: copy.conditions.map(condition) } : {}),
    actions: copy.actions.map((action) =>
      isVisualRuleStateAction(action) && action.targetLayerId
        ? {
            ...action,
            targetLayerId: maps.layerIds?.get(action.targetLayerId) ?? action.targetLayerId,
          }
        : action,
    ),
  };
}

/**
 * Removes rule parts that point at deleted layers, fields, custom actions, media cues or steps,
 * then drops rules left without a trigger source or actions. Mutates the composition.
 */
export function pruneVisualRuleReferences(
  composition: Pick<
    Composition,
    'layers' | 'dataFields' | 'customActions' | 'mediaCues' | 'keyframes'
  >,
): void {
  const layerIds = new Set(composition.layers.map((layer) => layer.id));
  const fieldIds = new Set(composition.dataFields.map((field) => field.id));
  const actionIds = new Set(composition.customActions.map((action) => action.actionId));
  const cueIds = new Set((composition.mediaCues ?? []).map((cue) => cue.id));
  const stepIds = new Set(
    composition.keyframes
      .filter((keyframe) => keyframe.role === 'step')
      .map((keyframe) => keyframe.id),
  );
  // Blank references are rules still being authored; only references to deleted things go.
  const missing = (id: string | undefined, known: ReadonlySet<string>) =>
    Boolean(id) && !known.has(id!);
  const keepCondition = (condition: VisualRuleCondition): VisualRuleCondition | null => {
    if (missing(condition.fieldId, fieldIds)) return null;
    if (missing(condition.compareFieldId, fieldIds)) {
      const { compareFieldId: _field, compareSourcePath: _path, ...literal } = condition;
      return literal;
    }
    return condition;
  };
  for (const layer of composition.layers) {
    if (!layer.visualRules?.length) continue;
    layer.visualRules = layer.visualRules.flatMap((rule) => {
      const trigger = visualRuleTrigger(rule);
      let next: LayerVisualRule = rule;
      if (trigger === 'data') {
        const primary = keepCondition(rule);
        if (!primary) return [];
        next = { ...rule, ...primary };
        if (!primary.compareFieldId) {
          delete next.compareFieldId;
          delete next.compareSourcePath;
        }
      }
      if (trigger === 'custom-action' && missing(rule.eventId, actionIds)) return [];
      if (trigger === 'step' && missing(rule.eventId, stepIds)) return [];
      if (rule.conditions) {
        const conditions = rule.conditions.flatMap((condition) => {
          const kept = keepCondition(condition);
          return kept ? [kept] : [];
        });
        next = { ...next, conditions };
        if (conditions.length === 0) delete next.conditions;
      }
      const actions = rule.actions.filter((action) => {
        if (isVisualRuleStateAction(action)) return !missing(action.targetLayerId, layerIds);
        if (action.type === 'custom-action' || action.type === 'shader-animation')
          return !missing(action.actionId, actionIds);
        return !missing(action.cueId, cueIds);
      });
      if (actions.length === 0) return [];
      return [actions.length === rule.actions.length ? next : { ...next, actions }];
    });
  }
}

/** Follows a custom action's public id when it is renamed. Mutates the layers. */
export function renameVisualRuleCustomAction(
  layers: readonly { visualRules?: LayerVisualRule[] }[],
  previousActionId: string,
  nextActionId: string,
): void {
  for (const layer of layers) {
    for (const rule of layer.visualRules ?? []) {
      if (rule.trigger === 'custom-action' && rule.eventId === previousActionId)
        rule.eventId = nextActionId;
      for (const action of rule.actions) {
        if (
          (action.type === 'custom-action' || action.type === 'shader-animation') &&
          action.actionId === previousActionId
        )
          action.actionId = nextActionId;
      }
    }
  }
}
