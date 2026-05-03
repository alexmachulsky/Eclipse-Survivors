import { useCallback, useMemo, useRef, useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { Hud } from './components/Hud';
import { LanGameCanvas } from './components/LanGameCanvas';
import { EndScreen, LanLobby, MainMenu, PauseMenu } from './components/OverlayScreens';
import { UpgradeScreen } from './components/UpgradeScreen';
import { GameEngine, type GameSnapshot } from './game/GameEngine';
import { clamp } from './game/collisions';
import { getActLabel } from './game/runDirector';
import type { MultiplayerGameState, PlayerCommand, PlayerRuntime } from './game/types';
import { getUnlockedWeapons } from './game/weapons';

const initialSnapshot: GameSnapshot = new GameEngine().getSnapshot();

type Mode = 'solo' | 'lan';

interface ServerSnapshot {
  type: 'snapshot';
  tick: number;
  localPlayerId: string;
  room: {
    phase: 'lobby' | 'playing' | 'gameOver' | 'victory';
    hostPlayerId: string | null;
  };
  state: MultiplayerGameState;
}

function createLocalSnapshot(serverSnapshot: ServerSnapshot | null): GameSnapshot {
  if (!serverSnapshot) {
    return initialSnapshot;
  }

  const state = serverSnapshot.state;
  const runtime = state.players.find((player) => player.id === serverSnapshot.localPlayerId) ?? state.players[0];
  const boss = state.enemies.find((enemy) => enemy.type === 'boss');
  const phase = (() => {
    if (serverSnapshot.room.phase === 'gameOver') return 'gameOver';
    if (serverSnapshot.room.phase === 'victory') return 'victory';
    if (runtime?.status === 'choosing' && runtime.pendingChestChoices.length > 0) return 'chestReward';
    if (runtime?.status === 'choosing') return 'levelUp';
    return serverSnapshot.room.phase === 'lobby' ? 'menu' : 'playing';
  })();

  return {
    phase,
    health: runtime?.player.health ?? 0,
    maxHealth: runtime?.player.maxHealth ?? 1,
    xp: runtime?.xp ?? 0,
    xpToNext: runtime?.xpToNext ?? 1,
    level: runtime?.level ?? 1,
    elapsed: state.elapsed,
    kills: runtime?.stats.kills ?? 0,
    upgradesCollected: runtime?.stats.upgradesCollected ?? 0,
    weapons: runtime ? getUnlockedWeapons(runtime.weapons) : [],
    upgradeChoices: runtime?.upgradeChoices ?? [],
    stats: runtime ? { ...runtime.stats, level: runtime.level, timeSurvived: state.elapsed } : initialSnapshot.stats,
    bossSpawned: state.bossSpawned,
    bossHealthRatio: boss ? clamp(boss.health / boss.maxHealth, 0, 1) : null,
    actLabel: getActLabel(state.elapsed),
    activeObjective: state.objectives.find((objective) => objective.state === 'active') ?? null,
    enemyCurseStacks: state.enemyCurseStacks,
    pendingChestChoices: runtime?.pendingChestChoices ?? []
  };
}

export default function App() {
  const engineRef = useRef<GameEngine | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(initialSnapshot);
  const [mode, setMode] = useState<Mode>('solo');
  const [lanSnapshot, setLanSnapshot] = useState<ServerSnapshot | null>(null);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');

  const localLanSnapshot = useMemo(() => createLocalSnapshot(lanSnapshot), [lanSnapshot]);

  const handleReady = useCallback((engine: GameEngine) => {
    engineRef.current = engine;
    setSnapshot(engine.getSnapshot());
  }, []);

  const refreshSnapshot = useCallback(() => {
    const engine = engineRef.current;

    if (engine) {
      setSnapshot(engine.getSnapshot());
    }
  }, []);

  const startRun = () => {
    engineRef.current?.startRun();
    refreshSnapshot();
  };

  const resumeRun = () => {
    engineRef.current?.resume();
    refreshSnapshot();
  };

  const pauseRun = () => {
    engineRef.current?.pause();
    refreshSnapshot();
  };

  const chooseUpgrade = (upgradeId: string) => {
    if (mode === 'lan') {
      const localPlayerId = lanSnapshot?.localPlayerId;
      if (localPlayerId) {
        socketRef.current?.send(JSON.stringify({ type: 'selectUpgrade', playerId: localPlayerId, upgradeId }));
      }
    } else {
      engineRef.current?.selectUpgrade(upgradeId);
      refreshSnapshot();
    }
  };

  const connectLan = () => {
    const existing = socketRef.current;
    if (existing && existing.readyState === WebSocket.OPEN) {
      return;
    }

    const sessionToken = window.sessionStorage.getItem('survival-lan-session') ?? crypto.randomUUID();
    const name = window.sessionStorage.getItem('survival-lan-name') ?? `Player ${sessionToken.slice(0, 4)}`;
    window.sessionStorage.setItem('survival-lan-session', sessionToken);
    window.sessionStorage.setItem('survival-lan-name', name);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws?session=${encodeURIComponent(sessionToken)}&name=${encodeURIComponent(name)}`);

    socketRef.current = socket;
    setMode('lan');
    setConnectionStatus('Connecting...');

    socket.addEventListener('open', () => {
      setConnectionStatus(`Connected at ${window.location.origin}`);
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data) as ServerSnapshot | { type: 'welcome'; sessionToken: string } | { type: 'error'; message: string };

      if (message.type === 'welcome') {
        window.sessionStorage.setItem('survival-lan-session', message.sessionToken);
      } else if (message.type === 'snapshot') {
        setLanSnapshot(message);
      } else if (message.type === 'error') {
        setConnectionStatus(message.message);
      }
    });

    socket.addEventListener('close', () => {
      setConnectionStatus('Disconnected');
    });
  };

  const leaveLan = () => {
    socketRef.current?.close();
    socketRef.current = null;
    setLanSnapshot(null);
    setMode('solo');
    setSnapshot(engineRef.current?.getSnapshot() ?? initialSnapshot);
  };

  const startLan = () => {
    const localPlayerId = lanSnapshot?.localPlayerId;
    if (localPlayerId) {
      socketRef.current?.send(JSON.stringify({ type: 'start', playerId: localPlayerId }));
    }
  };

  const restartLan = () => {
    const localPlayerId = lanSnapshot?.localPlayerId;
    if (localPlayerId) {
      socketRef.current?.send(JSON.stringify({ type: 'restart', playerId: localPlayerId }));
    }
  };

  const sendLanCommand = useCallback((command: PlayerCommand) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(command));
    }
  }, []);

  const activeSnapshot = mode === 'lan' ? localLanSnapshot : snapshot;
  const lanPlayers: PlayerRuntime[] = lanSnapshot?.state.players ?? [];
  const showLanLobby = mode === 'lan' && lanSnapshot?.room.phase === 'lobby';
  const restart = mode === 'lan' ? restartLan : startRun;

  if (mode === 'lan') {
    return (
      <main className="app-shell">
        <LanGameCanvas state={lanSnapshot?.state ?? null} localPlayerId={lanSnapshot?.localPlayerId ?? null} sendCommand={sendLanCommand} />
        {activeSnapshot.phase !== 'menu' && <Hud snapshot={activeSnapshot} onPause={() => undefined} />}
        {showLanLobby && (
          <LanLobby
            players={lanPlayers}
            localPlayerId={lanSnapshot?.localPlayerId ?? null}
            hostPlayerId={lanSnapshot?.room.hostPlayerId ?? null}
            connectionStatus={connectionStatus}
            onStart={startLan}
            onLeave={leaveLan}
          />
        )}
        {activeSnapshot.phase === 'levelUp' && <UpgradeScreen title="Choose a boon" label="Level Up" choices={activeSnapshot.upgradeChoices} onChoose={chooseUpgrade} />}
        {activeSnapshot.phase === 'chestReward' && <UpgradeScreen title="Open the chest" label="Chest Reward" choices={activeSnapshot.pendingChestChoices} onChoose={chooseUpgrade} />}
        {activeSnapshot.phase === 'gameOver' && <EndScreen snapshot={activeSnapshot} onRestart={restart} />}
        {activeSnapshot.phase === 'victory' && <EndScreen snapshot={activeSnapshot} onRestart={restart} victory />}
      </main>
    );
  };

  return (
    <main className="app-shell">
      <GameCanvas onReady={handleReady} onSnapshot={setSnapshot} />
      {snapshot.phase !== 'menu' && <Hud snapshot={snapshot} onPause={pauseRun} />}
      {snapshot.phase === 'menu' && <MainMenu onStart={startRun} onLanStart={connectLan} />}
      {snapshot.phase === 'paused' && <PauseMenu weapons={snapshot.weapons} onResume={resumeRun} onRestart={startRun} />}
      {snapshot.phase === 'levelUp' && <UpgradeScreen title="Choose a boon" label="Level Up" choices={snapshot.upgradeChoices} onChoose={chooseUpgrade} />}
      {snapshot.phase === 'chestReward' && <UpgradeScreen title="Open the chest" label="Chest Reward" choices={snapshot.pendingChestChoices} onChoose={chooseUpgrade} />}
      {snapshot.phase === 'gameOver' && <EndScreen snapshot={snapshot} onRestart={startRun} />}
      {snapshot.phase === 'victory' && <EndScreen snapshot={snapshot} onRestart={startRun} victory />}
    </main>
  );
}
