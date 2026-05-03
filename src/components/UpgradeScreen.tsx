import type { UpgradeOption } from '../game/types';
import { StarIcon, StatIconMap, WeaponIconMap } from './icons';

interface UpgradeScreenProps {
  choices: UpgradeOption[];
  label?: string;
  title?: string;
  onChoose: (upgradeId: string) => void;
}

const PIP_COUNT = 8;

function BoonCard({ choice, index, onChoose }: { choice: UpgradeOption; index: number; onChoose: (id: string) => void }) {
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

  return (
    <button
      className={`upgrade-card upgrade-card--${kindClass} ${rarityClass} ${evolutionClass}`.trim()}
      style={{ '--idx': index } as React.CSSProperties}
      type="button"
      onClick={() => onChoose(choice.id)}
    >
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

export function UpgradeScreen({ choices, label = 'Level Up', title = 'Choose a boon', onChoose }: UpgradeScreenProps) {
  return (
    <div className="overlay">
      <div className="panel upgrade-panel">
        <p className="eyebrow">{label}</p>
        <h2>{title}</h2>
        <div className="upgrade-grid">
          {choices.map((choice, i) => (
            <BoonCard key={choice.id} choice={choice} index={i} onChoose={onChoose} />
          ))}
        </div>
      </div>
    </div>
  );
}
