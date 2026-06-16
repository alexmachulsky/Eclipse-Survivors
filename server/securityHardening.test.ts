import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createLanServer, type LanServerHandle, type LanServerOptions } from './index';

// Regression coverage for the LAN-server security hardening pass (Findings 1,3,4,5,8).

const handles: LanServerHandle[] = [];

async function listen(options: LanServerOptions = {}): Promise<string> {
  const handle = createLanServer({ allowedOrigins: ['http://127.0.0.1'], ...options });
  handles.push(handle);
  await handle.listen(0, '127.0.0.1');
  const address = handle.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }
  return `ws://127.0.0.1:${address.port}/ws`;
}

function open(url: string, headers: Record<string, string> = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: 'http://127.0.0.1', ...headers } });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', (code) => resolve(code)));
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

async function hello(
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<{ socket: WebSocket; welcome: { reconnectToken: string; playerId: string } }> {
  const socket = await open(url, headers);
  const welcomeP = waitForMessage<{ reconnectToken: string; playerId: string }>(socket, 'welcome');
  socket.send(JSON.stringify({ type: 'hello', ...payload }));
  const welcome = await welcomeP;
  return { socket, welcome };
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

describe('legacy LAN_ROOM_CODE access gate (Finding 1)', () => {
  it('rejects a hello that omits the room code', async () => {
    const url = await listen({ roomCode: 'SECRET' });
    const socket = await open(url);
    socket.send(JSON.stringify({ type: 'hello', name: 'intruder' }));
    await expect(waitForClose(socket)).resolves.toBe(1008);
  });

  it('rejects a hello with the wrong room code', async () => {
    const url = await listen({ roomCode: 'SECRET' });
    const socket = await open(url);
    socket.send(JSON.stringify({ type: 'hello', name: 'intruder', roomCode: 'WRONG' }));
    await expect(waitForClose(socket)).resolves.toBe(1008);
  });

  it('admits a hello carrying the correct room code', async () => {
    const url = await listen({ roomCode: 'SECRET' });
    const { socket, welcome } = await hello(url, { name: 'guest', roomCode: 'SECRET' });
    expect(welcome.playerId).toMatch(/^player-/);
    socket.close();
  });
});

describe('reconnect token rotation (Finding 3)', () => {
  it('issues a fresh token on reconnect and invalidates the old one', async () => {
    const url = await listen();
    const first = await hello(url, { name: 'Alpha' });
    const token1 = first.welcome.reconnectToken;
    const pid1 = first.welcome.playerId;

    // Reconnect with the original token: same player, but a NEW token.
    const second = await hello(url, { name: 'Alpha', reconnectToken: token1 });
    expect(second.welcome.playerId).toBe(pid1);
    expect(second.welcome.reconnectToken).not.toBe(token1);
    await waitForClose(first.socket); // the prior socket is replaced (4001)

    // The OLD token no longer reclaims the player — it yields a fresh seat.
    const third = await hello(url, { name: 'Ghost', reconnectToken: token1 });
    expect(third.welcome.playerId).not.toBe(pid1);

    second.socket.close();
    third.socket.close();
  });
});

describe('proxy-header trust gating + global pre-hello cap (Finding 4)', () => {
  it('ignores spoofed X-Real-IP when proxy trust is off', async () => {
    const url = await listen({ maxPendingConnectionsPerIp: 1, trustProxyHeaders: false });
    const s1 = await open(url, { 'X-Real-IP': '1.1.1.1' });
    // Different forged IP, but trust is off so both map to the real socket bucket.
    const s2 = await open(url, { 'X-Real-IP': '2.2.2.2' });
    await expect(waitForClose(s2)).resolves.toBe(1013);
    s1.close();
  });

  it('honors distinct X-Real-IP buckets when proxy trust is on', async () => {
    const url = await listen({ maxPendingConnectionsPerIp: 1, trustProxyHeaders: true });
    const s1 = await open(url, { 'X-Real-IP': '1.1.1.1' });
    const s2 = await open(url, { 'X-Real-IP': '2.2.2.2' });
    // Same bucket as s1 → over the per-IP cap.
    const s3 = await open(url, { 'X-Real-IP': '1.1.1.1' });
    await expect(waitForClose(s3)).resolves.toBe(1013);
    s1.close();
    s2.close();
  });

  it('enforces a global pre-hello cap independent of IP', async () => {
    const url = await listen({ maxPendingConnectionsPerIp: 10, maxPendingConnectionsTotal: 2, trustProxyHeaders: true });
    const s1 = await open(url, { 'X-Real-IP': '1.1.1.1' });
    const s2 = await open(url, { 'X-Real-IP': '2.2.2.2' });
    const s3 = await open(url, { 'X-Real-IP': '3.3.3.3' });
    await expect(waitForClose(s3)).resolves.toBe(1013);
    s1.close();
    s2.close();
  });
});

describe('failed-join throttling (Finding 5)', () => {
  it('throttles repeated wrong-code joins from one address', async () => {
    const url = await listen({ maxFailedJoinsPerWindow: 2 });

    // First two misses get the friendly "room not found" close.
    for (let i = 0; i < 2; i += 1) {
      const socket = await open(url);
      socket.send(JSON.stringify({ type: 'hello', action: 'join', roomCode: 'ZZZZ' }));
      await expect(waitForClose(socket)).resolves.toBe(1008);
    }

    // The third miss within the window is throttled.
    const socket = await open(url);
    socket.send(JSON.stringify({ type: 'hello', action: 'join', roomCode: 'ZZZZ' }));
    await expect(waitForClose(socket)).resolves.toBe(1013);
  });
});

describe('command seq validation (Finding 8)', () => {
  it('rejects a command whose seq is an out-of-range number', async () => {
    const url = await listen();
    const { socket, welcome } = await hello(url, { name: 'Alpha' });

    socket.send(JSON.stringify({
      type: 'command', playerId: welcome.playerId,
      moveUp: false, moveDown: false, moveLeft: false, moveRight: false,
      aimWorldX: 0, aimWorldY: 0, reviveHeld: false, dashHeld: false,
      seq: 1e308
    }));

    await expect(waitForClose(socket)).resolves.toBe(1003);
  });
});
