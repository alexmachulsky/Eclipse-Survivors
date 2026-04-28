import type { Enemy, Player, Projectile, Weapon } from './types';
import { angleTo, distance, vectorFromAngle } from './collisions';

let projectileSequence = 0;

function nextProjectileId(prefix: string): string {
  projectileSequence += 1;
  return `${prefix}-${projectileSequence}`;
}

export function getUnlockedWeapons(weapons: Weapon[]): Weapon[] {
  return weapons.filter((weapon) => weapon.unlocked && weapon.level > 0);
}

export function findNearestEnemy(enemies: Enemy[], position: { x: number; y: number }, range = Infinity): Enemy | undefined {
  let nearest: Enemy | undefined;
  let nearestDistance = range;

  for (const enemy of enemies) {
    const currentDistance = distance(position, enemy.position);

    if (currentDistance <= nearestDistance) {
      nearest = enemy;
      nearestDistance = currentDistance;
    }
  }

  return nearest;
}

export function fireWeaponAtTarget(weapon: Weapon, player: Player, target: Enemy): Projectile[] {
  const angle = angleTo(player.position, target.position);
  const levelBonus = Math.max(0, weapon.level - 1);
  const damage = Math.round(weapon.damage * player.damageMultiplier * (1 + levelBonus * 0.3));

  if (weapon.id === 'piercing-arrow') {
    const direction = vectorFromAngle(angle, 660);

    return [
      {
        id: nextProjectileId('arrow'),
        owner: 'player',
        kind: 'arrow',
        position: { ...player.position },
        velocity: direction,
        radius: 5,
        damage,
        life: 1.25,
        maxLife: 1.25,
        pierce: 2 + weapon.level,
        color: '#b8ff6a',
        hitIds: new Set<string>()
      }
    ];
  }

  if (weapon.id === 'magic-bolt') {
    const projectileCount = weapon.level >= 4 ? 2 : 1;

    return Array.from({ length: projectileCount }, (_, index) => {
      const spread = projectileCount === 1 ? 0 : (index - 0.5) * 0.18;

      return {
        id: nextProjectileId('bolt'),
        owner: 'player',
        kind: 'bolt',
        position: { ...player.position },
        velocity: vectorFromAngle(angle + spread, 520),
        radius: 6,
        damage,
        life: 1.4,
        maxLife: 1.4,
        pierce: weapon.level >= 5 ? 2 : 1,
        color: '#6ee7ff',
        hitIds: new Set<string>()
      };
    });
  }

  return [];
}

export function createAreaPulse(weapon: Weapon, player: Player): Projectile {
  return {
    id: nextProjectileId('pulse'),
    owner: 'player',
    kind: 'pulse',
    position: { ...player.position },
    velocity: { x: 0, y: 0 },
    radius: 28,
    maxRadius: weapon.range + weapon.level * 26,
    damage: Math.round(weapon.damage * player.damageMultiplier * (1 + Math.max(0, weapon.level - 1) * 0.28)),
    life: 0.75,
    maxLife: 0.75,
    pierce: 999,
    color: '#c084fc',
    alpha: 0.8,
    hitIds: new Set<string>()
  };
}
