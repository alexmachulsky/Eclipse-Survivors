import { useEffect, useRef, useState } from 'react';
import type { GameSnapshot } from '../game/GameEngine';
import type { PlayerRuntime, Weapon } from '../game/types';
import { loadRunHistory, type RunHistory } from '../game/persistence';
import { loadWallet, type Wallet } from '../game/wallet';
import { WeaponTile } from './Hud';
import { AreaPulseIcon, ClockIcon, MagicBoltIcon, OrbitIcon, PiercingArrowIcon, SkullIcon, StarIcon, WeaponIconMap } from './icons';

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
  snapshot: GameSnapshot;
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
  const [wallet, setWallet] = useState<Wallet | null>(null);

  useEffect(() => {
    setHistory(loadRunHistory());
    setWallet(loadWallet());
  }, []);

  const best = history?.best ?? null;
  const last = history?.last ?? null;

  return (
    <div className="overlay overlay--menu">
      <div className="eclipse-motif" aria-hidden="true">
        <div className="eclipse-corona" />
        <div className="eclipse-disc" />
      </div>
      <div className="panel menu-panel">
        <p className="eyebrow">Eclipse Survivors</p>
        <h1>Hold the ritual line</h1>
        <p className="menu-copy">
          Survive the eclipse arena, gather power, and break the final threat.
        </p>
        {best && (
          <div className="menu-stats-banner">
            <ClockIcon size={13} color="var(--c-rare)" />
            <span>Best <strong>{formatTime(best.timeSurvived)}</strong></span>
            <span className="menu-stats-sep">·</span>
            <SkullIcon size={13} color="var(--c-rare)" />
            <strong>{best.kills}</strong>
            <span className="menu-stats-sep">·</span>
            <StarIcon size={13} color="var(--c-rare)" />
            <strong>lv.{best.level}</strong>
          </div>
        )}
        {last && (
          <div className="menu-last-run">
            Last run · {formatTime(last.timeSurvived)} · lv.{last.level} · {last.kills} kills
            {last.weaponPath.length > 0 && ` · ${last.weaponPath.slice(0, 3).join(' → ')}`}
          </div>
        )}
        {wallet && wallet.lifetimeEarned > 0 && (
          <div className="wallet-chip" aria-label="Eclipse Shards balance">
            <span className="wallet-chip__gem" aria-hidden="true">◆</span>
            <span><strong>{wallet.shards.toLocaleString()}</strong> shards</span>
          </div>
        )}
        <div className="button-row">
          <button className="primary-button btn--primary-large" type="button" onClick={onStart}>
            Begin Solo Run
          </button>
          <button className="secondary-button" type="button" onClick={onLanStart}>
            LAN Multiplayer
          </button>
        </div>
        <div className="menu-arsenal" aria-label="Available weapons">
          <span className="menu-arsenal-label">Arsenal</span>
          <div className="menu-arsenal-icons">
            <MagicBoltIcon size={18} color="var(--c-common)" />
            <OrbitIcon size={18} color="#64748b" />
            <AreaPulseIcon size={18} color="#64748b" />
            <PiercingArrowIcon size={18} color="#64748b" />
            <span className="menu-arsenal-more">+ 4 more</span>
          </div>
        </div>
        <p className="control-hint">
          <kbd>WASD</kbd> move &nbsp;·&nbsp; <kbd>Mouse</kbd> aim &nbsp;·&nbsp; <kbd>Esc</kbd> pause
        </p>
      </div>
    </div>
  );
}

type LanSetupScreen = 'chooser' | 'create' | 'join';

export type LanSetupIntent =
  | { kind: 'create'; playerName: string; roomName: string }
  | { kind: 'join'; playerName: string; roomCode: string };

interface LanSetupProps {
  screen: LanSetupScreen;
  error: string | null;
  onChooseScreen: (screen: LanSetupScreen) => void;
  onSubmit: (intent: LanSetupIntent) => void;
  onCancel: () => void;
}

function rememberedName(): string {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem('survival-lan-name') ?? '';
}

