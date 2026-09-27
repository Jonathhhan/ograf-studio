import { describe, expect, it } from 'vitest';
import { indentExpression, newlineExpression } from './expressionTextEditing';

describe('expression text editing', () => {
  it('inserts indentation at the caret', () => {
    expect(indentExpression('return x;', 7, 7)).toEqual({ value: 'return   x;', start: 9, end: 9 });
  });
  it('indents selected lines but excludes the line after a selected newline', () => {
    expect(indentExpression('one\ntwo\nthree', 0, 8)).toEqual({
      value: '  one\n  two\nthree',
      start: 2,
      end: 12,
    });
  });
  it('outdents mixed whitespace and preserves a selection', () => {
    expect(indentExpression('  one\n\ttwo', 0, 10, true)).toEqual({
      value: 'one\ntwo',
      start: 0,
      end: 7,
    });
    expect(indentExpression('one', 0, 0, true)).toEqual({ value: 'one', start: 0, end: 0 });
  });
  it('continues indentation and opens space between braces', () => {
    expect(newlineExpression('  return x;', 11, 11)).toEqual({
      value: '  return x;\n  ',
      start: 14,
      end: 14,
    });
    expect(newlineExpression('if (x) {}', 8, 8)).toEqual({
      value: 'if (x) {\n  \n}',
      start: 11,
      end: 11,
    });
  });
  it('handles a caret before a leading newline', () => {
    expect(newlineExpression('\nvalue', 0, 0)).toEqual({ value: '\n\nvalue', start: 1, end: 1 });
    expect(indentExpression('\nvalue', 0, 1)).toEqual({ value: '  \nvalue', start: 2, end: 3 });
  });
  it('replaces selected text with a newline', () => {
    expect(newlineExpression('  old text', 2, 10)).toEqual({ value: '  \n  ', start: 5, end: 5 });
  });
});
