import type { Player } from '../types';

export interface PassiveDef {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  apply(player: Player): Player;
}

export const PASSIVES: Record<string, PassiveDef> = {
  'cooldown-sigil': {
    id: 'cooldown-sigil',
    name: 'Cooldown Sigil',
    description: '+8% attack rate per level',
    maxLevel: 5,
    apply: (p) => ({ ...p, attackRateMultiplier: p.attackRateMultiplier * 1.08 }),
  },
  'astral-lens': {
    id: 'astral-lens',
    name: 'Astral Lens',
    description: '+20 pickup radius per level',
    maxLevel: 5,
    apply: (p) => ({ ...p, pickupRadius: p.pickupRadius + 20 }),
  },
  'void-core': {
    id: 'void-core',
    name: 'Void Core',
    description: '+10% area size per level',
    maxLevel: 5,
    apply: (p) => ({ ...p, areaMultiplier: p.areaMultiplier * 1.1 }),
  },
  'keen-fletching': {
    id: 'keen-fletching',
    name: 'Keen Fletching',
    description: '+12% projectile speed per level',
    maxLevel: 5,
    apply: (p) => ({ ...p, projectileSpeedMultiplier: p.projectileSpeedMultiplier * 1.12 }),
  },
};
