import { useEffect, useRef, useState } from 'react';
import type { GameSnapshot } from '../game/GameEngine';
import type { PlayerRuntime, Weapon } from '../game/types';
import { loadRunHistory, type RunHistory } from '../game/persistence';
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
  const [history, setHistory] = useState<RunHistory | null>(null);

  useEffect(() => {
    setHistory(loadRunHistory());
  }, []);

  const best = history?.best ?? null;
  const last = history?.last ?? null;

  return (
    <div className="overlay overlay--menu">
      <div className="panel menu-panel">
        <p className="eyebrow">Eclipse Survivors</p>
        <h1>Hold the ritual line</h1>
        <p className="menu-copy">
          Survive the eclipse arena, gather power, and break the final threat.
        </p>
        {best && (
          <div className="menu-stats-banner">
            <span>Best: {formatTime(best.timeSurvived)}</span>
            <span className="menu-stats-sep">·</span>
            <span>{best.kills} kills</span>
            <span className="menu-stats-sep">·</span>
            <span>lv.{best.level}</span>
          </div>
        )}
        {last && (
          <div className="menu-last-run">
            Last: {formatTime(last.timeSurvived)} · lv.{last.level} · {last.kills} kills
            {last.weaponPath.length > 0 && ` · ${last.weaponPath.slice(0, 3).join(' → ')}`}
          </div>
        )}
        <div className="button-row">
          <button className="primary-button btn--primary-large" type="button" onClick={onStart}>
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
                {weapons.map((w, idx) => (
                  <WeaponTile key={w.id} weapon={w} isActive={idx === 0} />
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
  const history = loadRunHistory();
  const isNewRecord = history.best && (
    stats.timeSurvived > history.best.timeSurvived ||
    stats.kills > history.best.kills ||
    stats.level > history.best.level
  );

  const weaponPath = snapshot.upgradeHistory
    .filter(t => ['Magic Bolt', 'Astral Orbit', 'Area Pulse', 'Piercing Arrow',
                   'Starfall Lance', 'Gravitic Halo', 'Supernova Bloom', 'Comet Volley']
              .some(w => t.includes(w)));

  const panelClassname = `panel end-panel ${victory ? 'end-panel--victory' : 'end-panel--defeat'}`;
  const headerText = victory ? 'The eclipse breaks' : 'THE ECLIPSE CLAIMS YOU';

  return (
    <div className="overlay">
      <div className={panelClassname}>
        {isNewRecord && <div className="record-badge">★ NEW RECORD</div>}
        <p className="eyebrow">{victory ? 'Victory' : 'Game Over'}</p>
        <h2>{headerText}</h2>
        <dl className="stats-grid">
          <StatCell label="Time" value={stats.timeSurvived} isTime />
          <StatCell label="Defeated" value={stats.kills} />
          <StatCell label="Level" value={stats.level} />
          <StatCell label="Upgrades" value={stats.upgradesCollected} />
          <StatCell label="Damage" value={Math.round(stats.damageDealt)} />
        </dl>
        {weaponPath.length > 0 && (
          <div className="weapon-path">
            {weaponPath.slice(0, 6).join(' → ')}
          </div>
        )}
        <button className="primary-button" type="button" onClick={onRestart}>
          New Run
        </button>
        {victory && (
          <div className="victory-confetti">
            {Array.from({ length: 20 }).map((_, idx) => (
              <span
                key={idx}
                style={{
                  left: `${5 + (idx % 20) * 5}%`,
                  animationDuration: `${1.5 + (idx % 15) * 0.1}s`,
                  animationDelay: `${(idx % 20) * 0.1}s`,
                  backgroundColor: idx % 4 === 0 ? '#ffd166' : idx % 4 === 1 ? '#ff5edb' : '#5eead4',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
