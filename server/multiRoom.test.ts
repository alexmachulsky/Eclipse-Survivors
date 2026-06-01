import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createLanServer, type LanServerHandle, type LanServerOptions } from './index';

const handles: LanServerHandle[] = [];

async function listen(): Promise<{ handle: LanServerHandle; url: string }> {
  const handle = createLanServer({ allowedOrigins: ['http://127.0.0.1'] });
  handles.push(handle);
  await handle.listen(0, '127.0.0.1');
  const address = handle.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return { handle, url: `ws://127.0.0.1:${address.port}/ws` };
}

async function listenWithOptions(options: LanServerOptions): Promise<{ handle: LanServerHandle; url: string }> {
  const handle = createLanServer({ allowedOrigins: ['http://127.0.0.1'], ...options });
  handles.push(handle);
  await handle.listen(0, '127.0.0.1');
  const address = handle.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return { handle, url: `ws://127.0.0.1:${address.port}/ws` };
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: 'http://127.0.0.1' } });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

interface Welcome {
  type: 'welcome';
  playerId: string;
  reconnectToken: string;
  roomCode: string;
  roomName: string;
}

interface SnapshotMessage {
  type: 'snapshot';
  room: { code: string; name: string; phase: string; hostPlayerId: string | null };
  state: { players: Array<{ id: string; name: string; status: string }> };
}

interface ErrorMessage {
  type: 'error';
  message: string;
}

