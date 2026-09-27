import { describe, expect, it, vi } from 'vitest';
import { PreviewDataUpdates } from './previewDataUpdates';

describe('preview data before playback', () => {
  it('retries a rejected data value instead of treating an attempt as success', async () => {
    const update = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const updates = new PreviewDataUpdates({ count: 1 }, update);
    expect(await updates.apply({ count: 2 })).toBe(false);
    expect(await updates.apply({ count: 2 }, true)).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
    expect(await updates.apply({ count: 2 }, true)).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('waits for an in-flight update before allowing playback with the same data', async () => {
    let finish!: (accepted: boolean) => void;
    const update = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const updates = new PreviewDataUpdates({}, update);
    const pending = updates.apply({ count: 2 });
    const play = vi.fn();
    const playback = updates.apply({ count: 2 }, true).then((accepted) => {
      if (accepted) play();
    });
    await Promise.resolve();
    expect(play).not.toHaveBeenCalled();
    finish(true);
    await pending;
    await playback;
    expect(play).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });

  it('serializes different data and reapplies a previous value after an intervening update', async () => {
    let finish!: (accepted: boolean) => void;
    const update = vi
      .fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)))
      .mockResolvedValue(true);
    const updates = new PreviewDataUpdates({ count: 1 }, update);
    const first = updates.apply({ count: 2 });
    const second = updates.apply({ count: 1 }, true);
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    finish(true);
    await first;
    expect(await second).toBe(true);
    expect(update.mock.calls.map(([params]) => params.data)).toEqual([{ count: 2 }, { count: 1 }]);
  });

  it('does not poison later updates after an exception', async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue(true);
    const updates = new PreviewDataUpdates({}, update);
    await expect(updates.apply({ count: 2 })).rejects.toThrow('failed');
    expect(await updates.apply({ count: 2 }, true)).toBe(true);
  });

  it('blocks pending actions and queued updates when their graphic is replaced', async () => {
    let finish!: (accepted: boolean) => void;
    const update = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const updates = new PreviewDataUpdates({}, update);
    const first = updates.apply({ count: 2 });
    const queued = updates.apply({ count: 3 }, true);
    await Promise.resolve();
    updates.dispose();
    finish(true);
    expect(await first).toBe(false);
    expect(await queued).toBe(false);
    expect(update).toHaveBeenCalledOnce();
  });
});
