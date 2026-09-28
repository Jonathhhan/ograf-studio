import { describe, it, expect, vi } from 'vitest';
import { createLinkedJsonReader, parseLinkedJson } from './linkedJsonReader';
const file = (text: string) => ({ size: text.length, text: async () => text });
describe('linked JSON reader', () => {
  it('accepts nested object data and BOM, rejecting nonobjects and infinite numbers', () => {
    expect(parseLinkedJson('\uFEFF{"player":{"name":"A"},"scores":[1,2]}')).toEqual({
      player: { name: 'A' },
      scores: [1, 2],
    });
    for (const source of ['[]', 'null', '1', '{"x":1e999}', '{'])
      expect(() => parseLinkedJson(source)).toThrow();
  });
  it('keeps the last accepted value on partial writes and recovers', async () => {
    let source = '{"score":1}';
    const accept = vi.fn(),
      report = vi.fn();
    const reader = createLinkedJsonReader(async () => file(source), accept, report);
    await reader.refresh();
    source = '{';
    await reader.refresh();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(report.mock.lastCall?.[0]).toBeTruthy();
    source = '{"score":2}';
    await reader.refresh();
    expect(accept.mock.lastCall).toEqual([{ score: 2 }]);
    expect(report.mock.lastCall).toEqual([]);
  });
  it('serializes reads and ignores completion after unlink', async () => {
    let complete!: (value: ReturnType<typeof file>) => void;
    const read = vi.fn(
      () =>
        new Promise<ReturnType<typeof file>>((resolve) => {
          complete = resolve;
        }),
    );
    const accept = vi.fn(),
      report = vi.fn();
    const reader = createLinkedJsonReader(read, accept, report);
    const first = reader.refresh();
    expect(reader.refresh()).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
    reader.dispose();
    complete(file('{"score":1}'));
    await first;
    expect(accept).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    await reader.refresh();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('reports missing files and size limits without changing data', async () => {
    const accept = vi.fn(),
      report = vi.fn();
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('File missing'))
      .mockResolvedValueOnce({ ...file('{}'), size: 1024 * 1024 + 1 });
    const reader = createLinkedJsonReader(read, accept, report);
    await reader.refresh();
    expect(report).toHaveBeenLastCalledWith('File missing');
    await reader.refresh();
    expect(report).toHaveBeenLastCalledWith('JSON file exceeds 1 MB.');
    expect(accept).not.toHaveBeenCalled();
  });
});
