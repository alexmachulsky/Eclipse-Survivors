import { useEffect, useState } from 'react';
import type { UpgradeOption } from '../game/types';
import { StarIcon, StatIconMap, WeaponIconMap, LockIcon, UnlockIcon, RerollIcon, BanishIcon } from './icons';
import { useFocusTrap } from './useFocusTrap';
import { keyToBoonAction } from './boonKeys';

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

type BoonRarity = 'common' | 'rare' | 'epic' | 'legendary';

const RARITY_HEX: Record<BoonRarity, string> = {
  common: '#9fb0c3',
  rare: '#4aa8ff',
  epic: '#b57bff',
  legendary: '#ffc24d',
};

const RARITY_LABEL: Record<BoonRarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

// Evolutions are the pinnacle, so they read as legendary gold regardless of the
// raw `rarity` field; everything else uses its rarity (weapons default to rare).
function cardRarity(choice: UpgradeOption): BoonRarity {
  if (choice.kind === 'evolution') return 'legendary';
  if (choice.rarity) return choice.rarity as BoonRarity;
  return choice.kind === 'weapon' ? 'rare' : 'common';
}

function kindLabel(choice: UpgradeOption): string {
  switch (choice.kind) {
    case 'evolution': return 'Evolution';
    case 'weapon': return 'Weapon';
    case 'passive': return 'Passive';
    case 'synergy': return 'Synergy';
    default: return 'Stat';
  }
}

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
  const rarity = cardRarity(choice);
  const color = RARITY_HEX[rarity];
  const Icon = isWeapon
    ? (choice.weaponId ? WeaponIconMap[choice.weaponId] : null)
    : choice.kind === 'passive' || choice.kind === 'synergy'
      ? StarIcon
      : (choice.stat ? StatIconMap[choice.stat] : null);

  const meta = choice.kind === 'evolution'
    ? 'Weapon evolution'
    : choice.kind === 'weapon' && choice.currentWeaponLevel !== undefined
      ? `Lv ${choice.currentWeaponLevel} → ${choice.currentWeaponLevel + 1}`
      : null;

  const pipFill = choice.kind === 'evolution' ? PIP_COUNT : (choice.currentWeaponLevel ?? 1);

  const handleClick = () => {
    if (banishMode && onBanish && !isLocked) {
      onBanish(index);
      return;
    }
    onChoose(choice.id);
  };

  return (
    <button
      className={`boon-card boon-card--${rarity}${choice.kind === 'evolution' ? ' boon-card--evolution' : ''}${isLocked ? ' is-locked' : ''}${banishMode && !isLocked ? ' is-banish' : ''}`}
      style={{ ['--i' as string]: index } as React.CSSProperties}
      type="button"
      onClick={handleClick}
    >
      <span className="boon-card__top" />
      <span className="boon-card__key">{index + 1}</span>

      {onLock && (
        <button
          className="boon-card__lock"
          aria-label={isLocked ? 'Unlock card' : 'Lock card'}
          onClick={(e) => { e.stopPropagation(); onLock(index); }}
          type="button"
        >
          {isLocked ? <LockIcon size={14} color="currentColor" /> : <UnlockIcon size={14} color="currentColor" />}
        </button>
      )}

      <span className="boon-card__ribbon">{RARITY_LABEL[rarity]} · {kindLabel(choice)}</span>

      {Icon && (
        <span className="boon-card__icon">
          <Icon size={36} color={color} />
        </span>
      )}

      <strong className="boon-card__title">{choice.title}</strong>
      {meta && <span className="boon-card__meta">{meta}</span>}
      <small className="boon-card__desc">{choice.description}</small>
      {choice.statDelta && <span className="boon-card__delta">{choice.statDelta}</span>}

      {isWeapon && (
        <div className="boon-card__pips">
          {Array.from({ length: PIP_COUNT }, (_, i) => (
            <span key={i} className={`pip${i < pipFill ? ' pip--filled' : ''}`} />
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
  const trapRef = useFocusTrap<HTMLDivElement>();
  const canReroll = !!(onReroll && agency && agency.rerolls > 0);

  useEffect(() => {
    setBanishMode(false);
  }, [choices]);

  // Keyboard QoL: 1..N choose, Space rerolls. Suspended while picking a banish target.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (banishMode) return;
      const action = keyToBoonAction(event.code, choices.length, canReroll);
      if (!action) return;
      event.preventDefault();
      if (action.kind === 'reroll') {
        onReroll?.();
      } else {
        onChoose(choices[action.index].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choices, canReroll, banishMode, onChoose, onReroll]);

  const handleBanishClick = () => {
    if (!agency || agency.banishes <= 0) return;
    setBanishMode((v) => !v);
  };

  const handleBanishCard = (index: number) => {
    if (onBanish) onBanish(index);
    setBanishMode(false);
  };

  return (
    <div className="overlay overlay--boon">
      <div
        className="boon-modal"
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${label}: ${title}`}
        tabIndex={-1}
      >
        <p className="boon-eyebrow">{label}</p>
        <h2 className="boon-heading">{title}</h2>

        <div className="upgrade-grid boon-grid">
          {choices.map((choice, i) => (
            <BoonCard
              key={choice.id}
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
          <div className="boon-actions">
            <button
              type="button"
              className="boon-action"
              disabled={agency.rerolls <= 0}
              onClick={onReroll}
            >
              <RerollIcon size={14} color="currentColor" />
              Reroll <span className="boon-action__count">{agency.rerolls}</span>
            </button>
            <button
              type="button"
              className={`boon-action${banishMode ? ' is-active' : ''}`}
              disabled={agency.banishes <= 0}
              onClick={handleBanishClick}
            >
              <BanishIcon size={14} color="currentColor" />
              {banishMode ? 'Pick a card' : <>Banish <span className="boon-action__count">{agency.banishes}</span></>}
            </button>
            <span className="boon-action boon-action--info">
              <LockIcon size={14} color="currentColor" />
              Locks <span className="boon-action__count">{agency.locks}</span>
            </span>
          </div>
        )}

        <p className="boon-hint">
          Press <kbd>1</kbd>–<kbd>{choices.length}</kbd> to choose
          {canReroll ? <> · <kbd>Space</kbd> to reroll</> : null}
        </p>
      </div>
    </div>
  );
}
