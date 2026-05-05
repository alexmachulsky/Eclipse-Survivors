import type { GameSnapshot } from '../game/GameEngine';
import type { Weapon } from '../game/types';
import { ClockIcon, HeartIcon, SkullIcon, WeaponIconMap } from './icons';
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
  const isMax = weapon.level >= PIP_COUNT;
  return (
    <div className={`weapon-tile${weapon.level > 1 ? ' weapon-tile--upgraded' : ''}${isActive ? ' weapon-tile--active' : ''}${isMax ? ' weapon-tile--max' : ''}`}>
      {weapon.level > 1 && <span className="weapon-tile-level">{weapon.level}</span>}
      <Icon size={24} color={weapon.level > 1 ? 'var(--c-rare)' : 'var(--c-common)'} />
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

      {snapshot.bossHealthRatio !== null && (
        <div className="boss-banner">
          <div className="boss-banner-label">
            <SkullIcon size={14} color="var(--c-danger)" />
            <span>Night Lich</span>
          </div>
          <div className="meter boss-health-meter" aria-label="Boss health">
            <span style={{ width: `${snapshot.bossHealthRatio * 100}%` }} />
            <strong>{Math.round(snapshot.bossHealthRatio * 100)}%</strong>
          </div>
        </div>
      )}

      <div className="hud-top">
        <div className="hud-top-inner">
          <Tooltip content={<><strong>Run Time</strong>Survive 12 minutes (720s) to defeat the eclipse.</>}>
            <span className="hud-stat hud-stat--time">
              <ClockIcon size={15} color="var(--c-common)" />
              <strong>{formatTime(snapshot.elapsed)}</strong>
            </span>
          </Tooltip>
          <span className="hud-stat">
            <SkullIcon size={15} color="#cbd5e1" />
            <strong>{snapshot.kills}</strong>
          </span>
          <span className="hud-stat hud-stat--act" aria-label={`Phase: ${snapshot.actLabel}`}>
            <span className="hud-act-dot" />
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
                  textShadow: `0 0 ${4 + snapshot.enemyCurseStacks * 3}px rgba(255,51,95,${Math.min(0.4 + snapshot.enemyCurseStacks * 0.12, 0.9)})`,
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

      <button className="icon-button hud-pause-button" type="button" aria-label="Pause" onClick={onPause}>
        &#x23F8;
      </button>

      <div className="hud-bottom">
        <div className="player-frame">
          <div className="player-frame-bars">
            <Tooltip content={<><strong>Health</strong>{Math.ceil(snapshot.health)} / {Math.round(snapshot.maxHealth)} HP<br/>Pick up hearts to restore health.</>}>
              <div className="hud-bar-row hud-bar-row--hp">
                <HeartIcon size={15} color="var(--c-danger)" />
                <div className="meter health-meter" aria-label="Health">
                  <span className={getHealthBarClass()} style={{ width: `${healthRatio * 100}%` }} />
                  <strong>
                    <em>{Math.ceil(snapshot.health)}</em>
                    <span className="meter-divider">/</span>
                    <span className="meter-max">{Math.round(snapshot.maxHealth)}</span>
                  </strong>
                </div>
              </div>
            </Tooltip>
            <Tooltip content={<><strong>Experience</strong>{snapshot.xp} / {snapshot.xpToNext} XP · Level {snapshot.level}<br/>Gain XP by killing enemies and completing rifts.</>}>
              <div className="hud-bar-row hud-bar-row--xp">
                <span className="level-chip" aria-label={`Level ${snapshot.level}`}>{snapshot.level}</span>
                <div className="meter xp-meter" aria-label="Experience">
                  <span style={{ width: `${xpRatio * 100}%` }} />
                  <strong>
                    <em>{snapshot.xp}</em>
                    <span className="meter-divider">/</span>
                    <span className="meter-max">{snapshot.xpToNext}</span>
                    <span className="meter-suffix">XP</span>
                  </strong>
                </div>
              </div>
            </Tooltip>
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
        </div>
      </div>
    </>
  );
}
