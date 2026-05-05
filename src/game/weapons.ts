import type { Enemy, Player, Projectile, Weapon } from './types';
import { vectorFromAngle } from './collisions';
import { WEAPONS } from './content/weapons.registry';

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
  let nearestDistanceSq = range * range;

  for (const enemy of enemies) {
    const dx = position.x - enemy.position.x;
    const dy = position.y - enemy.position.y;
    const currentDistanceSq = dx * dx + dy * dy;

    if (currentDistanceSq <= nearestDistanceSq) {
      nearest = enemy;
      nearestDistanceSq = currentDistanceSq;
    }
  }

  return nearest;
}

export function fireWeaponAtTarget(weapon: Weapon, player: Player, target: Enemy): Projectile[] {
  const def = WEAPONS[weapon.id];
  if (!def) return [];
  return def.fire({ weapon, player, target, rng: Math.random });
}

export function createAreaPulse(weapon: Weapon, player: Player): Projectile {
  const maxRadius = (weapon.range + weapon.level * 26) * player.areaMultiplier * (weapon.evolved ? 1.15 : 1);
  const life = weapon.evolved ? 2.15 : 0.75;

  return {
    id: nextProjectileId('pulse'),
    owner: 'player',
    weaponId: weapon.id,
    kind: 'pulse',
    position: { ...player.position },
    velocity: { x: 0, y: 0 },
    radius: 28,
    maxRadius,
    damage: Math.round(weapon.damage * player.damageMultiplier * (1 + Math.max(0, weapon.level - 1) * 0.28)),
    life,
    maxLife: life,
    pierce: 999,
    color: weapon.evolved ? '#f0abfc' : '#c084fc',
    alpha: 0.8,
    hitIds: new Set<string>()
  };
}

export function createStarfallSparks(projectile: Projectile, enemy: Enemy): Projectile[] {
  if (projectile.kind !== 'bolt' || projectile.color !== '#d8f6ff') {
    return [];
  }

  const baseAngle = Math.atan2(projectile.velocity.y, projectile.velocity.x);

  return [-0.85, 0.85].map((offset) => ({
    id: nextProjectileId('spark'),
    owner: 'player',
    kind: 'bolt',
    position: { ...enemy.position },
    velocity: vectorFromAngle(baseAngle + offset, 360),
    radius: 4,
    damage: Math.max(4, Math.round(projectile.damage * 0.42)),
    life: 0.34,
    maxLife: 0.34,
    pierce: 1,
    color: '#fff3b0',
    hitIds: new Set<string>([enemy.id])
  }));
}
