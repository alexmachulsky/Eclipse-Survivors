import { useEffect, useState } from 'react';
import type { UpgradeOption } from '../game/types';
import { StarIcon, StatIconMap, WeaponIconMap } from './icons';

interface UpgradeScreenProps {
  choices: UpgradeOption[];
  label?: string;
  title?: string;
  onChoose: (upgradeId: string) => void;
  agency?: { rerolls: number; banishes: number; locks: number };
  lockedSlot?: number | null;
  onReroll?: () => void;
  onBanish?: (index: number) => void;
  onLock?: (index: number) => void;
}

const PIP_COUNT = 8;

function BoonCard({
  choice, index, isLocked, banishMode, onChoose, onLock, onBanish,
}: {
  choice: UpgradeOption;
  index: number;
  isLocked: boolean;
  banishMode: boolean;
  onChoose: (id: string) => void;
  onLock?: (index: number) => void;
  onBanish?: (index: number) => void;
}) {
  const isWeapon = choice.kind === 'weapon' || choice.kind === 'evolution';
  const Icon = isWeapon
    ? (choice.weaponId ? WeaponIconMap[choice.weaponId] : null)
    : choice.kind === 'passive'
      ? StarIcon
      : (choice.stat ? StatIconMap[choice.stat] : null);

  const currentLevel = isWeapon && choice.weaponId ? 1 : 0;
  const tag = choice.kind === 'evolution' ? 'Evolution' : choice.kind === 'passive' ? 'Passive' : isWeapon ? 'Boon' : 'Stat';

  const kindClass = choice.kind === 'evolution' ? 'evolution' : isWeapon ? 'weapon' : choice.kind === 'passive' ? 'passive' : 'stat';
  const rarityClass = choice.rarity ? `card--${choice.rarity}` : '';
  const evolutionClass = choice.kind === 'evolution' ? 'card--evolution' : '';
  const lockClass = isLocked ? 'upgrade-card--locked' : '';
  const banishClass = banishMode && !isLocked ? 'upgrade-card--banish-target' : '';

  const handleClick = () => {
    if (banishMode && onBanish && !isLocked) {
      onBanish(index);
      return;
    }
    onChoose(choice.id);
  };

  return (
    <button
      className={`upgrade-card upgrade-card--${kindClass} ${rarityClass} ${evolutionClass} ${lockClass} ${banishClass}`.trim()}
      style={{ '--idx': index } as React.CSSProperties}
      type="button"
      onClick={handleClick}
    >
      {onLock && (
        <span
          className="upgrade-card__lock"
          role="button"
          aria-label={isLocked ? 'Unlock card' : 'Lock card'}
          onClick={(e) => { e.stopPropagation(); onLock(index); }}
        >
          {isLocked ? '🔒' : '🔓'}
        </span>
      )}

      <span className="boon-tag">{tag}</span>

      {Icon && (
        <div className="boon-icon">
          <Icon size={40} color={isWeapon ? 'var(--c-rare)' : 'var(--c-common)'} />
        </div>
      )}

      <strong className="boon-title">{choice.title}</strong>
      {choice.kind === 'weapon' && choice.currentWeaponLevel !== undefined && (
        <div className="upgrade-card__level">lv.{choice.currentWeaponLevel} → {choice.currentWeaponLevel + 1}</div>
      )}
      <small className="boon-desc">{choice.description}</small>
      {choice.statDelta && (
        <div className="upgrade-card__delta">{choice.statDelta}</div>
      )}

      {isWeapon && (
        <div className="boon-pips">
          {Array.from({ length: PIP_COUNT }, (_, i) => (
            <span key={i} className={`pip${i < currentLevel ? ' pip--filled' : ''}`} />
          ))}
        </div>
      )}
    </button>
  );
}

export function UpgradeScreen({
  choices, label = 'Level Up', title = 'Choose a boon', onChoose,
  agency, lockedSlot = null, onReroll, onBanish, onLock,
}: UpgradeScreenProps) {
  const [banishMode, setBanishMode] = useState(false);

  useEffect(() => {
    setBanishMode(false);
  }, [choices]);

  const handleBanishClick = () => {
    if (!agency || agency.banishes <= 0) return;
    setBanishMode((v) => !v);
  };

  const handleBanishCard = (index: number) => {
    if (onBanish) onBanish(index);
    setBanishMode(false);
  };

  return (
    <div className="overlay">
      <div className="panel upgrade-panel">
        <p className="eyebrow">{label}</p>
        <h2>{title}</h2>
        <div className="upgrade-grid">
          {choices.map((choice, i) => (
            <BoonCard
              key={`${i}-${choice.id}`}
              choice={choice}
              index={i}
              isLocked={lockedSlot === i}
              banishMode={banishMode}
              onChoose={onChoose}
              onLock={onLock}
              onBanish={handleBanishCard}
            />
          ))}
        </div>
        {agency && (
          <div className="upgrade-actions">
            <button
              type="button"
              className="upgrade-action"
              disabled={agency.rerolls <= 0}
              onClick={onReroll}
            >
              ↻ Reroll ({agency.rerolls})
            </button>
            <button
              type="button"
              className={`upgrade-action ${banishMode ? 'upgrade-action--active' : ''}`}
              disabled={agency.banishes <= 0}
              onClick={handleBanishClick}
            >
              ✖ {banishMode ? 'Pick card' : `Banish (${agency.banishes})`}
            </button>
            <span className="upgrade-action upgrade-action--info">
              🔒 Locks left: {agency.locks}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
