import type { UpdateActionParams } from '@ograf-editor/ograf-types';

/** Serial updates for one loaded graphic; only accepted data may be skipped. */
export class PreviewDataUpdates {
  private applied: string;
  private tail: Promise<unknown> = Promise.resolve();
  private active = true;
  private update: (params: UpdateActionParams) => Promise<boolean>;

  constructor(
    initialData: UpdateActionParams['data'],
    update: (params: UpdateActionParams) => Promise<boolean>,
  ) {
    this.applied = JSON.stringify(initialData);
    this.update = update;
  }

  apply(data: UpdateActionParams['data'], skipAnimation = false): Promise<boolean> {
    const signature = JSON.stringify(data);
    const result = this.tail.then(async () => {
      if (!this.active) return false;
      if (this.applied === signature) return true;
      const accepted = await this.update({ data, skipAnimation });
      if (!this.active) return false;
      if (accepted) this.applied = signature;
      return accepted;
    });
    // A rejected update must not poison the queue or prevent a later retry.
    this.tail = result.catch(() => undefined);
    return result;
  }

  dispose(): void {
    this.active = false;
  }
}
