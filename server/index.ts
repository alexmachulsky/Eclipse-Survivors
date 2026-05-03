import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { GameSim } from '../src/game/GameSim';
import type { PlayerCommand } from '../src/game/types';

type ClientMessage =
  | { type: 'hello'; name?: string; sessionToken?: string }
  | { type: 'start'; playerId: string }
  | { type: 'restart'; playerId: string }
  | ({ type: 'command' } & PlayerCommand)
  | { type: 'selectUpgrade'; playerId: string; upgradeId: string };

interface ClientConnection {
  socket: WebSocket;
  playerId: string;
  sessionToken: string;
}

const PORT = Number(process.env.PORT ?? 3001);
const TICK_RATE = 60;
const SNAPSHOT_RATE = 20;

const sim = new GameSim();
const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }

  response.writeHead(404);
  response.end();
});
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Map<WebSocket, ClientConnection>();
const sessionPlayers = new Map<string, string>();

let hostPlayerId: string | null = null;
let lastTick = Date.now();
let snapshotAccumulator = 0;

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function currentRoomPhase() {
  const phase = sim.getState().phase;
  if (phase === 'menu') return 'lobby';
  if (phase === 'victory') return 'victory';
  if (phase === 'gameOver') return 'gameOver';
  return 'playing';
}

function publicSnapshotFor(playerId: string) {
  return {
    type: 'snapshot',
    tick: Math.floor(sim.getState().elapsed * TICK_RATE),
    localPlayerId: playerId,
    room: {
      phase: currentRoomPhase(),
      hostPlayerId
    },
    state: sim.getState()
  };
}

function broadcastSnapshots(): void {
  for (const client of clients.values()) {
    send(client.socket, publicSnapshotFor(client.playerId));
  }
}

function claimPlayer(name: string, sessionToken: string) {
  const host = hostPlayerId ? sim.getState().players.find((player) => player.id === hostPlayerId) : undefined;
  const existingPlayerId = sessionPlayers.get(sessionToken);
  const existing = existingPlayerId ? sim.getState().players.find((player) => player.id === existingPlayerId) : undefined;

  if (existing) {
    sim.markConnected(existing.id);
    if (!host || host.status === 'disconnected') {
      hostPlayerId = existing.id;
    }
    return existing;
  }

  const player = sim.addPlayer(name);
  sessionPlayers.set(sessionToken, player.id);

  if (!hostPlayerId || !host || host.status === 'disconnected') {
    hostPlayerId = player.id;
  }

  return player;
}

function handleMessage(client: ClientConnection, raw: WebSocket.RawData): void {
  let message: ClientMessage;

  try {
    message = JSON.parse(raw.toString()) as ClientMessage;
  } catch {
    return;
  }

  if (message.type === 'command') {
    if (message.playerId === client.playerId) {
      sim.applyCommand(message);
    }
    return;
  }

  if (message.type === 'selectUpgrade') {
    if (message.playerId === client.playerId) {
      sim.selectUpgrade(client.playerId, message.upgradeId);
      broadcastSnapshots();
    }
    return;
  }

  if (message.type === 'start' || message.type === 'restart') {
    if (client.playerId === hostPlayerId) {
      sim.startRun();
      broadcastSnapshots();
    }
  }
}

wss.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/ws', `http://${request.headers.host ?? 'localhost'}`);
  const sessionToken = url.searchParams.get('session') || randomUUID();
  const name = url.searchParams.get('name') || `Player ${sim.getState().players.length + 1}`;

  let player;
  try {
    player = claimPlayer(name, sessionToken);
  } catch (error) {
    send(socket, { type: 'error', message: error instanceof Error ? error.message : 'Unable to join room' });
    socket.close(1013, 'room full');
    return;
  }

  const client: ClientConnection = { socket, playerId: player.id, sessionToken };
  clients.set(socket, client);
  send(socket, { type: 'welcome', playerId: player.id, sessionToken });
  send(socket, publicSnapshotFor(player.id));
  broadcastSnapshots();

  socket.on('message', (raw) => handleMessage(client, raw));
  socket.on('close', () => {
    clients.delete(socket);
    sim.markDisconnected(client.playerId);

    if (client.playerId === hostPlayerId) {
      hostPlayerId = sim.getState().players.find((runtime) => runtime.status !== 'disconnected')?.id ?? hostPlayerId;
    }

    broadcastSnapshots();
  });
});

setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, Math.max(0, (now - lastTick) / 1000));
  lastTick = now;
  sim.update(dt);
  snapshotAccumulator += dt;

  if (snapshotAccumulator >= 1 / SNAPSHOT_RATE) {
    snapshotAccumulator = 0;
    broadcastSnapshots();
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`LAN multiplayer server listening on ${PORT}`);
});
