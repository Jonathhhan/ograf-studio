import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Studio build metadata', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the injected public repository version and ISO build date', async () => {
    const rootPackage = JSON.parse(
      readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    vi.stubGlobal('__OGRAF_STUDIO_VERSION__', rootPackage.version);
    vi.stubGlobal('__OGRAF_STUDIO_BUILD_DATE__', '2026-09-26');
    const { STUDIO_BUILD_DATE, STUDIO_VERSION } = await import('./buildInfo');

    expect(STUDIO_VERSION).toBe(rootPackage.version);
    expect(STUDIO_BUILD_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
