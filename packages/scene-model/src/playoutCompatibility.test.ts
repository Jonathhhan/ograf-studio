import { describe, expect, it } from 'vitest';
import { getPlayoutCompatibilityWarnings } from './playoutCompatibility';

describe('playout compatibility warnings', () => {
  it('warns about both DaVinci Resolve blockers without turning them into validation errors', () => {
    expect(
      getPlayoutCompatibilityWarnings(
        { supportsNonRealTime: false },
        { backgroundColor: '#000000' },
      ),
    ).toEqual([
      expect.objectContaining({ id: 'davinci-resolve-non-realtime' }),
      expect.objectContaining({ id: 'opaque-composition-background' }),
    ]);
  });

  it('accepts a non-real-time-capable package with transparent output', () => {
    expect(
      getPlayoutCompatibilityWarnings(
        { supportsNonRealTime: true },
        { backgroundColor: 'transparent' },
      ),
    ).toEqual([]);
  });

  it('reports each concern independently', () => {
    expect(
      getPlayoutCompatibilityWarnings(
        { supportsNonRealTime: false },
        { backgroundColor: 'transparent' },
      ).map((warning) => warning.id),
    ).toEqual(['davinci-resolve-non-realtime']);
    expect(
      getPlayoutCompatibilityWarnings(
        { supportsNonRealTime: true },
        { backgroundColor: '#112233' },
      ).map((warning) => warning.id),
    ).toEqual(['opaque-composition-background']);
  });
});
