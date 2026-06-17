import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { Hud } from './components/Hud';
import { LanGameCanvas } from './components/LanGameCanvas';
import { HUD_UPDATE_MS, shouldRefreshHud } from './components/hudThrottle';
import { EndScreen, LanLobby, LanSetup, MainMenu, PauseMenu, ShardShop } from './components/OverlayScreens';
import { UpgradeScreen } from './components/UpgradeScreen';
import { GameEngine, type GameSnapshot } from './game/GameEngine';
import { clamp } from './game/collisions';
import { getActLabel } from './game/runDirector';
import { saveRunRecord } from './game/persistence';
import { creditRunReward } from './game/wallet';
import { audioBus, diffSnapshotForAudio, toAudioInputs, type AudioInputs } from './game/audio';
import type { MultiplayerGameState, PlayerCommand, PlayerRuntime } from './game/types';
import { getUnlockedWeapons } from './game/weapons';

const initialSnapshot: GameSnapshot = new GameEngine().getSnapshot();

// LAN has no client-side pause; a stable handler reference lets React.memo(Hud)
// skip re-renders driven purely by the 30 Hz canvas snapshot stream.
const LAN_NO_PAUSE = () => undefined;

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
  const [showShop, setShowShop] = useState(false);
  // Shards earned on the most recent LAN run-end. LAN runs on the server, so the
  // client credits its own wallet and surfaces the amount on the end screen.
  const [lanRunReward, setLanRunReward] = useState(0);
  // Sound on/off, persisted. Reacts to snapshot deltas (covers solo + LAN).
  const [audioEnabled, setAudioEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('eclipse-survivors:audio-muted') !== '1';
  });
  const prevAudioRef = useRef<AudioInputs | null>(null);

  // Throttled HUD/overlay snapshot. Decoupled from `lanSnapshot` (which feeds
  // the canvas at full 30 Hz) so the HUD re-renders at ~12 Hz instead of 30 Hz.
  const [hudSnapshot, setHudSnapshot] = useState<GameSnapshot>(initialSnapshot);
  const hudThrottleRef = useRef(0);
  // Phase + local-player status; when this changes (level-up, death, end of
  // run) we push the HUD update immediately rather than waiting for the timer.
  const hudKeyRef = useRef<string | null>(null);

  // The snapshot the HUD/overlays read from: server-derived in LAN, engine
  // snapshot in solo. Memoized so React.memo(Hud) actually skips re-renders when
  // the underlying value is unchanged (the inline ternary changed identity).
  const activeSnapshot = useMemo(
    () => (mode === 'lan' ? hudSnapshot : snapshot),
    [mode, hudSnapshot, snapshot]
  );

  // Keep the audio bus in sync with the persisted mute preference.
  useEffect(() => {
    audioBus.setEnabled(audioEnabled);
  }, [audioEnabled]);

  // Browsers block audio until a user gesture; unlock the AudioContext on the
  // first input, then drop the listeners.
  useEffect(() => {
    const unlock = () => {
      audioBus.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Fire SFX from snapshot deltas. activeSnapshot is fed by both solo and LAN, so
  // this one hook covers both modes; the bus throttles high-frequency events.
  useEffect(() => {
    const inputs = toAudioInputs(activeSnapshot);
    for (const event of diffSnapshotForAudio(prevAudioRef.current, inputs)) {
      audioBus.play(event);
    }
    prevAudioRef.current = inputs;
  }, [activeSnapshot]);

  const toggleAudio = useCallback(() => {
    setAudioEnabled((on) => {
      const next = !on;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('eclipse-survivors:audio-muted', next ? '0' : '1');
      }
      // Toggling is itself a user gesture, so it's a safe spot to unlock audio.
      audioBus.resume();
      return next;
    });
  }, []);

  // Reset savedRef when starting a new run. Mode-aware: in LAN the live phase
  // lives on hudSnapshot, not snapshot (which stays frozen at the menu).
  useEffect(() => {
    const phase = activeSnapshot.phase;
    if (phase === 'menu' || phase === 'playing' || phase === 'paused' || phase === 'levelUp' || phase === 'chestReward') {
      savedRef.current = false;
    }
  }, [activeSnapshot.phase]);

  // Save run record when a game ends — for BOTH solo and LAN. In LAN the engine
  // never reaches an end-state (the server is authoritative), so without this
  // every LAN completion was lost: no run history and no shard credit.
  useEffect(() => {
    if ((activeSnapshot.phase === 'gameOver' || activeSnapshot.phase === 'victory') && !savedRef.current) {
      savedRef.current = true;
      const weaponTitles = ['Magic Bolt', 'Astral Orbit', 'Area Pulse', 'Piercing Arrow', 'Starfall Lance', 'Gravitic Halo', 'Supernova Bloom', 'Comet Volley'];
      saveRunRecord({
        timeSurvived: activeSnapshot.stats.timeSurvived,
        kills: activeSnapshot.stats.kills,
        level: activeSnapshot.level,
        damageDealt: activeSnapshot.stats.damageDealt,
        weaponPath: activeSnapshot.upgradeHistory.filter(t => weaponTitles.some(w => t.includes(w))),
      });
      // Solo credits the wallet inside the engine (GameEngine.creditWallet).
      // LAN runs on the server, so the client credits its own wallet here.
      if (mode === 'lan') {
        setLanRunReward(creditRunReward(activeSnapshot.stats, activeSnapshot.phase === 'victory'));
      }
    }
  }, [activeSnapshot.phase, activeSnapshot.stats, activeSnapshot.level, activeSnapshot.upgradeHistory, mode]);

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

  // useCallback keeps the reference stable so React.memo(Hud) is effective in
  // solo mode too (LAN already uses the stable LAN_NO_PAUSE). refreshSnapshot is
  // itself memoized with [], so this handler never changes identity.
  const pauseRun = useCallback(() => {
    engineRef.current?.pause();
    refreshSnapshot();
  }, [refreshSnapshot]);

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

    // Force the next snapshot to paint the HUD immediately (don't carry a stale
    // throttle key/timestamp from a previous room into the new session).
    hudKeyRef.current = null;
    hudThrottleRef.current = 0;

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
        // Full-rate stream for the canvas (interpolated in its own rAF loop).
        setLanSnapshot(message);
        // First snapshot is the cue that the server accepted us into a room.
        // Switch the UI to the lobby (or game, if the host already started).
        setLanScreen('lobby');
        // Throttle the React HUD/overlay update, but always fire immediately on
        // a phase/status transition so level-up, death and end screens are not
        // delayed by the throttle window.
        const runtime = message.state.players.find((player) => player.id === message.localPlayerId);
        const decision = shouldRefreshHud(
          hudKeyRef.current,
          hudThrottleRef.current,
          message.room.phase,
          runtime?.status,
          performance.now(),
          HUD_UPDATE_MS
        );
        if (decision.refresh) {
          hudKeyRef.current = decision.key;
          hudThrottleRef.current = decision.time;
          setHudSnapshot(createLocalSnapshot(message));
        }
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

  const lanPlayers: PlayerRuntime[] = lanSnapshot?.state.players ?? [];
  const showLanLobby = mode === 'lan' && lanScreen === 'lobby' && lanSnapshot?.room.phase === 'lobby';
  const showLanSetup = mode === 'lan' && lanScreen !== 'lobby';
  const restart = mode === 'lan' ? restartLan : startRun;

  if (mode === 'lan') {
    return (
      <main className="app-shell">
        <LanGameCanvas state={lanSnapshot?.state ?? null} localPlayerId={lanSnapshot?.localPlayerId ?? null} sendCommand={sendLanCommand} />
        {activeSnapshot.phase !== 'menu' && lanScreen === 'lobby' && <Hud snapshot={activeSnapshot} onPause={LAN_NO_PAUSE} audioEnabled={audioEnabled} onToggleAudio={toggleAudio} />}
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
        {lanScreen === 'lobby' && activeSnapshot.phase === 'gameOver' && <EndScreen snapshot={{ ...activeSnapshot, lastRunReward: lanRunReward }} onRestart={restart} />}
        {lanScreen === 'lobby' && activeSnapshot.phase === 'victory' && <EndScreen snapshot={{ ...activeSnapshot, lastRunReward: lanRunReward }} onRestart={restart} victory />}
      </main>
    );
  };

  return (
    <main className="app-shell">
      <GameCanvas onReady={handleReady} onSnapshot={setSnapshot} />
      {snapshot.phase !== 'menu' && <Hud snapshot={snapshot} onPause={pauseRun} audioEnabled={audioEnabled} onToggleAudio={toggleAudio} />}
      {snapshot.phase === 'menu' && !showShop && <MainMenu onStart={startRun} onLanStart={openLanChooser} onOpenShop={() => setShowShop(true)} />}
      {snapshot.phase === 'menu' && showShop && <ShardShop onClose={() => setShowShop(false)} />}
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
