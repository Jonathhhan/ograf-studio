import type { Project } from '@ograf-editor/scene-model';
import { documentEqual } from './documentEqual';

export interface RemoteProject {
  project: Project;
  revision: number;
  source: string;
  reason?: string;
  summary?: { operationCount?: number; operationTypes?: string[] };
}

/** One acknowledged snapshot in flight. Conflicts never replace the local document implicitly. */
export class EditorSync {
  revision: number | null = null;
  conflict: RemoteProject | null = null;
  dirty = false;
  private inFlight: { project: Project; updateId: string } | null = null;
  private hello: Project;
  local: Project;
  constructor(local: Project) {
    this.local = local;
    this.hello = local;
  }

  beginConnection() {
    this.revision = null;
    this.inFlight = null;
    this.conflict = null;
    this.hello = this.local;
  }

  changed(project: Project) {
    this.local = project;
    this.dirty = true;
  }
  rejected() {
    this.inFlight = null;
    this.dirty = true;
  }

  nextUpdate(updateId: string) {
    if (this.revision === null || this.conflict || this.inFlight || !this.dirty) return null;
    this.inFlight = { project: this.local, updateId };
    return {
      type: 'editor.project' as const,
      project: this.local,
      expectedRevision: this.revision,
      updateId,
      reason: 'UI edit',
    };
  }

  acknowledge(revision: number, updateId?: string) {
    if (updateId) {
      if (this.inFlight?.updateId !== updateId) return;
      this.dirty = this.local !== this.inFlight.project;
      this.inFlight = null;
    } else if (this.revision === null) {
      this.dirty = this.local !== this.hello;
    }
    if (this.revision === null || revision >= this.revision) this.revision = revision;
  }

  receive(remote: RemoteProject): boolean {
    if (this.revision !== null && remote.revision < this.revision) return false;
    const identical = documentEqual(this.local, remote.project);
    const conflicting =
      !identical &&
      (this.dirty || this.inFlight !== null || this.revision === null || this.conflict !== null);
    this.revision = remote.revision;
    this.inFlight = null;
    if (conflicting) {
      this.conflict = remote;
      return false;
    }
    this.local = remote.project;
    this.dirty = false;
    this.conflict = null;
    return true;
  }

  resolve(choice: 'local' | 'remote'): RemoteProject | null {
    const remote = this.conflict;
    if (!remote) return null;
    this.conflict = null;
    this.dirty = choice === 'local';
    if (choice === 'remote') this.local = remote.project;
    return choice === 'remote' ? remote : null;
  }
}
