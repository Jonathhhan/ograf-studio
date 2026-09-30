import { access, copyFile, link, lstat, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const writers = new Map<string, Promise<void>>();

async function publishFile(source: string, target: string): Promise<void> {
  try {
    await link(source, target);
  } catch (error) {
    // Removable/FAT volumes may not support hard links. Exclusive copy still refuses clobbering.
    if (
      !['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'ENOSYS', 'EXDEV'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )
    )
      throw error;
    await copyFile(source, target, constants.COPYFILE_EXCL);
  }
}

/** Serialize overlapping transactions; hard links also prevent cross-process clobbering. */
export async function writeTemplateFiles(
  files: Array<{ path: string; data: string | Uint8Array }>,
  overwrite: boolean,
): Promise<void> {
  const keys = files.map(({ path }) => {
    const absolute = resolve(path);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  });
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate save target.');
  const previous = keys.map((key) => writers.get(key));
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  for (const key of keys) writers.set(key, pending);
  await Promise.all(previous);
  try {
    await commitFiles(files, overwrite);
  } finally {
    release();
    for (const key of keys) if (writers.get(key) === pending) writers.delete(key);
  }
}

async function commitFiles(
  files: Array<{ path: string; data: string | Uint8Array }>,
  overwrite: boolean,
): Promise<void> {
  const transaction = randomUUID();
  const staged = files.map((file) => ({
    ...file,
    temporary: `${file.path}.${transaction}.tmp`,
    backup: `${file.path}.${transaction}.bak`,
  }));
  const committed: typeof staged = [];
  const backups: typeof staged = [];
  try {
    for (const file of staged) {
      if ((await exists(file.path)) && !(await lstat(file.path)).isFile())
        throw new Error('Template targets must be regular files.');
      if (!overwrite && (await exists(file.path)))
        throw new Error(
          'Template or thumbnail already exists. Set overwrite=true only after confirming replacement.',
        );
      await mkdir(dirname(file.path), { recursive: true });
      await writeFile(file.temporary, file.data, { flag: 'wx' });
    }
    for (const file of staged) {
      if (await exists(file.path)) {
        if (!overwrite)
          throw new Error('A target file appeared while saving. Retry without overwriting it.');
        await rename(file.path, file.backup);
        backups.push(file);
      }
      // Atomically publish only if the target is absent; rename would overwrite a racing writer.
      await publishFile(file.temporary, file.path);
      committed.push(file);
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const file of [...committed].reverse())
      await unlink(file.path).catch((cause) => failures.push(cause));
    for (const file of [...backups].reverse()) {
      try {
        await publishFile(file.backup, file.path);
        await unlink(file.backup);
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        'Save failed and some backup files could not be restored. Keep the .bak files for recovery.',
      );
    throw error;
  } finally {
    await Promise.all(staged.map((file) => unlink(file.temporary).catch(() => undefined)));
  }
  await Promise.all(backups.map((file) => unlink(file.backup).catch(() => undefined)));
}
