import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { Hud } from './components/Hud';
import { LanGameCanvas } from './components/LanGameCanvas';
import { EndScreen, LanLobby, LanSetup, MainMenu, PauseMenu } from './components/OverlayScreens';
import { UpgradeScreen } from './components/UpgradeScreen';
import { GameEngine, type GameSnapshot } from './game/GameEngine';
import { clamp } from './game/collisions';
import { getActLabel } from './game/runDirector';
import { saveRunRecord } from './game/persistence';
import type { MultiplayerGameState, PlayerCommand, PlayerRuntime } from './game/types';
import { getUnlockedWeapons } from './game/weapons';

const initialSnapshot: GameSnapshot = new GameEngine().getSnapshot();

type Mode = 'solo' | 'lan';

interface ServerSnapshot {
  type: 'snapshot';
  tick: number;
  localPlayerId: string;
  room: {
    code: string;
    name: string;
    phase: 'lobby' | 'playing' | 'gameOver' | 'victory';
    hostPlayerId: string | null;
  };
  state: MultiplayerGameState;
}

import type { LanSetupIntent } from './components/OverlayScreens';

type LanIntent = LanSetupIntent;

type LanScreen = 'chooser' | 'create' | 'join' | 'lobby';

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
    pendingChestChoices: runtime?.pendingChestChoices ?? [],
    killStreak: state.killStreak,
    weaponDamageDealt: state.weaponDamageDealt,
    upgradeHistory: state.upgradeHistory,
    bossApproachingIn: !state.bossSpawned && (300 - state.elapsed) <= 30
      ? Math.ceil(300 - state.elapsed)
      : null,
    healthRatio: runtime?.player.health ? runtime.player.health / runtime.player.maxHealth : 0,
    agency: { rerolls: 0, banishes: 0, locks: 0, maxRerolls: 0, maxLocks: 0 },
    bannedUpgradeIds: [],
    lockedSlot: null,
    lastRunReward: 0,
    dash: {
      charges: runtime?.player.dash.charges ?? 0,
      maxCharges: (runtime?.player.dash.maxCharges ?? 0) + (runtime?.player.dashChargeBonus ?? 0),
      rechargeRemaining: runtime?.player.dash.rechargeRemaining ?? 0,
      rechargeDuration: (runtime?.player.dash.rechargeDuration ?? 0) * ((runtime?.player.dashRechargeMult) ?? 1)
    }
  };
}

