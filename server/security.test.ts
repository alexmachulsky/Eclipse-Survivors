import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createLanServer, type LanServerHandle } from './index';

const handles: LanServerHandle[] = [];

async function listen(): Promise<{ handle: LanServerHandle; url: string }> {
  const handle = createLanServer({ allowedOrigins: ['http://127.0.0.1'] });
  handles.push(handle);
  await handle.listen(0, '127.0.0.1');
  const address = handle.server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }

  return { handle, url: `ws://127.0.0.1:${address.port}/ws` };
}

function openSocket(url: string, origin = 'http://127.0.0.1'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: origin } });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function expectRejectedSocket(url: string, headers: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once('open', () => {
      socket.close();
      reject(new Error('Expected websocket upgrade to be rejected'));
    });
    socket.once('error', () => resolve());
  });
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once('close', (code) => resolve(code));
  });
}

function waitForMessage<T>(socket: WebSocket, type: string): Promise<T> {
  return new Promise((resolve) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { type?: string };
      if (message.type === type) {
        resolve(message as T);
      }
    });
  });
}

async function join(url: string, name: string, reconnectToken?: string): Promise<{ socket: WebSocket; token: string; playerId: string }> {
  const socket = await openSocket(url);
  const welcome = waitForMessage<{ type: 'welcome'; reconnectToken: string; playerId: string }>(socket, 'welcome');
  socket.send(JSON.stringify({ type: 'hello', name, reconnectToken }));
  const message = await welcome;
  return { socket, token: message.reconnectToken, playerId: message.playerId };
}

function waitForSnapshot(socket: WebSocket): Promise<{ type: 'snapshot'; state: { players: Array<{ id: string; status: string }> } }> {
  return waitForMessage(socket, 'snapshot');
}

afterEach(async () => {
  const closing = handles.splice(0).map((handle) => handle.close());
  await Promise.all(closing);
});

