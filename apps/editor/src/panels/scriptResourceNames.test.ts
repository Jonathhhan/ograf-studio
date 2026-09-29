import { describe, expect, it } from 'vitest';
import { scriptModules } from '@ograf-editor/scene-model';
import { nextScriptResourceName } from './scriptResourceNames';

describe('new script resource names', () => {
  it.each([
    ['data', 'json', ['data1.js', 'data2.mjs', 'data3.json'], 'data4.json'],
    ['helpers', 'js', ['helpers1.json', 'helpers2.mjs', 'helpers3.js'], 'helpers4.js'],
  ] as const)(
    'avoids cross-extension collisions for %s',
    (prefix, extension, existing, expected) => {
      const modules = existing.map((fileName) => ({
        fileName,
        source: fileName.endsWith('.json') ? '{}' : '',
      }));
      const fileName = nextScriptResourceName(modules, prefix, extension);
      expect(fileName).toBe(expected);
      expect(() =>
        scriptModules({
          source: '',
          enabled: false,
          modules: [...modules, { fileName, source: extension === 'json' ? '{}' : '' }],
        }),
      ).not.toThrow();
    },
  );

  it('handles an incomplete filename without interrupting creation', () => {
    expect(nextScriptResourceName([{ fileName: 'data1', source: '' }], 'data', 'json')).toBe(
      'data2.json',
    );
  });
});
