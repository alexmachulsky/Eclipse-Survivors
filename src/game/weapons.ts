import type { Enemy, Player, Projectile, Weapon } from './types';
import { angleTo, vectorFromAngle } from './collisions';

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
  const angle = angleTo(player.position, target.position);
  const levelBonus = Math.max(0, weapon.level - 1);
  const damage = Math.round(weapon.damage * player.damageMultiplier * (1 + levelBonus * 0.3));
  const projectileSpeed = player.projectileSpeedMultiplier;

  if (weapon.id === 'piercing-arrow') {
    const projectileCount = weapon.evolved ? 3 : 1;

    return Array.from({ length: projectileCount }, (_, index) => {
      const spread = projectileCount === 1 ? 0 : (index - 1) * 0.18;
      const direction = vectorFromAngle(angle + spread, (weapon.evolved ? 660 : 660) * projectileSpeed);

      return {
        id: nextProjectileId('arrow'),
        owner: 'player',
        kind: 'arrow',
        position: { ...player.position },
        velocity: direction,
        radius: 5,
        damage: weapon.evolved ? Math.round(damage * 1.2) : damage,
        life: 1.25,
        maxLife: 1.25,
        pierce: weapon.evolved ? 10 : 2 + weapon.level,
        color: '#b8ff6a',
        hitIds: new Set<string>()
      };
    });
  }

  if (weapon.id === 'magic-bolt') {
    const projectileCount = weapon.evolved ? 3 : weapon.level >= 4 ? 2 : 1;

    return Array.from({ length: projectileCount }, (_, index) => {
      const spread = projectileCount === 1 ? 0 : (index - (projectileCount - 1) / 2) * 0.16;

      return {
        id: nextProjectileId('bolt'),
        owner: 'player',
        kind: 'bolt',
        position: { ...player.position },
        velocity: vectorFromAngle(angle + spread, (weapon.evolved ? 640 : 520) * projectileSpeed),
        radius: 6,
        damage: weapon.evolved ? Math.round(damage * 1.1) : damage,
        life: 1.4,
        maxLife: 1.4,
        pierce: weapon.evolved ? 4 : weapon.level >= 5 ? 2 : 1,
        color: weapon.evolved ? '#d8f6ff' : '#6ee7ff',
        hitIds: new Set<string>()
      };
    });
  }

  return [];
}

export function createAreaPulse(weapon: Weapon, player: Player): Projectile {
  const maxRadius = (weapon.range + weapon.level * 26) * player.areaMultiplier * (weapon.evolved ? 1.15 : 1);
  const life = weapon.evolved ? 2.15 : 0.75;

  return {
    id: nextProjectileId('pulse'),
    owner: 'player',
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
