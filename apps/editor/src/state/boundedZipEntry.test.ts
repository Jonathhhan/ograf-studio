import { it, expect } from 'vitest';
import JSZip from 'jszip';
import { boundedZipEntry } from './boundedZipEntry';

it('reads a compressed entry at its exact budget and rejects overflow', async () => {
  const zip = new JSZip();
  zip.file('large.txt', 'x'.repeat(1024 * 1024));
  const loaded = await JSZip.loadAsync(
    await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
  );
  expect((await boundedZipEntry(loaded.file('large.txt')!, 1024 * 1024)).length).toBe(1024 * 1024);
  await expect(boundedZipEntry(loaded.file('large.txt')!, 100)).rejects.toThrow('import limit');
  await expect(boundedZipEntry(loaded.file('large.txt')!, 0)).rejects.toThrow('import limit');
});
