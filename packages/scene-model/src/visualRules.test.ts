import { describe, expect, it } from 'vitest';
import { visualRuleMatches, visualRuleValue } from './visualRules';

describe('visual rules', () => {
  it('evaluates equality, emptiness, and numeric comparisons', () => {
    expect(visualRuleMatches('equals', 'GOLD', 'GOLD')).toBe(true);
    expect(visualRuleMatches('not-equals', 'SILVER', 'GOLD')).toBe(true);
    expect(visualRuleMatches('empty', '')).toBe(true);
    expect(visualRuleMatches('not-empty', ['row'])).toBe(true);
    expect(visualRuleMatches('greater-than', 4, 3)).toBe(true);
    expect(visualRuleMatches('less-than', 2, 3)).toBe(true);
  });

  it('detects changed, increased, and decreased updates only with a previous value', () => {
    expect(visualRuleMatches('changed', 2, undefined, 1)).toBe(true);
    expect(visualRuleMatches('increased', 2, undefined, 1)).toBe(true);
    expect(visualRuleMatches('decreased', 1, undefined, 2)).toBe(true);
    expect(visualRuleMatches('changed', 2, undefined, undefined)).toBe(false);
  });

  it('reads nested object values safely', () => {
    expect(visualRuleValue({ result: { medal: 'GOLD' } }, ['result', 'medal'])).toBe('GOLD');
    expect(visualRuleValue({}, ['missing', 'value'])).toBeUndefined();
  });
});
