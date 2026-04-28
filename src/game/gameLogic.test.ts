import { describe, expect, it } from 'vitest';
import { circlesOverlap, normalizeVector } from './collisions';
import { updatePlayerMovement } from './player';
import { spawnEnemyOutsideViewport, scaleEnemyStats } from './enemies';
import { applyUpgrade, createUpgradeChoices, getXpThreshold } from './upgrades';
import { createStartingPlayer, createStartingWeapons } from './state';
import { fireWeaponAtTarget } from './weapons';
import { resolveProjectileEnemyHit } from './projectiles';
import type { Enemy, Projectile, Viewport, Weapon } from './types';

describe('core game logic', () => {
  it('normalizes diagonal player movement so it is not faster than straight movement', () => {
    const player = createStartingPlayer({ x: 500, y: 500 });

    const straight = updatePlayerMovement(player, { up: true, down: false, left: false, right: false }, 1, {
      width: 1000,
      height: 1000
    });
    const diagonal = updatePlayerMovement(player, { up: true, down: false, left: false, right: true }, 1, {
      width: 1000,
      height: 1000
    });

    const straightDistance = Math.hypot(straight.position.x - 500, straight.position.y - 500);
    const diagonalDistance = Math.hypot(diagonal.position.x - 500, diagonal.position.y - 500);

    expect(diagonalDistance).toBeCloseTo(straightDistance, 4);
  });

  it('spawns enemies outside the active viewport and scales them by difficulty tier', () => {
    const viewport: Viewport = { x: 100, y: 100, width: 800, height: 600 };
    const enemy = spawnEnemyOutsideViewport('tank', viewport, 3, () => 0.25);

    expect(enemy.position.x < viewport.x || enemy.position.x > viewport.x + viewport.width || enemy.position.y < viewport.y || enemy.position.y > viewport.y + viewport.height).toBe(true);

    const base = scaleEnemyStats('basic', 0);
    const scaled = scaleEnemyStats('basic', 4);

    expect(scaled.maxHealth).toBeGreaterThan(base.maxHealth);
    expect(scaled.damage).toBeGreaterThan(base.damage);
  });

  it('builds upgrade choices from locked weapons and stat upgrades, then applies them', () => {
    const player = createStartingPlayer({ x: 0, y: 0 });
    const weapons = createStartingWeapons();
    const choices = createUpgradeChoices(player, weapons, () => 0.8);

    expect(choices).toHaveLength(3);
    expect(choices.some((choice) => choice.kind === 'weapon')).toBe(true);

    const weaponChoice = choices.find((choice) => choice.kind === 'weapon');
    expect(weaponChoice).toBeDefined();

    const upgraded = applyUpgrade(player, weapons, weaponChoice!);
    expect(upgraded.weapons.some((weapon) => weapon.id === weaponChoice!.weaponId)).toBe(true);
  });

  it('creates aimed weapon projectiles with damage and piercing behavior', () => {
    const player = createStartingPlayer({ x: 100, y: 100 });
    const target: Enemy = {
      id: 'target',
      type: 'basic',
      position: { x: 200, y: 100 },
      velocity: { x: 0, y: 0 },
      radius: 18,
      maxHealth: 24,
      health: 24,
      speed: 60,
      damage: 8,
      xpValue: 2,
      color: '#fff',
      cooldown: 0,
      hitFlash: 0
    };
    const piercingArrow: Weapon = {
      id: 'piercing-arrow',
      name: 'Piercing Arrow',
      level: 2,
      cooldown: 0,
      fireRate: 1.2,
      damage: 18,
      range: 800,
      unlocked: true
    };

    const projectiles = fireWeaponAtTarget(piercingArrow, player, target);

    expect(projectiles).toHaveLength(1);
    expect(projectiles[0].velocity.x).toBeGreaterThan(0);
    expect(projectiles[0].pierce).toBeGreaterThan(1);
  });

  it('resolves projectile hits by damaging enemies and consuming pierce count', () => {
    const enemy: Enemy = {
      id: 'enemy',
      type: 'basic',
      position: { x: 50, y: 50 },
      velocity: { x: 0, y: 0 },
      radius: 16,
      maxHealth: 20,
      health: 20,
      speed: 80,
      damage: 8,
      xpValue: 1,
      color: '#fff',
      cooldown: 0,
      hitFlash: 0
    };
    const projectile: Projectile = {
      id: 'projectile',
      owner: 'player',
      kind: 'bolt',
      position: { x: 50, y: 50 },
      velocity: { x: 0, y: 0 },
      radius: 6,
      damage: 12,
      life: 1,
      maxLife: 1,
      pierce: 1,
      color: '#fff'
    };

    const result = resolveProjectileEnemyHit(projectile, enemy);

    expect(result.enemy.health).toBe(8);
    expect(result.projectile.pierce).toBe(0);
    expect(result.damageText.amount).toBe(12);
  });

  it('keeps collision and XP threshold helpers deterministic', () => {
    expect(normalizeVector({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(circlesOverlap({ x: 0, y: 0 }, 10, { x: 15, y: 0 }, 6)).toBe(true);
    expect(getXpThreshold(5)).toBeGreaterThan(getXpThreshold(1));
  });
});
