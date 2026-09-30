import type JSZip from 'jszip';

/** Stop accumulating decompressed bytes at the remaining package budget. */
export function boundedZipEntry(entry: JSZip.JSZipObject, maxBytes: number): Promise<Uint8Array> {
  // JSZip exposes this browser API but omits it from JSZipObject's declarations.
  const stream = (
    entry as JSZip.JSZipObject & {
      internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
    }
  ).internalStream('uint8array');
  return new Promise((resolve, reject) => {
    let size = 0;
    let stopped = false;
    const chunks: Uint8Array[] = [];
    stream
      .on('data', (chunk) => {
        if (stopped) return;
        if (chunk.byteLength > maxBytes - size) {
          stopped = true;
          stream.pause();
          chunks.length = 0;
          reject(new Error('OGraf package expands beyond the 128 MB import limit.'));
          return;
        }
        size += chunk.byteLength;
        chunks.push(chunk);
      })
      .on('error', (error) => {
        stopped = true;
        chunks.length = 0;
        reject(error);
      })
      .on('end', () => {
        if (stopped) return;
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        chunks.length = 0;
        resolve(result);
      })
      .resume();
  });
}
