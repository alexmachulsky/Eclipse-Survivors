import type { GameSnapshot } from '../game/GameEngine';
import type { Weapon } from '../game/types';
import { ClockIcon, HeartIcon, SkullIcon, StarIcon, WeaponIconMap } from './icons';
import { Tooltip } from './Tooltip';
import { useState, useRef, useEffect } from 'react';

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

export function WeaponTile({ weapon, isActive }: { weapon: Weapon; isActive: boolean }) {
  const Icon = WeaponIconMap[weapon.id];
  return (
    <div className={`weapon-tile${weapon.level > 1 ? ' weapon-tile--upgraded' : ''}${isActive ? ' weapon-tile--active' : ''}`}>
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
  const objective = snapshot.activeObjective;
  const objectiveRatio = objective ? Math.max(0, Math.min(1, objective.captureProgress / objective.requiredCapture)) : 0;

  const prevActRef = useRef<string | null>(null);
  const [showActBanner, setShowActBanner] = useState(false);
  const [actBannerText, setActBannerText] = useState('');
  const actTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevActRef.current !== null && prevActRef.current !== snapshot.actLabel) {
      setActBannerText(snapshot.actLabel);
      setShowActBanner(true);
      if (actTimerRef.current) clearTimeout(actTimerRef.current);
      actTimerRef.current = setTimeout(() => setShowActBanner(false), 3000);
    }
    prevActRef.current = snapshot.actLabel;
    return () => {
      if (actTimerRef.current) clearTimeout(actTimerRef.current);
    };
  }, [snapshot.actLabel]);

  const getHealthBarClass = () => {
    if (healthRatio > 0.5) return 'hp-fill--healthy';
    if (healthRatio > 0.25) return 'hp-fill--mid';
    return 'hp-fill--critical';
  };

  return (
    <>
      {showActBanner && (
        <div className="act-banner">
          {actBannerText}
        </div>
      )}
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
          <span className="hud-stat hud-stat--act">
            <strong>{snapshot.actLabel}</strong>
          </span>
          {objective && (
            <span className="objective-alert">
              Rift {Math.round(objectiveRatio * 100)}%
            </span>
          )}
          {snapshot.enemyCurseStacks > 0 && (
            <Tooltip content={<><strong>Curse Stacks</strong>Enemies gain +15% speed and +10% damage per stack. Stacks up when rifts are ignored.</>}>
              <span
                className="curse-alert"
                aria-label={`Curse stacks: ${snapshot.enemyCurseStacks}`}
                style={{
                  textShadow: `0 0 ${4 + snapshot.enemyCurseStacks * 3}px rgba(255,51,95,${Math.min(0.4 + snapshot.enemyCurseStacks * 0.12, 0.9)})`, // --c-danger
                  letterSpacing: '2px'
                }}
              >
                {'☠'.repeat(Math.min(snapshot.enemyCurseStacks, 5))}{snapshot.enemyCurseStacks > 5 && '+'}
              </span>
            </Tooltip>
          )}
          {snapshot.bossApproachingIn !== null && !snapshot.bossSpawned ? (
            <span className={`boss-countdown-badge${snapshot.bossApproachingIn <= 10 ? ' boss-countdown-badge--urgent' : ''}`}>
              ⚠ BOSS IN {Math.ceil(snapshot.bossApproachingIn)}s
            </span>
          ) : snapshot.bossSpawned ? (
            <span className="boss-alert">Boss</span>
          ) : null}
          {snapshot.killStreak >= 3 && (
            <Tooltip content={<><strong>Kill Streak</strong>Consecutive kills within 3 seconds. Higher streaks show above the player.</>}>
              <div className={`streak-badge streak-badge--${snapshot.killStreak >= 10 ? 'gold' : snapshot.killStreak >= 5 ? 'silver' : 'bronze'}`}>
                ×{snapshot.killStreak} 🔥
              </div>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="hud-bottom">
        <div className="hud-bars">
          <div className="hud-bar-row">
            <HeartIcon size={13} color="var(--c-danger)" />
            <div className="meter health-meter" aria-label="Health">
              <span className={getHealthBarClass()} style={{ width: `${healthRatio * 100}%` }} />
              <strong>{Math.ceil(snapshot.health)}</strong>
            </div>
          </div>
          <Tooltip content={<><strong>Experience</strong>{snapshot.xp} / {snapshot.xpToNext} XP · Level {snapshot.level}<br/>Gain XP by killing enemies and completing rifts.</>}>
            <div className="hud-bar-row">
              <StarIcon size={13} color="var(--c-arcane)" />
              <div className="meter xp-meter" aria-label="Experience">
                <span style={{ width: `${xpRatio * 100}%` }} />
                <strong>Lv {snapshot.level}</strong>
              </div>
            </div>
          </Tooltip>
          {snapshot.bossHealthRatio !== null && (
            <div className="hud-bar-row">
              <SkullIcon size={13} color="var(--c-danger)" />
              <div className="meter boss-health-meter" aria-label="Boss health">
                <span style={{ width: `${snapshot.bossHealthRatio * 100}%` }} />
                <strong>Night Lich</strong>
              </div>
            </div>
          )}
        </div>

        {snapshot.weapons.length > 0 && (
          <div className="hud-weapons-row">
            {snapshot.weapons.map((weapon, idx) => (
              <Tooltip key={weapon.id} content={<><strong>{weapon.name}</strong>Level {weapon.level} · {weapon.tags.join(', ')}<br/>Damage: {weapon.damage} · Rate: {weapon.fireRate.toFixed(1)}/s</>}>
                <WeaponTile weapon={weapon} isActive={idx === 0} />
              </Tooltip>
            ))}
          </div>
        )}

        <button className="icon-button" type="button" aria-label="Pause" onClick={onPause}>
          &#x23F8;
        </button>
      </div>
    </>
  );
}
