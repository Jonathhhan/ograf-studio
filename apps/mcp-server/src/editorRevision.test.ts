import { expect, it } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createOGrafAuthoringHost } from './index';
import { createProject } from '@ograf-editor/scene-model';

it('rejects stale and unversioned editor snapshots without overwriting accepted agent work', async () => {
  const host = createOGrafAuthoringHost();
  await new Promise<void>((done) => host.httpServer.listen(0, '127.0.0.1', done));
  const port = (host.httpServer.address() as { port: number }).port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/editor`, {
    origin: `http://127.0.0.1:${port}`,
  });
  const response = (type: string) =>
    new Promise<any>((done) => {
      const handler = (raw: Buffer) => {
        const value = JSON.parse(raw.toString());
        if (value.type === type) {
          socket.off('message', handler);
          done(value);
        }
      };
      socket.on('message', handler);
    });
  try {
    await once(socket, 'open');
    const base = createProject();
    let reply = response('editor.ack');
    socket.send(JSON.stringify({ type: 'editor.hello', project: base }));
    await reply;
    const session = host.workspace.get();
    session.apply({
      expectedRevision: 0,
      operations: [{ type: 'set_project_metadata', name: 'Agent change' }],
    });
    for (const expectedRevision of [undefined, 0]) {
      reply = response('editor.conflict');
      socket.send(
        JSON.stringify({
          type: 'editor.project',
          project: base,
          expectedRevision,
          updateId: 'stale',
        }),
      );
      expect(await reply).toMatchObject({ revision: 1, project: { name: 'Agent change' } });
      expect(session.snapshot().project.name).toBe('Agent change');
    }
    reply = response('editor.ack');
    socket.send(
      JSON.stringify({
        type: 'editor.project',
        project: { ...base, name: 'Resolved' },
        expectedRevision: 1,
        updateId: 'resolved',
      }),
    );
    expect(await reply).toMatchObject({ revision: 2, updateId: 'resolved' });
    expect(session.snapshot().project.name).toBe('Resolved');
  } finally {
    socket.terminate();
    await new Promise<void>((done) => host.httpServer.close(() => done()));
  }
});
