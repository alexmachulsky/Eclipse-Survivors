import type { UpgradeOption } from '../game/types';
import { StatIconMap, WeaponIconMap } from './icons';

interface UpgradeScreenProps {
  choices: UpgradeOption[];
  onChoose: (upgradeId: string) => void;
}

const PIP_COUNT = 8;

function BoonCard({ choice, index, onChoose }: { choice: UpgradeOption; index: number; onChoose: (id: string) => void }) {
  const isWeapon = choice.kind === 'weapon';
  const Icon = isWeapon
    ? (choice.weaponId ? WeaponIconMap[choice.weaponId] : null)
    : (choice.stat ? StatIconMap[choice.stat] : null);

  const currentLevel = isWeapon && choice.weaponId ? 1 : 0;

  return (
    <button
      className={`upgrade-card upgrade-card--${isWeapon ? 'weapon' : 'stat'}`}
      style={{ '--idx': index } as React.CSSProperties}
      type="button"
      onClick={() => onChoose(choice.id)}
    >
      <span className="boon-tag">{isWeapon ? 'Boon' : 'Stat'}</span>

      {Icon && (
        <div className="boon-icon">
          <Icon size={40} color={isWeapon ? 'var(--c-rare)' : 'var(--c-common)'} />
        </div>
      )}

      <strong className="boon-title">{choice.title}</strong>
      <small className="boon-desc">{choice.description}</small>

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

export function UpgradeScreen({ choices, onChoose }: UpgradeScreenProps) {
  return (
    <div className="overlay">
      <div className="panel upgrade-panel">
        <p className="eyebrow">Level Up</p>
        <h2>Choose a boon</h2>
        <div className="upgrade-grid">
          {choices.map((choice, i) => (
            <BoonCard key={choice.id} choice={choice} index={i} onChoose={onChoose} />
          ))}
        </div>
      </div>
    </div>
  );
}
