import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { AuthoringWorkspace } from './workspace';
import { EditorBridge } from './editorBridge';

const sockets: WebSocket[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function fixture() {
  const server = createServer();
  servers.push(server);
  const bridge = new EditorBridge(server, new AuthoringWorkspace());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { bridge, port };
}

function connect(port: number, origin?: string, host?: string): Promise<boolean> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/editor`, {
    ...(origin ? { origin } : {}),
    ...(host ? { headers: { Host: host } } : {}),
  });
  sockets.push(socket);
  return new Promise((resolve) => {
    socket.once('open', () => resolve(true));
    socket.once('error', () => resolve(false));
  });
}

describe('editor bridge upgrade trust', () => {
  it.each([
    undefined,
    'null',
    'https://attacker.example',
    'http://127.0.0.1:9999',
    'http://localhost.attacker.example:5173',
  ])('rejects foreign or missing Origin %s', async (origin) => {
    const { port, bridge } = await fixture();
    expect(await connect(port, origin)).toBe(false);
    expect(bridge.connected).toBe(false);
  });

  it('rejects a rebound Host even when Origin is allowed', async () => {
    const { port } = await fixture();
    expect(await connect(port, `http://127.0.0.1:${port}`, `attacker.example:${port}`)).toBe(false);
  });

  it('accepts standalone and explicit development loopback origins', async () => {
    const { port } = await fixture();
    expect(await connect(port, `http://127.0.0.1:${port}`)).toBe(true);
    expect(await connect(port, 'http://localhost:5173')).toBe(true);
    expect(await connect(port, 'http://[::1]:5173')).toBe(true);
  });

  it('does not replace an active editor when a foreign site attempts to connect', async () => {
    const { port, bridge } = await fixture();
    expect(await connect(port, `http://127.0.0.1:${port}`)).toBe(true);
    const trusted = sockets[sockets.length - 1]!;
    expect(await connect(port, 'https://attacker.example')).toBe(false);
    expect(bridge.connected).toBe(true);
    expect(trusted.readyState).toBe(WebSocket.OPEN);
  });
});
