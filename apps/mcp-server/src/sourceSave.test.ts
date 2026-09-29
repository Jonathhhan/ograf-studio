import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOGrafToolRecords, type EditorBridgePort } from '@ograf-editor/agent-tools';
import { templateThumbnailName } from '@ograf-editor/scene-model';
import { AuthoringWorkspace } from './workspace';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ograf-source-save-'));
  roots.push(root);
  const workspace = new AuthoringWorkspace(root);
  const capture = vi.fn();
  const certify = vi.fn().mockRejectedValue(new Error('Export certification unavailable'));
  const bridge = { capture, certify } as unknown as EditorBridgePort;
  const save = createOGrafToolRecords(workspace, bridge).find(
    (tool) => tool.name === 'ograf_save_project',
  )!;
  return {
    root,
    workspace,
    capture,
    certify,
    save: (overwrite = false) =>
      save.handler({
        sessionId: 'editor',
        path: 'source.ogs',
        confirm: true,
        overwrite,
      }) as Promise<{ structuredContent: Record<string, unknown> }>,
  };
}

describe('editable source save independence', () => {
  it.each(['Editor disconnected', 'Browser render failed'])(
    'saves before optional capture fails: %s',
    async (message) => {
      const { root, workspace, capture, certify, save } = await fixture();
      capture.mockImplementation(async () => {
        expect(JSON.parse(await readFile(join(root, 'source.ogs'), 'utf8'))).toEqual(
          workspace.get().snapshot().project,
        );
        throw new Error(message);
      });
      const result = await save();
      expect(result.structuredContent).toMatchObject({
        path: join(root, 'source.ogs'),
        revision: 0,
      });
      expect(result.structuredContent).not.toHaveProperty('thumbnailPath');
      expect(result.structuredContent.warnings).toEqual([expect.stringContaining(message)]);
      expect(certify).not.toHaveBeenCalled();
    },
  );

  it('writes a thumbnail when capture succeeds without running export certification', async () => {
    const { root, capture, certify, save } = await fixture();
    capture.mockResolvedValue({ data: Buffer.from('thumbnail').toString('base64') });
    const result = await save();
    expect(await readFile(result.structuredContent.thumbnailPath as string, 'utf8')).toBe(
      'thumbnail',
    );
    expect(JSON.parse(await readFile(join(root, 'source.ogs'), 'utf8'))).toHaveProperty(
      'compositions',
    );
    expect(result.structuredContent.warnings).toEqual([]);
    expect(certify).not.toHaveBeenCalled();
  });

  it('preserves a colliding sidecar without rolling back the new source', async () => {
    const { root, workspace, capture, save } = await fixture();
    const sidecar = join(root, templateThumbnailName(workspace.get().snapshot().project));
    await writeFile(sidecar, 'existing thumbnail');
    capture.mockResolvedValue({ data: Buffer.from('new thumbnail').toString('base64') });
    const result = await save();
    expect(result.structuredContent.warnings).toEqual([expect.stringContaining('already exists')]);
    expect(await readFile(sidecar, 'utf8')).toBe('existing thumbnail');
    expect(JSON.parse(await readFile(join(root, 'source.ogs'), 'utf8'))).toHaveProperty(
      'compositions',
    );
    await expect(save()).rejects.toThrow('already exists');
  });
});
