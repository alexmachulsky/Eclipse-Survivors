import type { GameSnapshot } from '../game/GameEngine';
import type { Weapon } from '../game/types';
import { ClockIcon, HeartIcon, SkullIcon, StarIcon, WeaponIconMap } from './icons';

interface HudProps {
  snapshot: GameSnapshot;
  onPause: () => void;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const PIP_COUNT = 8;

export function WeaponTile({ weapon }: { weapon: Weapon }) {
  const Icon = WeaponIconMap[weapon.id];
  return (
    <div className={`weapon-tile${weapon.level > 1 ? ' weapon-tile--upgraded' : ''}`}>
      <Icon size={22} color={weapon.level > 1 ? 'var(--c-rare)' : 'var(--c-common)'} />
      <div className="pip-row">
        {Array.from({ length: PIP_COUNT }, (_, i) => (
          <span key={i} className={`pip${i < weapon.level ? ' pip--filled' : ''}`} />
        ))}
      </div>
    </div>
  );
}

export function Hud({ snapshot, onPause }: HudProps) {
  const healthRatio = Math.max(0, snapshot.health / snapshot.maxHealth);
  const xpRatio = Math.max(0, Math.min(1, snapshot.xp / snapshot.xpToNext));

  return (
    <>
      <div className="hud-top">
        <div className="hud-top-inner">
          <span className="hud-stat">
            <ClockIcon size={14} color="var(--c-common)" />
            <strong>{formatTime(snapshot.elapsed)}</strong>
          </span>
          <span className="hud-stat">
            <SkullIcon size={14} color="#94a3b8" />
            <strong>{snapshot.kills}</strong>
          </span>
          {snapshot.bossSpawned && <span className="boss-alert">Boss</span>}
        </div>
      </div>

      <div className="hud-bottom">
        <div className="hud-bars">
          <div className="hud-bar-row">
            <HeartIcon size={13} color="var(--c-danger)" />
            <div className="meter health-meter" aria-label="Health">
              <span style={{ width: `${healthRatio * 100}%` }} />
              <strong>{Math.ceil(snapshot.health)}</strong>
            </div>
          </div>
          <div className="hud-bar-row">
            <StarIcon size={13} color="var(--c-arcane)" />
            <div className="meter xp-meter" aria-label="Experience">
              <span style={{ width: `${xpRatio * 100}%` }} />
              <strong>Lv {snapshot.level}</strong>
            </div>
          </div>
        </div>

        <div className="hud-weapons-row">
          {snapshot.weapons.map((weapon) => (
            <WeaponTile key={weapon.id} weapon={weapon} />
          ))}
        </div>

        <button className="icon-button" type="button" aria-label="Pause" onClick={onPause}>
          &#x23F8;
        </button>
      </div>
    </>
  );
}
