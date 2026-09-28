import type { LayerVisualRule, VisualRuleOperator } from './types';

export function visualRuleValue(root: unknown, path: string[] = []): unknown {
  let value = root;
  for (const segment of path) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function empty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function visualRuleMatches(
  operator: VisualRuleOperator,
  current: unknown,
  expected?: unknown,
  previous?: unknown,
): boolean {
  switch (operator) {
    case 'equals':
      return current === expected;
    case 'not-equals':
      return current !== expected;
    case 'empty':
      return empty(current);
    case 'not-empty':
      return !empty(current);
    case 'greater-than':
      return Number(current) > Number(expected);
    case 'less-than':
      return Number(current) < Number(expected);
    case 'changed':
      return previous !== undefined && current !== previous;
    case 'increased':
      return previous !== undefined && Number(current) > Number(previous);
    case 'decreased':
      return previous !== undefined && Number(current) < Number(previous);
  }
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
    actions: overrides.actions ?? [{ type: 'visibility', visible: true }],
  };
}