function nextMessage<T>(socket: WebSocket, type: string): Promise<T> {
  return new Promise((resolve) => {
    const onMessage = (raw: import('ws').RawData) => {
      const message = JSON.parse(raw.toString()) as { type?: string };
      if (message.type === type) {
        socket.off('message', onMessage);
        resolve(message as T);
      }
    };
    socket.on('message', onMessage);
  });
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', (code) => resolve(code)));
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

describe('multi-room LAN server', () => {
  it('creates a private room with a 4+ char code and the requested name', async () => {
    const { url } = await listen();
    const host = await openSocket(url);
    const welcomePromise = nextMessage<Welcome>(host, 'welcome');

    host.send(JSON.stringify({ type: 'hello', name: 'Host', action: 'create', roomName: 'Eclipse Crew' }));
    const welcome = await welcomePromise;

    expect(welcome.roomName).toBe('Eclipse Crew');
    expect(welcome.roomCode).toMatch(/^[A-Z0-9]{4,}$/);
    expect(welcome.roomCode).not.toBe('LOBBY');

    host.close();
    await waitForClose(host);
  });

  it('lets a second player join the host room by code', async () => {
    const { url } = await listen();
    const host = await openSocket(url);
    const hostWelcome = nextMessage<Welcome>(host, 'welcome');
    host.send(JSON.stringify({ type: 'hello', name: 'Host', action: 'create', roomName: 'A' }));
    const { roomCode } = await hostWelcome;

    const guest = await openSocket(url);
    const guestWelcome = nextMessage<Welcome>(guest, 'welcome');
    const guestSnapshot = nextMessage<SnapshotMessage>(guest, 'snapshot');
    guest.send(JSON.stringify({ type: 'hello', name: 'Guest', action: 'join', roomCode }));

    const welcome = await guestWelcome;
    const snapshot = await guestSnapshot;

    expect(welcome.roomCode).toBe(roomCode);
    expect(snapshot.room.code).toBe(roomCode);
    expect(snapshot.room.phase).toBe('lobby');
    expect(snapshot.state.players).toHaveLength(2);
    expect(snapshot.state.players.map((player) => player.name).sort()).toEqual(['Guest', 'Host']);

    host.close();
    guest.close();
    await Promise.all([waitForClose(host), waitForClose(guest)]);
  });

  it('rejects a join with an unknown code and surfaces a friendly error', async () => {
    const { url } = await listen();
    const guest = await openSocket(url);
    const errorPromise = nextMessage<ErrorMessage>(guest, 'error');

    guest.send(JSON.stringify({ type: 'hello', name: 'Lost', action: 'join', roomCode: 'ZZZZ' }));
    const errorMessage = await errorPromise;

    expect(errorMessage.message).toMatch(/room not found/i);
    await expect(waitForClose(guest)).resolves.toBe(1008);
  });

  it('isolates simulations between rooms (start in one does not affect the other)', async () => {
    const { url } = await listen();

    // Host A
    const a = await openSocket(url);
    const aWelcome = nextMessage<Welcome>(a, 'welcome');
    a.send(JSON.stringify({ type: 'hello', name: 'A', action: 'create', roomName: 'A' }));
    const { roomCode: codeA, playerId: hostA } = await aWelcome;

    // Host B (separate room)
    const b = await openSocket(url);
    const bWelcome = nextMessage<Welcome>(b, 'welcome');
    b.send(JSON.stringify({ type: 'hello', name: 'B', action: 'create', roomName: 'B' }));
    const { roomCode: codeB } = await bWelcome;

    expect(codeA).not.toBe(codeB);

    // Host A starts the run.
    const bSnapshotsAfterStart: SnapshotMessage[] = [];
    b.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as SnapshotMessage;
      if (message.type === 'snapshot') bSnapshotsAfterStart.push(message);
    });
    a.send(JSON.stringify({ type: 'start', playerId: hostA }));

    // Wait briefly for the next broadcast cycle.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Room B must remain in lobby phase.
    const lastB = bSnapshotsAfterStart[bSnapshotsAfterStart.length - 1];
    expect(lastB?.room.phase).toBe('lobby');
    expect(lastB?.room.code).toBe(codeB);

    a.close();
    b.close();
    await Promise.all([waitForClose(a), waitForClose(b)]);
  });

  it('honors an explicit join action even when a stale reconnect token from another room is provided', async () => {
    const { url } = await listen();

    // Host creates room R1 and remembers token.
    const hostA = await openSocket(url);
    const hostAWelcome = nextMessage<Welcome>(hostA, 'welcome');
    hostA.send(JSON.stringify({ type: 'hello', name: 'HostA', action: 'create', roomName: 'A' }));
    const { reconnectToken: stale } = await hostAWelcome;

    // Different host creates R2.
    const hostB = await openSocket(url);
    const hostBWelcome = nextMessage<Welcome>(hostB, 'welcome');
    hostB.send(JSON.stringify({ type: 'hello', name: 'HostB', action: 'create', roomName: 'B' }));
    const { roomCode: codeB } = await hostBWelcome;

    // Same browser session (carrying R1's token) explicitly joins R2.
    const guest = await openSocket(url);
    const guestWelcome = nextMessage<Welcome>(guest, 'welcome');
    guest.send(JSON.stringify({
      type: 'hello',
      name: 'Switcher',
      action: 'join',
      roomCode: codeB,
      reconnectToken: stale
    }));
    const welcome = await guestWelcome;

    expect(welcome.roomCode).toBe(codeB);

    hostA.close();
    hostB.close();
    guest.close();
    await Promise.all([waitForClose(hostA), waitForClose(hostB), waitForClose(guest)]);
  });

  it('rejects explicit room creation after the global room cap is reached', async () => {
    const { url } = await listenWithOptions({ maxRooms: 1 });
    const first = await openSocket(url);
    const firstWelcome = nextMessage<Welcome>(first, 'welcome');
    first.send(JSON.stringify({ type: 'hello', name: 'HostA', action: 'create', roomName: 'A' }));
    const { roomCode } = await firstWelcome;

    const second = await openSocket(url);
    const secondError = nextMessage<ErrorMessage>(second, 'error');
    second.send(JSON.stringify({ type: 'hello', name: 'HostB', action: 'create', roomName: 'B' }));

    await expect(secondError).resolves.toMatchObject({ message: expect.stringMatching(/room limit/i) });
    await expect(waitForClose(second)).resolves.toBe(1013);

    const guest = await openSocket(url);
    const guestWelcome = nextMessage<Welcome>(guest, 'welcome');
    guest.send(JSON.stringify({ type: 'hello', name: 'Guest', action: 'join', roomCode }));
    await expect(guestWelcome).resolves.toMatchObject({ roomCode });

    first.close();
    guest.close();
    await Promise.all([waitForClose(first), waitForClose(guest)]);
  });

  it('rejects implicit room-code creation after the global room cap is reached', async () => {
    const { url } = await listenWithOptions({ maxRooms: 1 });
    const first = await openSocket(url);
    const firstWelcome = nextMessage<Welcome>(first, 'welcome');
    first.send(JSON.stringify({ type: 'hello', name: 'HostA', roomCode: 'ABCD' }));
    await expect(firstWelcome).resolves.toMatchObject({ roomCode: 'ABCD' });

    const second = await openSocket(url);
    const secondError = nextMessage<ErrorMessage>(second, 'error');
    second.send(JSON.stringify({ type: 'hello', name: 'HostB', roomCode: 'EFGH' }));

    await expect(secondError).resolves.toMatchObject({ message: expect.stringMatching(/room limit/i) });
    await expect(waitForClose(second)).resolves.toBe(1013);

    first.close();
    await waitForClose(first);
  });

  it('rejects new joined clients after the global client cap is reached', async () => {
    const { url } = await listenWithOptions({ maxClients: 1 });
    const first = await openSocket(url);
    const firstWelcome = nextMessage<Welcome>(first, 'welcome');
    first.send(JSON.stringify({ type: 'hello', name: 'Host', action: 'create', roomName: 'A' }));
    await firstWelcome;

    const second = await openSocket(url);
    const secondError = nextMessage<ErrorMessage>(second, 'error');
    second.send(JSON.stringify({ type: 'hello', name: 'Guest', action: 'create', roomName: 'B' }));

    await expect(secondError).resolves.toMatchObject({ message: expect.stringMatching(/server is full/i) });
    await expect(waitForClose(second)).resolves.toBe(1013);

    first.close();
    await waitForClose(first);
  });

  it('rate limits room creation before allocating more rooms from one address', async () => {
    const { url } = await listenWithOptions({
      maxRooms: 4,
      maxRoomCreationsPerWindow: 1,
      roomCreationWindowMs: 60_000
    });
    const first = await openSocket(url);
    const firstWelcome = nextMessage<Welcome>(first, 'welcome');
    first.send(JSON.stringify({ type: 'hello', name: 'HostA', action: 'create', roomName: 'A' }));
    await firstWelcome;

    const second = await openSocket(url);
    const secondError = nextMessage<ErrorMessage>(second, 'error');
    second.send(JSON.stringify({ type: 'hello', name: 'HostB', action: 'create', roomName: 'B' }));

    await expect(secondError).resolves.toMatchObject({ message: expect.stringMatching(/too many rooms/i) });
    await expect(waitForClose(second)).resolves.toBe(1013);

    first.close();
    await waitForClose(first);
  });

  it('prunes expired room-creation windows so the map does not grow unbounded', async () => {
    const { handle, url } = await listenWithOptions({ roomCreationWindowMs: 50 });

    // Creating a room records a per-IP creation window entry.
    const host = await openSocket(url);
    const welcome = nextMessage<Welcome>(host, 'welcome');
    host.send(JSON.stringify({ type: 'hello', name: 'Host', action: 'create', roomName: 'A' }));
    await welcome;
    expect(handle.getStats().roomCreationWindows).toBeGreaterThanOrEqual(1);

    host.close();
    await waitForClose(host);

    // Once the window elapses, the cleanup pass must drop the stale entry
    // rather than leaving one lingering forever per unique IP.
    await new Promise((resolve) => setTimeout(resolve, 80));
    handle.cleanupDisconnectedPlayers();
    expect(handle.getStats().roomCreationWindows).toBe(0);
  });
});