describe('LAN server security', () => {
  it('rejects browser websocket upgrades from unexpected origins', async () => {
    const { url } = await listen();

    await expect(expectRejectedSocket(url, { Origin: 'http://evil.test' })).resolves.toBeUndefined();
  });

  it('does not trust a reflected Host as an allowed websocket origin', async () => {
    const handle = createLanServer({ allowedOrigins: [] });
    handles.push(handle);
    await handle.listen(0, '127.0.0.1');
    const address = handle.server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }

    const url = `ws://127.0.0.1:${address.port}/ws`;

    await expect(expectRejectedSocket(url, { Origin: 'http://attacker.test', Host: 'attacker.test' })).resolves.toBeUndefined();
  });

  it('closes malformed JSON values without crashing the room', async () => {
    const { url } = await listen();
    const first = await join(url, 'Alpha');

    first.socket.send('null');
    await expect(waitForClose(first.socket)).resolves.toBe(1003);

    const second = await join(url, 'Beta');
    expect(second.playerId).toMatch(/^player-/);
    second.socket.close();
  });

  it('replaces the previous socket when a reconnect token is reused', async () => {
    const { url } = await listen();
    const first = await join(url, 'Alpha');
    const firstClosed = waitForClose(first.socket);
    const second = await join(url, 'Alpha', first.token);

    await expect(firstClosed).resolves.toBe(4001);
    expect(second.playerId).toBe(first.playerId);
    const snapshot = await waitForSnapshot(second.socket);
    expect(snapshot.state.players.find((player) => player.id === second.playerId)?.status).toBe('active');
    second.socket.close();
  });

  it('rejects room-full joins without crashing the server', async () => {
    const { url } = await listen();
    const players = await Promise.all(['A', 'B', 'C', 'D'].map((name) => join(url, name)));
    const extraSocket = await openSocket(url);

    extraSocket.send(JSON.stringify({ type: 'hello', name: 'E' }));
    await expect(waitForClose(extraSocket)).resolves.toBe(1013);

    const stillWorks = await join(url, 'A', players[0].token);
    expect(stillWorks.playerId).toBe(players[0].playerId);

    for (const item of [...players.slice(1), stillWorks]) {
      item.socket.close();
    }
  });

  it('frees a room slot when a disconnected player does not return before cleanup', async () => {
    const handle = createLanServer({ allowedOrigins: ['http://127.0.0.1'], disconnectGraceMs: 1 });
    handles.push(handle);
    await handle.listen(0, '127.0.0.1');
    const address = handle.server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }

    const url = `ws://127.0.0.1:${address.port}/ws`;
    const players = await Promise.all(['A', 'B', 'C', 'D'].map((name) => join(url, name)));
    players[0].socket.close();
    await waitForClose(players[0].socket);
    handle.cleanupDisconnectedPlayers();

    const replacement = await join(url, 'E');
    expect(replacement.playerId).toMatch(/^player-/);

    for (const item of [...players.slice(1), replacement]) {
      item.socket.close();
    }
  });

  it('rejects command messages with a non-boolean dashHeld', async () => {
    const { url } = await listen();
    const { socket, playerId } = await join(url, 'Alpha');

    socket.send(JSON.stringify({
      type: 'command', playerId,
      moveUp: false, moveDown: false, moveLeft: false, moveRight: false,
      aimWorldX: 0, aimWorldY: 0, reviveHeld: false, dashHeld: 'yes'
    }));

    await expect(waitForClose(socket)).resolves.toBe(1003);
  });

  it('accepts a command with a valid boolean dashHeld', async () => {
    const { url } = await listen();
    const { socket, playerId } = await join(url, 'Alpha');

    socket.send(JSON.stringify({
      type: 'command', playerId,
      moveUp: false, moveDown: false, moveLeft: false, moveRight: false,
      aimWorldX: 0, aimWorldY: 0, reviveHeld: false, dashHeld: true
    }));

    const outcome = await Promise.race([
      waitForClose(socket).then(() => 'closed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('open'), 100))
    ]);
    expect(outcome).toBe('open');
    socket.close();
  });

  it('caps simultaneous pre-hello connections from a single IP', async () => {
    const handle = createLanServer({ allowedOrigins: ['http://127.0.0.1'], maxPendingConnectionsPerIp: 2 });
    handles.push(handle);
    await handle.listen(0, '127.0.0.1');
    const address = handle.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }
    const url = `ws://127.0.0.1:${address.port}/ws`;

    // Two sockets that never send hello occupy the per-IP pending budget.
    const s1 = await openSocket(url);
    const s2 = await openSocket(url);
    // The third exceeds the cap and is closed immediately by the server.
    const s3 = await openSocket(url);

    await expect(waitForClose(s3)).resolves.toBe(1013);
    s1.close();
    s2.close();
  });

  it('terminates joined clients that stop answering heartbeat pings', async () => {
    const handle = createLanServer({ allowedOrigins: ['http://127.0.0.1'], heartbeatMs: 40 });
    handles.push(handle);
    await handle.listen(0, '127.0.0.1');
    const address = handle.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }
    const url = `ws://127.0.0.1:${address.port}/ws`;

    // autoPong: false makes this client ignore server pings, simulating a
    // zombie/slowloris connection. The server must drop it within ~2 cycles.
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(url, { headers: { Origin: 'http://127.0.0.1' }, autoPong: false });
      s.once('open', () => resolve(s));
      s.once('error', reject);
    });
    const welcome = waitForMessage(socket, 'welcome');
    socket.send(JSON.stringify({ type: 'hello', name: 'Zombie' }));
    await welcome;

    await expect(waitForClose(socket)).resolves.toBeGreaterThanOrEqual(1000);
  });

  it('keeps responsive clients connected across heartbeats', async () => {
    const handle = createLanServer({ allowedOrigins: ['http://127.0.0.1'], heartbeatMs: 40 });
    handles.push(handle);
    await handle.listen(0, '127.0.0.1');
    const address = handle.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP server address');
    }
    const url = `ws://127.0.0.1:${address.port}/ws`;

    // Default client auto-responds to pings, so it must survive several cycles.
    const { socket } = await join(url, 'Alive');
    const outcome = await Promise.race([
      waitForClose(socket).then(() => 'closed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('open'), 200))
    ]);
    expect(outcome).toBe('open');
    socket.close();
  });
});
