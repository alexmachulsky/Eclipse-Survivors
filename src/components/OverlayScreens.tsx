import { useEffect, useRef, useState } from 'react';
import type { GameSnapshot } from '../game/GameEngine';
import type { PlayerRuntime, Weapon } from '../game/types';
import { WeaponTile } from './Hud';

interface MenuProps {
  onStart: () => void;
  onLanStart: () => void;
}

interface SummaryProps {
  snapshot: GameSnapshot;
  onRestart: () => void;
  victory?: boolean;
}

interface PauseProps {
  weapons: Weapon[];
  onResume: () => void;
  onRestart: () => void;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(0);
  const startTime = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    startTime.current = null;
    setValue(0);

    const tick = (now: number) => {
      if (startTime.current === null) startTime.current = now;
      const elapsed = now - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      setValue(Math.round(target * progress));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

export function MainMenu({ onStart, onLanStart }: MenuProps) {
  return (
    <div className="overlay overlay--menu">
      <div className="panel menu-panel">
        <p className="eyebrow">Eclipse Survivors</p>
        <h1>Hold the ritual line</h1>
        <p className="menu-copy">
          Survive the eclipse arena, gather power, and break the final threat.
        </p>
        <div className="button-row">
          <button className="primary-button" type="button" onClick={onStart}>
            Solo
          </button>
          <button className="secondary-button" type="button" onClick={onLanStart}>
            LAN Multiplayer
          </button>
        </div>
        <p className="control-hint">
          <strong>WASD</strong> / arrows to move &nbsp;·&nbsp; <strong>mouse</strong> to aim &nbsp;·&nbsp; <strong>Esc</strong> to pause
        </p>
      </div>
    </div>
  );
}

export function LanLobby({
  players,
  localPlayerId,
  hostPlayerId,
  connectionStatus,
  onStart,
  onLeave
}: {
  players: PlayerRuntime[];
  localPlayerId: string | null;
  hostPlayerId: string | null;
  connectionStatus: string;
  onStart: () => void;
  onLeave: () => void;
}) {
  const isHost = localPlayerId !== null && localPlayerId === hostPlayerId;

  return (
    <div className="overlay overlay--menu">
      <div className="panel menu-panel">
        <p className="eyebrow">LAN Lobby</p>
        <h2>Co-op run</h2>
        <div className="lobby-list">
          {players.map((player) => (
            <div key={player.id} className="lobby-player">
              <span className="lobby-swatch" style={{ background: player.color }} />
              <strong>{player.name}{player.id === hostPlayerId ? ' · host' : ''}</strong>
              <span>{player.status}</span>
            </div>
          ))}
        </div>
        <p className="control-hint">{connectionStatus}</p>
        <div className="button-row">
          {isHost && (
            <button className="primary-button" type="button" onClick={onStart}>
              Start
            </button>
          )}
          <button className="secondary-button" type="button" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}

export function PauseMenu({ weapons, onResume, onRestart }: PauseProps) {
  return (
    <div className="overlay">
      <div className="panel pause-panel">
        <p className="eyebrow">Paused</p>
        <h2>Run suspended</h2>
        <div className="pause-layout">
          {weapons.length > 0 && (
            <div className="pause-loadout">
              <p className="pause-loadout-label">Current loadout</p>
              <div className="pause-weapons">
                {weapons.map((w) => (
                  <WeaponTile key={w.id} weapon={w} />
                ))}
              </div>
            </div>
          )}
          <div className="button-row button-row--vertical">
            <button className="primary-button" type="button" onClick={onResume}>
              Resume
            </button>
            <button className="secondary-button" type="button" onClick={onRestart}>
              Restart
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, value, isTime = false }: { label: string; value: number; isTime?: boolean }) {
  const counted = useCountUp(value);
  const display = isTime ? formatTime(counted) : counted.toLocaleString();
  return (
    <div>
      <dt>{label}</dt>
      <dd>{display}</dd>
    </div>
  );
}

export function EndScreen({ snapshot, onRestart, victory = false }: SummaryProps) {
  const { stats } = snapshot;
  return (
    <div className="overlay">
      <div className={`panel end-panel ${victory ? 'victory' : ''}`}>
        <p className="eyebrow">{victory ? 'Victory' : 'Game Over'}</p>
        <h2>{victory ? 'The eclipse breaks' : 'The arena claims you'}</h2>
        <dl className="stats-grid">
          <StatCell label="Time" value={stats.timeSurvived} isTime />
          <StatCell label="Defeated" value={stats.kills} />
          <StatCell label="Level" value={stats.level} />
          <StatCell label="Upgrades" value={stats.upgradesCollected} />
          <StatCell label="Damage" value={Math.round(stats.damageDealt)} />
        </dl>
        <button className="primary-button" type="button" onClick={onRestart}>
          New Run
        </button>
      </div>
    </div>
  );
}