export default function App() {
  const engineRef = useRef<GameEngine | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const savedRef = useRef(false);
  const [snapshot, setSnapshot] = useState<GameSnapshot>(initialSnapshot);
  const [mode, setMode] = useState<Mode>('solo');
  const [lanSnapshot, setLanSnapshot] = useState<ServerSnapshot | null>(null);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [lanScreen, setLanScreen] = useState<LanScreen>('chooser');
  const [lanError, setLanError] = useState<string | null>(null);

  const localLanSnapshot = useMemo(() => createLocalSnapshot(lanSnapshot), [lanSnapshot]);

  // Reset savedRef when starting a new run
  useEffect(() => {
    if (snapshot.phase === 'menu' || snapshot.phase === 'playing' || snapshot.phase === 'paused' || snapshot.phase === 'levelUp' || snapshot.phase === 'chestReward') {
      savedRef.current = false;
    }
  }, [snapshot.phase]);

  // Save run record when game ends
  useEffect(() => {
    if ((snapshot.phase === 'gameOver' || snapshot.phase === 'victory') && !savedRef.current) {
      savedRef.current = true;
      const weaponTitles = ['Magic Bolt', 'Astral Orbit', 'Area Pulse', 'Piercing Arrow', 'Starfall Lance', 'Gravitic Halo', 'Supernova Bloom', 'Comet Volley'];
      saveRunRecord({
        timeSurvived: snapshot.stats.timeSurvived,
        kills: snapshot.stats.kills,
        level: snapshot.level,
        damageDealt: snapshot.stats.damageDealt,
        weaponPath: snapshot.upgradeHistory.filter(t => weaponTitles.some(w => t.includes(w))),
      });
    }
  }, [snapshot.phase, snapshot.stats, snapshot.level, snapshot.upgradeHistory]);

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

  const rerollUpgrades = () => {
    if (mode === 'lan') return;
    engineRef.current?.rerollChoices();
    refreshSnapshot();
  };

  const banishUpgrade = (index: number) => {
    if (mode === 'lan') return;
    engineRef.current?.banishChoice(index);
    refreshSnapshot();
  };

  const lockUpgrade = (index: number) => {
    if (mode === 'lan') return;
    engineRef.current?.lockChoice(index);
    refreshSnapshot();
  };

  const openLanChooser = () => {
    setLanError(null);
    setLanScreen('chooser');
    setMode('lan');
  };

  const connectLan = (intent: LanIntent) => {
    // Force a fresh socket so the server creates / joins a new room rather
    // than silently reusing a stale connection from a previous attempt.
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    const randomTag = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID().slice(0, 4)
      : Math.random().toString(36).slice(2, 6);
    const fallbackName = `Player ${randomTag}`;
    const name = (intent.playerName.trim() || window.sessionStorage.getItem('survival-lan-name') || fallbackName).slice(0, 24);
    window.sessionStorage.setItem('survival-lan-name', name);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socketRef.current = socket;
    setMode('lan');
    setLanError(null);
    setConnectionStatus('Connecting...');
    // Stay on the user's form (create / join) until we actually receive a
    // snapshot from the server. That way an error from the server is
    // displayed in-place and the user can retry, instead of leaving them
    // staring at an empty canvas.
    setLanScreen(intent.kind);

    socket.addEventListener('open', () => {
      setConnectionStatus('Connected');
      const hello = intent.kind === 'create'
        ? { type: 'hello', name, action: 'create', roomName: intent.roomName.trim() || "Friend's Room" }
        : { type: 'hello', name, action: 'join', roomCode: intent.roomCode.trim().toUpperCase() };
      socket.send(JSON.stringify(hello));
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data) as
        | ServerSnapshot
        | { type: 'welcome'; reconnectToken: string; roomCode: string; roomName: string }
        | { type: 'error'; message: string };

      if (message.type === 'welcome') {
        window.sessionStorage.setItem('survival-lan-session', message.reconnectToken);
      } else if (message.type === 'snapshot') {
        setLanSnapshot(message);
        // First snapshot is the cue that the server accepted us into a room.
        // Switch the UI to the lobby (or game, if the host already started).
        setLanScreen('lobby');
      } else if (message.type === 'error') {
        setLanError(message.message);
        setConnectionStatus(message.message);
      }
    });

    socket.addEventListener('close', () => {
      setConnectionStatus((prev) => (prev === 'Connecting...' ? 'Could not reach the room.' : 'Disconnected'));
    });
  };

  const leaveLan = () => {
    socketRef.current?.close();
    socketRef.current = null;
    // Forget any reconnect token so the next create/join doesn't silently
    // resurrect the previous room session.
    window.sessionStorage.removeItem('survival-lan-session');
    setLanSnapshot(null);
    setLanScreen('chooser');
    setLanError(null);
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
  const showLanLobby = mode === 'lan' && lanScreen === 'lobby' && lanSnapshot?.room.phase === 'lobby';
  const showLanSetup = mode === 'lan' && lanScreen !== 'lobby';
  const restart = mode === 'lan' ? restartLan : startRun;

  if (mode === 'lan') {
    return (
      <main className="app-shell">
        <LanGameCanvas state={lanSnapshot?.state ?? null} localPlayerId={lanSnapshot?.localPlayerId ?? null} sendCommand={sendLanCommand} />
        {activeSnapshot.phase !== 'menu' && lanScreen === 'lobby' && <Hud snapshot={activeSnapshot} onPause={() => undefined} />}
        {showLanSetup && (
          <LanSetup
            screen={lanScreen as Exclude<LanScreen, 'lobby'>}
            error={lanError}
            onChooseScreen={(screen: Exclude<LanScreen, 'lobby'>) => { setLanError(null); setLanScreen(screen); }}
            onSubmit={connectLan}
            onCancel={leaveLan}
          />
        )}
        {showLanLobby && (
          <LanLobby
            players={lanPlayers}
            localPlayerId={lanSnapshot?.localPlayerId ?? null}
            hostPlayerId={lanSnapshot?.room.hostPlayerId ?? null}
            roomCode={lanSnapshot?.room.code ?? ''}
            roomName={lanSnapshot?.room.name ?? ''}
            connectionStatus={connectionStatus}
            error={lanError}
            onStart={startLan}
            onLeave={leaveLan}
          />
        )}
        {lanScreen === 'lobby' && activeSnapshot.phase === 'levelUp' && <UpgradeScreen title="Choose a boon" label="Level Up" choices={activeSnapshot.upgradeChoices} onChoose={chooseUpgrade} />}
        {lanScreen === 'lobby' && activeSnapshot.phase === 'chestReward' && <UpgradeScreen title="Open the chest" label="Chest Reward" choices={activeSnapshot.pendingChestChoices} onChoose={chooseUpgrade} />}
        {lanScreen === 'lobby' && activeSnapshot.phase === 'gameOver' && <EndScreen snapshot={activeSnapshot} onRestart={restart} />}
        {lanScreen === 'lobby' && activeSnapshot.phase === 'victory' && <EndScreen snapshot={activeSnapshot} onRestart={restart} victory />}
      </main>
    );
  };

  return (
    <main className="app-shell">
      <GameCanvas onReady={handleReady} onSnapshot={setSnapshot} />
      {snapshot.phase !== 'menu' && <Hud snapshot={snapshot} onPause={pauseRun} />}
      {snapshot.phase === 'menu' && <MainMenu onStart={startRun} onLanStart={openLanChooser} />}
      {snapshot.phase === 'paused' && <PauseMenu weapons={snapshot.weapons} snapshot={snapshot} onResume={resumeRun} onRestart={startRun} />}
      {snapshot.phase === 'levelUp' && (
        <UpgradeScreen
          title="Choose a boon"
          label="Level Up"
          choices={snapshot.upgradeChoices}
          onChoose={chooseUpgrade}
          agency={snapshot.agency}
          lockedSlot={snapshot.lockedSlot}
          onReroll={rerollUpgrades}
          onBanish={banishUpgrade}
          onLock={lockUpgrade}
        />
      )}
      {snapshot.phase === 'chestReward' && <UpgradeScreen title="Open the chest" label="Chest Reward" choices={snapshot.pendingChestChoices} onChoose={chooseUpgrade} />}
      {snapshot.phase === 'gameOver' && <EndScreen snapshot={snapshot} onRestart={startRun} />}
      {snapshot.phase === 'victory' && <EndScreen snapshot={snapshot} onRestart={startRun} victory />}
    </main>
  );
}
