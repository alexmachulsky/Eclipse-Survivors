import { angleTo, vectorFromAngle } from '../collisions';
import type { Enemy, Player, Projectile, Weapon } from '../types';

export interface FireContext {
  weapon: Weapon;
  player: Player;
  target: Enemy;
  rng: () => number;
}

export interface WeaponDef {
  id: string;
  name: string;
  baseFireRate: number;
  baseDamage: number;
  baseRange: number;
  unlockedAtStart: boolean;
  tags: string[];
  evolutionId?: string;
  fire(ctx: FireContext): Projectile[];
}

let projectileSequence = 0;
function nextProjectileId(prefix: string): string {
  projectileSequence += 1;
  return `${prefix}-${projectileSequence}`;
}

function fireMagicBolt({ weapon, player, target }: FireContext): Projectile[] {
  const angle = angleTo(player.position, target.position);
  const levelBonus = Math.max(0, weapon.level - 1);
  const damage = Math.round(weapon.damage * player.damageMultiplier * (1 + levelBonus * 0.3));
  const projectileSpeed = player.projectileSpeedMultiplier;
  const projectileCount = weapon.evolved ? 3 : weapon.level >= 4 ? 2 : 1;

  return Array.from({ length: projectileCount }, (_, index) => {
    const spread = projectileCount === 1 ? 0 : (index - (projectileCount - 1) / 2) * 0.16;

    return {
      id: nextProjectileId('bolt'),
      owner: 'player',
      weaponId: weapon.id,
      kind: 'bolt',
      position: { ...player.position },
      velocity: vectorFromAngle(angle + spread, (weapon.evolved ? 640 : 520) * projectileSpeed),
      radius: 6,
      damage: weapon.evolved ? Math.round(damage * 1.1) : damage,
      life: 1.4,
      maxLife: 1.4,
      pierce: weapon.evolved ? 4 : weapon.level >= 5 ? 2 : 1,
      color: weapon.evolved ? '#d8f6ff' : '#6ee7ff',
      hitIds: new Set<string>(),
    };
  });
}

function firePiercingArrow({ weapon, player, target }: FireContext): Projectile[] {
  const angle = angleTo(player.position, target.position);
  const levelBonus = Math.max(0, weapon.level - 1);
  const damage = Math.round(weapon.damage * player.damageMultiplier * (1 + levelBonus * 0.3));
  const projectileSpeed = player.projectileSpeedMultiplier;
  const projectileCount = weapon.evolved ? 3 : 1;

  return Array.from({ length: projectileCount }, (_, index) => {
    const spread = projectileCount === 1 ? 0 : (index - 1) * 0.18;
    const direction = vectorFromAngle(angle + spread, (weapon.evolved ? 660 : 660) * projectileSpeed);

    return {
      id: nextProjectileId('arrow'),
      owner: 'player',
      weaponId: weapon.id,
      kind: 'arrow',
      position: { ...player.position },
      velocity: direction,
      radius: 5,
      damage: weapon.evolved ? Math.round(damage * 1.2) : damage,
      life: 1.25,
      maxLife: 1.25,
      pierce: weapon.evolved ? 10 : 2 + weapon.level,
      color: '#b8ff6a',
      hitIds: new Set<string>(),
    };
  });
}

export const WEAPONS: Record<string, WeaponDef> = {
  'magic-bolt': {
    id: 'magic-bolt',
    name: 'Magic Bolt',
    baseFireRate: 0.62,
    baseDamage: 16,
    baseRange: 720,
    unlockedAtStart: true,
    tags: ['projectile'],
    evolutionId: 'starfall-lance',
    fire: fireMagicBolt,
  },
  'orbit': {
    id: 'orbit',
    name: 'Astral Orbit',
    baseFireRate: 0,
    baseDamage: 10,
    baseRange: 88,
    unlockedAtStart: false,
    tags: ['orbit', 'area'],
    evolutionId: 'gravitic-halo',
    fire: () => [],
  },
  'area-pulse': {
    id: 'area-pulse',
    name: 'Area Pulse',
    baseFireRate: 3.2,
    baseDamage: 18,
    baseRange: 220,
    unlockedAtStart: false,
    tags: ['area'],
    evolutionId: 'supernova-bloom',
    fire: () => [],
  },
  'piercing-arrow': {
    id: 'piercing-arrow',
    name: 'Piercing Arrow',
    baseFireRate: 1.35,
    baseDamage: 19,
    baseRange: 900,
    unlockedAtStart: false,
    tags: ['projectile'],
    evolutionId: 'comet-volley',
    fire: firePiercingArrow,
  },
};
