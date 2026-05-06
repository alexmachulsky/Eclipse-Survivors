import { useEffect, useRef, useState } from 'react';
import type { GameSnapshot } from '../game/GameEngine';
import type { PlayerRuntime, Weapon } from '../game/types';
import { loadRunHistory, type RunHistory } from '../game/persistence';
import { loadWallet, type Wallet } from '../game/wallet';
import { WeaponTile } from './Hud';
import { AreaPulseIcon, MagicBoltIcon, OrbitIcon, PiercingArrowIcon, WeaponIconMap } from './icons';

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

function EclipseDiagram() {
  return (
    <svg className="eclipse-diagram" viewBox="0 0 400 400" aria-hidden="true">
      <defs>
        <radialGradient id="ed-corona" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(255 209 102 / 0.0)" />
          <stop offset="42%" stopColor="rgb(255 209 102 / 0.0)" />
          <stop offset="55%" stopColor="rgb(255 209 102 / 0.55)" />
          <stop offset="62%" stopColor="rgb(255 138 61 / 0.18)" />
          <stop offset="78%" stopColor="rgb(139 92 246 / 0.10)" />
          <stop offset="100%" stopColor="rgb(2 3 10 / 0)" />
        </radialGradient>
        <radialGradient id="ed-disc" cx="38%" cy="36%" r="80%">
          <stop offset="0%" stopColor="#1c1641" />
          <stop offset="55%" stopColor="#08071a" />
          <stop offset="100%" stopColor="#02020a" />
        </radialGradient>
        <radialGradient id="ed-bead" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(255 247 220 / 1)" />
          <stop offset="40%" stopColor="rgb(255 209 102 / 0.7)" />
          <stop offset="100%" stopColor="rgb(255 209 102 / 0)" />
        </radialGradient>
        <filter id="ed-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* outermost zodiac ring with degree ticks */}
      <g className="ed-ring ed-ring--outer">
        <circle cx="200" cy="200" r="194" fill="none" stroke="rgb(212 175 55 / 0.32)" strokeWidth="0.5" />
        <circle cx="200" cy="200" r="186" fill="none" stroke="rgb(212 175 55 / 0.18)" strokeWidth="0.5" strokeDasharray="1 7" />
        {Array.from({ length: 72 }).map((_, i) => {
          const long = i % 6 === 0;
          const a = (i * 5 * Math.PI) / 180;
          const r1 = 186;
          const r2 = long ? 174 : 180;
          const x1 = 200 + Math.cos(a) * r1;
          const y1 = 200 + Math.sin(a) * r1;
          const x2 = 200 + Math.cos(a) * r2;
          const y2 = 200 + Math.sin(a) * r2;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={long ? 'rgb(212 175 55 / 0.7)' : 'rgb(212 175 55 / 0.32)'}
              strokeWidth={long ? 0.8 : 0.4}
            />
          );
        })}
      </g>

      {/* cardinal sigils */}
      <g className="ed-sigils">
        <text x="200" y="32" textAnchor="middle" fontSize="14" fill="rgb(241 215 122 / 0.9)" fontFamily="serif">☉</text>
        <text x="368" y="206" textAnchor="middle" fontSize="14" fill="rgb(241 215 122 / 0.9)" fontFamily="serif">☽</text>
        <text x="200" y="378" textAnchor="middle" fontSize="14" fill="rgb(241 215 122 / 0.9)" fontFamily="serif">⚸</text>
        <text x="32" y="206" textAnchor="middle" fontSize="14" fill="rgb(241 215 122 / 0.9)" fontFamily="serif">✦</text>
      </g>

      {/* mid declination ring (counter-rotates) */}
      <g className="ed-ring ed-ring--mid">
        <circle cx="200" cy="200" r="156" fill="none" stroke="rgb(212 175 55 / 0.2)" strokeWidth="0.5" strokeDasharray="2 4" />
        <circle cx="200" cy="200" r="148" fill="none" stroke="rgb(212 175 55 / 0.12)" strokeWidth="0.5" />
      </g>

      {/* corona glow */}
      <circle cx="200" cy="200" r="180" fill="url(#ed-corona)" filter="url(#ed-soft)" className="ed-corona-pulse" />

      {/* halo gold ring around disc */}
      <circle cx="200" cy="200" r="106" fill="none" stroke="rgb(212 175 55 / 0.95)" strokeWidth="0.7" />
      <circle cx="200" cy="200" r="110" fill="none" stroke="rgb(212 175 55 / 0.18)" strokeWidth="3" />

      {/* eclipsed disc */}
      <circle cx="200" cy="200" r="104" fill="url(#ed-disc)" />
      {/* inner shadow line */}
      <circle cx="200" cy="200" r="100" fill="none" stroke="rgb(0 0 0 / 0.6)" strokeWidth="6" />

      {/* bailey's beads */}
      <g className="ed-beads">
        <circle cx="296" cy="138" r="3" fill="url(#ed-bead)" />
        <circle cx="118" cy="266" r="2.4" fill="url(#ed-bead)" />
        <circle cx="266" cy="288" r="2" fill="url(#ed-bead)" />
        <circle cx="138" cy="118" r="1.8" fill="url(#ed-bead)" />
      </g>

      {/* central crosshair sigil (rotates) */}
      <g className="ed-crosshair">
        <line x1="200" y1="186" x2="200" y2="214" stroke="rgb(241 215 122 / 0.8)" strokeWidth="0.6" />
        <line x1="186" y1="200" x2="214" y2="200" stroke="rgb(241 215 122 / 0.8)" strokeWidth="0.6" />
        <circle cx="200" cy="200" r="6" fill="none" stroke="rgb(241 215 122 / 0.8)" strokeWidth="0.6" />
        <circle cx="200" cy="200" r="1.2" fill="rgb(241 215 122 / 0.95)" />
      </g>

      {/* declination lines crossing through */}
      <line x1="200" y1="6" x2="200" y2="394" stroke="rgb(212 175 55 / 0.08)" strokeWidth="0.5" strokeDasharray="2 6" />
      <line x1="6" y1="200" x2="394" y2="200" stroke="rgb(212 175 55 / 0.08)" strokeWidth="0.5" strokeDasharray="2 6" />
    </svg>
  );
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
  const showShards = wallet && wallet.lifetimeEarned > 0;

  return (
    <div className="overlay overlay--menu overlay--codex">
      <div className="ritual-line" aria-hidden="true">
        <span className="ritual-line__sigil">☉</span>
      </div>
      <div className="codex-rail" aria-hidden="true">
        <span>MMXXVI</span>
        <span className="codex-rail__sep">✦</span>
        <span>Space Raiders</span>
        <span className="codex-rail__sep">✦</span>
        <span>Log I</span>
      </div>
      <div className="codex-rail codex-rail--right" aria-hidden="true">
        <span>A pilot's log from the outer reaches</span>
      </div>

      <div className="eclipse-motif eclipse-motif--codex" aria-hidden="true">
        <EclipseDiagram />
      </div>

      <div className="panel menu-panel menu-panel--codex">
        <span className="sigil-corner sigil-corner--tl" aria-hidden="true">
          <svg viewBox="0 0 40 40" width="40" height="40"><path d="M2 2 L18 2 M2 2 L2 18 M2 2 L14 14" stroke="rgb(212 175 55 / 0.55)" strokeWidth="0.6" fill="none"/><circle cx="2" cy="2" r="1.4" fill="rgb(212 175 55 / 0.8)"/></svg>
        </span>
        <span className="sigil-corner sigil-corner--br" aria-hidden="true">
          <svg viewBox="0 0 40 40" width="40" height="40"><path d="M38 38 L22 38 M38 38 L38 22 M38 38 L26 26" stroke="rgb(212 175 55 / 0.55)" strokeWidth="0.6" fill="none"/><circle cx="38" cy="38" r="1.4" fill="rgb(212 175 55 / 0.8)"/></svg>
        </span>

        <p className="eyebrow">Space Raiders</p>
        <h1 className="menu-title">
          Hold the
          <em> last </em>
          line
        </h1>
        <p className="menu-copy">
          Survive the void, gather power, and break the final threat.
        </p>

        <div className="almanac-strip" role="group" aria-label="Almanac">
          <div className="almanac-cell">
            <span className="almanac-cell__label">Best Vigil</span>
            <strong className="almanac-cell__value">{best ? formatTime(best.timeSurvived) : '—'}</strong>
          </div>
          <div className="almanac-cell">
            <span className="almanac-cell__label">Tally</span>
            <strong className="almanac-cell__value">{best ? best.kills.toLocaleString() : '—'}</strong>
          </div>
          <div className="almanac-cell">
            <span className="almanac-cell__label">Echelon</span>
            <strong className="almanac-cell__value">{best ? `lv.${best.level}` : '—'}</strong>
          </div>
          {showShards && (
            <div className="almanac-cell almanac-cell--shards" aria-label="Star Shards balance">
              <span className="almanac-cell__label">Shards</span>
              <strong className="almanac-cell__value">
                <span className="almanac-shard-glyph" aria-hidden="true">◆</span>
                {wallet!.shards.toLocaleString()}
              </strong>
            </div>
          )}
        </div>

        {last && (
          <div className="menu-last-run">
            Last run · {formatTime(last.timeSurvived)} · lv.{last.level} · {last.kills} kills
            {last.weaponPath.length > 0 && ` · ${last.weaponPath.slice(0, 3).join(' → ')}`}
          </div>
        )}

        <div className="button-row">
          <button className="primary-button btn--primary-large btn--ritual" type="button" onClick={onStart}>
            <span className="btn-glyph" aria-hidden="true">☉</span>
            <span className="btn-label">Begin Solo Run</span>
            <span className="btn-flourish" aria-hidden="true">→</span>
          </button>
          <div className="button-divider" aria-hidden="true">
            <span>or</span>
          </div>
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
  const headerText = victory ? 'The void breaks' : 'The void claims you';

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
            Earned <strong>+{snapshot.lastRunReward}</strong> Star Shards
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
