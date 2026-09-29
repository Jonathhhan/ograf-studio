import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject } from '@ograf-editor/scene-model';
import { AuthoringWorkspace } from './workspace';

const fixtures: string[] = [];
afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'ograf-path-test-'));
  fixtures.push(base);
  const root = join(base, 'workspace');
  const outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  return { root, outside, workspace: new AuthoringWorkspace(root) };
}

it('opens a saved project into the existing editor as an undoable replacement', async () => {
  const { root, workspace } = fixture();
  const before = workspace.get('editor').snapshot().project;
  writeFileSync(join(root, 'graphic.ogs'), JSON.stringify(createProject({ name: 'Masks' })));
  const opened = await workspace.open('editor', 'graphic.ogs');
  expect(opened.snapshot().project.name).toBe('Masks');
  expect(opened.undo(opened.revision).project).toEqual(before);
  await expect(workspace.open('other', '../outside.ogs')).rejects.toThrow('configured workspace');
});

describe('workspace physical path confinement', () => {
  it('rejects existing reads and new writes through an escaping directory link', () => {
    const { root, outside, workspace } = fixture();
    writeFileSync(join(outside, 'existing.ogs'), '{}');
    symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => workspace.resolveAllowedPath('linked/existing.ogs')).toThrow(/workspace root/);
    expect(() => workspace.resolveAllowedPath('linked/new/nested/project.ogs')).toThrow(
      /workspace root/,
    );
  });

  it('allows in-root links and normal new files, including dot-prefixed names', () => {
    const { root, workspace } = fixture();
    const target = join(root, 'actual');
    mkdirSync(target);
    symlinkSync(target, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(workspace.resolveAllowedPath('linked/new/project.ogs')).toBe(
      join(realpathSync(target), 'new', 'project.ogs'),
    );
    expect(workspace.resolveAllowedPath('..project.ogs')).toBe(
      join(realpathSync(root), '..project.ogs'),
    );
    expect(() => workspace.resolveAllowedPath('../outside/project.ogs')).toThrow(/workspace root/);
    expect(() => workspace.resolveAllowedPath('.')).toThrow(/root itself/);
  });

  it('rejects dangling links instead of treating them as new files', () => {
    const { root, outside, workspace } = fixture();
    symlinkSync(
      join(outside, 'missing'),
      join(root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() => workspace.resolveAllowedPath('linked')).toThrow();
    expect(() => workspace.resolveAllowedPath('linked/new.ogs')).toThrow();
  });
});