export function LanSetup({ screen, error, onChooseScreen, onSubmit, onCancel }: LanSetupProps) {
  const [playerName, setPlayerName] = useState(rememberedName);
  const [roomName, setRoomName] = useState("Friend's Room");
  const [roomCode, setRoomCode] = useState('');

  const handleCreateSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit({ kind: 'create', playerName, roomName });
  };

  const handleJoinSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!roomCode.trim()) return;
    onSubmit({ kind: 'join', playerName, roomCode });
  };

  return (
    <div className="overlay overlay--menu">
      <div className="eclipse-motif" aria-hidden="true">
        <div className="eclipse-corona" />
        <div className="eclipse-disc" />
      </div>
      <div className="panel menu-panel">
        <p className="eyebrow">LAN Multiplayer</p>
        {screen === 'chooser' && (
          <>
            <h2>Co-op run</h2>
            <p className="menu-copy">Host a private game to share a code with your friends, or join an existing room.</p>
            <div className="button-row">
              <button className="primary-button btn--primary-large" type="button" onClick={() => onChooseScreen('create')}>
                Host Private Game
              </button>
              <button className="secondary-button btn--primary-large" type="button" onClick={() => onChooseScreen('join')}>
                Join with Code
              </button>
            </div>
            <p className="control-hint">Anyone on your local network can connect to a hosted room.</p>
            <button className="link-button" type="button" onClick={onCancel}>← Back to main menu</button>
          </>
        )}

        {screen === 'create' && (
          <>
            <h2>Host a room</h2>
            <form className="lan-form" onSubmit={handleCreateSubmit}>
              <label className="lan-field">
                <span>Room name</span>
                <input
                  type="text"
                  value={roomName}
                  maxLength={32}
                  autoFocus
                  onChange={(event) => setRoomName(event.target.value)}
                  placeholder="Friend's Room"
                />
              </label>
              <label className="lan-field">
                <span>Your name</span>
                <input
                  type="text"
                  value={playerName}
                  maxLength={24}
                  onChange={(event) => setPlayerName(event.target.value)}
                  placeholder="Player"
                />
              </label>
              {error && <p className="lan-error">{error}</p>}
              <div className="button-row">
                <button className="primary-button btn--primary-large" type="submit">
                  Create Room
                </button>
                <button className="secondary-button" type="button" onClick={() => onChooseScreen('chooser')}>
                  Back
                </button>
              </div>
            </form>
          </>
        )}

        {screen === 'join' && (
          <>
            <h2>Join a room</h2>
            <form className="lan-form" onSubmit={handleJoinSubmit}>
              <label className="lan-field">
                <span>Room code</span>
                <input
                  className="room-code-input"
                  type="text"
                  value={roomCode}
                  maxLength={8}
                  autoCapitalize="characters"
                  spellCheck={false}
                  autoFocus
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="ABCD"
                />
              </label>
              <label className="lan-field">
                <span>Your name</span>
                <input
                  type="text"
                  value={playerName}
                  maxLength={24}
                  onChange={(event) => setPlayerName(event.target.value)}
                  placeholder="Player"
                />
              </label>
              {error && <p className="lan-error">{error}</p>}
              <div className="button-row">
                <button className="primary-button btn--primary-large" type="submit" disabled={!roomCode.trim()}>
                  Join Room
                </button>
                <button className="secondary-button" type="button" onClick={() => onChooseScreen('chooser')}>
                  Back
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function execCopy(text: string): void {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(el);
  el.focus();
  el.select();
  try { document.execCommand('copy'); } catch { /* best-effort */ }
  document.body.removeChild(el);
}

export function LanLobby({
  players,
  localPlayerId,
  hostPlayerId,
  roomCode,
  roomName,
  connectionStatus,
  error,
  onStart,
  onLeave
}: {
  players: PlayerRuntime[];
  localPlayerId: string | null;
  hostPlayerId: string | null;
  roomCode: string;
  roomName: string;
  connectionStatus: string;
  error: string | null;
  onStart: () => void;
  onLeave: () => void;
}) {
  const isHost = localPlayerId !== null && localPlayerId === hostPlayerId;
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    if (!roomCode) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(roomCode).catch(() => execCopy(roomCode));
    } else {
      execCopy(roomCode);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="overlay overlay--menu">
      <div className="panel menu-panel">
        <p className="eyebrow">LAN Lobby</p>
        <h2>{roomName || 'Co-op run'}</h2>
        {roomCode && (
          <div className="room-code-banner">
            <span className="room-code-banner-label">Share this code</span>
            <button type="button" className="room-code-pill" onClick={copyCode} aria-label={`Room code ${roomCode}, click to copy`}>
              <span>{roomCode}</span>
              <span className="room-code-copy-hint">{copied ? 'copied!' : 'click to copy'}</span>
            </button>
          </div>
        )}
        <div className="lobby-list">
          {players.map((player) => (
            <div key={player.id} className="lobby-player">
              <span className="lobby-swatch" style={{ background: player.color }} />
              <strong>{player.name}{player.id === hostPlayerId ? ' · host' : ''}</strong>
              <span>{player.status}</span>
            </div>
          ))}
        </div>
        {error && <p className="lan-error">{error}</p>}
        <p className="control-hint">{isHost ? 'You are the host — start when everyone has joined.' : 'Waiting for the host to start the run…'} · {connectionStatus}</p>
        <div className="button-row">
          {isHost && (
            <button className="primary-button btn--primary-large" type="button" onClick={onStart}>
              Start Run
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

export function PauseMenu({ weapons, snapshot, onResume, onRestart }: PauseProps) {
  return (
    <div className="overlay">
      <div className="panel pause-panel">
        <p className="eyebrow">Paused</p>
        <h2>Run suspended</h2>
        <dl className="pause-stats">
          <div>
            <dt>Time</dt>
            <dd>{formatTime(snapshot.elapsed)}</dd>
          </div>
          <div>
            <dt>Kills</dt>
            <dd>{snapshot.kills}</dd>
          </div>
          <div>
            <dt>Level</dt>
            <dd>{snapshot.level}</dd>
          </div>
          <div>
            <dt>Phase</dt>
            <dd className="pause-stats-act">{snapshot.actLabel}</dd>
          </div>
        </dl>
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

const WEAPON_NAME_TO_ID: Record<string, keyof typeof WeaponIconMap> = {
  'Magic Bolt': 'magic-bolt',
  'Astral Orbit': 'orbit',
  'Area Pulse': 'area-pulse',
  'Piercing Arrow': 'piercing-arrow',
  // Evolutions reuse the base icon as a visual hint.
  'Starfall Lance': 'magic-bolt',
  'Gravitic Halo': 'orbit',
  'Supernova Bloom': 'area-pulse',
  'Comet Volley': 'piercing-arrow',
};

export function EndScreen({ snapshot, onRestart, victory = false }: SummaryProps) {
  const { stats } = snapshot;
  const history = loadRunHistory();
  const isNewRecord = history.best && (
    stats.timeSurvived > history.best.timeSurvived ||
    stats.kills > history.best.kills ||
    stats.level > history.best.level
  );

  const WEAPON_NAMES = Object.keys(WEAPON_NAME_TO_ID);

  const weaponPath = (snapshot.upgradeHistory ?? [])
    .map((title) => WEAPON_NAMES.find((name) => title.includes(name)))
    .filter((name): name is string => name !== undefined);

  const dedupedPath = weaponPath.filter((name, i) => i === 0 || name !== weaponPath[i - 1]);
  const visiblePath = dedupedPath.slice(0, 6);

  const panelClassname = `panel end-panel ${victory ? 'end-panel--victory' : 'end-panel--defeat'}`;
  const headerText = victory ? 'The eclipse breaks' : 'The eclipse claims you';

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
        {visiblePath.length > 0 && (
          <div className="weapon-path">
            <span className="weapon-path-label">Weapon path</span>
            <div className="weapon-path-icons">
              {visiblePath.map((name, idx) => {
                const Icon = WeaponIconMap[WEAPON_NAME_TO_ID[name]];
                return (
                  <span key={idx} className="weapon-path-step" title={name}>
                    {idx > 0 && <span className="weapon-path-arrow" aria-hidden="true">→</span>}
                    <span className="weapon-path-icon">
                      {Icon ? <Icon size={18} color="var(--c-rare)" /> : null}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {snapshot.lastRunReward > 0 && (
          <p className="end-screen-reward">
            Earned <strong>+{snapshot.lastRunReward}</strong> Eclipse Shards
          </p>
        )}
        <button className="primary-button btn--primary-large" type="button" onClick={onRestart}>
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
