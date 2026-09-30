import { describe, it, expect } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { EditorSync } from './editorSync';

describe('revision-safe editor synchronization', () => {
  it('discards stale conflict data when a restarted server accepts the hello baseline', () => {
    const sync = new EditorSync(createProject());
    sync.acknowledge(0);
    sync.changed({ ...sync.local, name: 'Local' });
    sync.receive({ project: { ...sync.local, name: 'Old server' }, revision: 1, source: 'agent' });
    sync.beginConnection();
    sync.acknowledge(0);
    expect(sync.conflict).toBeNull();
    expect(sync.resolve('remote')).toBeNull();
    expect(sync.local.name).toBe('Local');
  });
  it('retains unsent edits when a server update arrives during debounce', () => {
    const base = createProject();
    const sync = new EditorSync(base);
    sync.acknowledge(0);
    const local = { ...base, name: 'Local' };
    sync.changed(local);
    expect(
      sync.receive({ project: { ...base, name: 'Remote' }, revision: 1, source: 'agent' }),
    ).toBe(false);
    expect(sync.local).toBe(local);
    expect(sync.nextUpdate('blocked')).toBeNull();
    sync.resolve('local');
    expect(sync.nextUpdate('resolved')).toMatchObject({ expectedRevision: 1, project: local });
  });
  it('sends one update at a time and keeps edits made while waiting for acknowledgement', () => {
    const sync = new EditorSync(createProject());
    sync.acknowledge(4);
    sync.changed({ ...sync.local, name: 'First' });
    expect(sync.nextUpdate('first')?.expectedRevision).toBe(4);
    sync.changed({ ...sync.local, name: 'Second' });
    expect(sync.nextUpdate('second')).toBeNull();
    sync.acknowledge(5, 'first');
    expect(sync.nextUpdate('second')).toMatchObject({
      expectedRevision: 5,
      project: { name: 'Second' },
    });
    sync.acknowledge(6, 'second');
    expect(sync.dirty).toBe(false);
  });
  it('does not silently replace an autosaved project during handshake', () => {
    const sync = new EditorSync(createProject());
    const local = sync.local;
    sync.beginConnection();
    expect(sync.receive({ project: createProject(), revision: 3, source: 'system' })).toBe(false);
    sync.acknowledge(3);
    expect(sync.local).toBe(local);
    expect(sync.conflict).not.toBeNull();
    const selected = sync.resolve('remote');
    expect(sync.local).toBe(selected?.project);
  });
  it('keeps edits made after hello but before its acknowledgement', () => {
    const sync = new EditorSync(createProject());
    sync.beginConnection();
    sync.changed({ ...sync.local, name: 'Typed during connection' });
    sync.acknowledge(0);
    expect(sync.nextUpdate('edit')?.project.name).toBe('Typed during connection');
  });
  it('allows correcting a rejected project and preserves dirty work across reconnection', () => {
    const sync = new EditorSync(createProject());
    sync.acknowledge(0);
    sync.changed({ ...sync.local, name: 'Invalid' });
    sync.nextUpdate('invalid');
    sync.rejected();
    sync.changed({ ...sync.local, name: 'Corrected' });
    expect(sync.nextUpdate('corrected')).not.toBeNull();
    sync.beginConnection();
    expect(sync.receive({ project: createProject(), revision: 2, source: 'system' })).toBe(false);
    expect(sync.local.name).toBe('Corrected');
  });
  it('accepts remote updates when clean and ignores stale messages', () => {
    const sync = new EditorSync(createProject());
    sync.acknowledge(2);
    const remote = { project: { ...sync.local, name: 'Remote' }, revision: 3, source: 'agent' };
    expect(sync.receive(remote)).toBe(true);
    expect(sync.receive({ ...remote, revision: 1 })).toBe(false);
    sync.acknowledge(1, 'old');
    expect(sync.revision).toBe(3);
  });
});
