import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, readdir, unlink, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const failure = vi.hoisted(() => ({ target: '', restore: false, unsupported: false, race: false }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    link: async (from: string, to: string) => {
      if (failure.unsupported)
        throw Object.assign(new Error('Unsupported links'), { code: 'ENOTSUP' });
      if (failure.race && to === failure.target) {
        failure.race = false;
        await actual.writeFile(to, 'other process', { flag: 'wx' });
        return actual.link(from, to);
      }
      if (to === failure.target && (from.endsWith('.tmp') || failure.restore))
        throw Object.assign(new Error('Injected I/O failure'), { code: 'EIO' });
      return actual.link(from, to);
    },
  };
});
import { writeTemplateFiles } from './projectFiles';

it.each([false, true])(
  'refuses a racing external file (copy fallback: %s)',
  async (unsupported) => {
    const root = await mkdtemp(join(tmpdir(), 'ograf-save-race-'));
    const path = join(root, 'new.ogs');
    try {
      if (unsupported) {
        failure.unsupported = true;
        await writeTemplateFiles([{ path, data: 'fallback source' }], false);
        expect(await readFile(path, 'utf8')).toBe('fallback source');
        await expect(writeTemplateFiles([{ path, data: 'replacement' }], false)).rejects.toThrow(
          'already exists',
        );
      } else {
        failure.target = path;
        failure.race = true;
        await expect(
          writeTemplateFiles([{ path, data: 'replacement' }], false),
        ).rejects.toMatchObject({ code: 'EEXIST' });
        expect(await readFile(path, 'utf8')).toBe('other process');
      }
    } finally {
      failure.target = '';
      failure.race = false;
      failure.unsupported = false;
      for (const file of await readdir(root)) await unlink(join(root, file));
      await rmdir(root);
    }
  },
);

it.each([false, true])(
  'preserves the old export when publication fails (restore blocked: %s)',
  async (restore) => {
    const root = await mkdtemp(join(tmpdir(), 'ograf-save-fault-'));
    const path = join(root, 'old.ograf.zip');
    try {
      await writeFile(path, 'old export');
      failure.target = path;
      failure.restore = restore;
      await expect(writeTemplateFiles([{ path, data: 'new export' }], true)).rejects.toThrow(
        restore ? 'backup files could not be restored' : 'Injected I/O failure',
      );
      const files = await readdir(root);
      const preserved = restore
        ? join(
            root,
            files.find((name) => name.endsWith('.bak'))!,
          )
        : path;
      expect(await readFile(preserved, 'utf8')).toBe('old export');
      expect(files.some((name) => name.endsWith('.tmp'))).toBe(false);
    } finally {
      failure.target = '';
      failure.restore = false;
      for (const file of await readdir(root)) await unlink(join(root, file));
      await rmdir(root);
    }
  },
);
