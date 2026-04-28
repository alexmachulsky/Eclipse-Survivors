import type { Enemy, EnemyType, Viewport } from './types';
import { angleTo, normalizeVector, randomBetween, vectorFromAngle } from './collisions';

const ENEMY_BLUEPRINTS: Record<EnemyType, Omit<Enemy, 'id' | 'position' | 'velocity' | 'cooldown' | 'hitFlash' | 'health'>> = {
  basic: {
    type: 'basic',
    radius: 17,
    maxHealth: 22,
    speed: 68,
    damage: 6,
    xpValue: 2,
    color: '#7cf7ff'
  },
  fast: {
    type: 'fast',
    radius: 12,
    maxHealth: 12,
    speed: 132,
    damage: 5,
    xpValue: 1,
    color: '#ff5edb'
  },
  tank: {
    type: 'tank',
    radius: 25,
    maxHealth: 72,
    speed: 42,
    damage: 11,
    xpValue: 5,
    color: '#a78bfa'
  },
  ranged: {
    type: 'ranged',
    radius: 18,
    maxHealth: 34,
    speed: 56,
    damage: 8,
    xpValue: 4,
    color: '#ffd166'
  },
  boss: {
    type: 'boss',
    radius: 54,
    maxHealth: 1800,
    speed: 34,
    damage: 18,
    xpValue: 40,
    color: '#ff335f'
  }
};

export function scaleEnemyStats(type: EnemyType, _difficultyTier: number): Omit<Enemy, 'id' | 'position' | 'velocity' | 'cooldown' | 'hitFlash'> {
  const difficultyTier = Math.max(0, _difficultyTier);
  const blueprint = ENEMY_BLUEPRINTS[type];
  const healthScale = type === 'boss' ? 1 + difficultyTier * 0.1 : 1 + difficultyTier * 0.28;
  const damageScale = type === 'boss' ? 1 + difficultyTier * 0.06 : 1 + difficultyTier * 0.16;
  const speedScale = type === 'boss' ? 1 : 1 + Math.min(0.45, difficultyTier * 0.035);
  const maxHealth = Math.round(blueprint.maxHealth * healthScale);

  return {
    ...blueprint,
    maxHealth,
    health: maxHealth,
    speed: Math.round(blueprint.speed * speedScale),
    damage: Math.round(blueprint.damage * damageScale),
    xpValue: Math.round(blueprint.xpValue * (1 + difficultyTier * 0.08))
  };
}

export function spawnEnemyOutsideViewport(type: EnemyType, viewport: Viewport, difficultyTier: number, rng: () => number): Enemy {
  const stats = scaleEnemyStats(type, difficultyTier);
  const side = Math.floor(rng() * 4);
  const margin = 90 + stats.radius;
  let position = { x: 0, y: 0 };

  if (side === 0) {
    position = { x: randomBetween(viewport.x, viewport.x + viewport.width, rng), y: viewport.y - margin };
  } else if (side === 1) {
    position = { x: viewport.x + viewport.width + margin, y: randomBetween(viewport.y, viewport.y + viewport.height, rng) };
  } else if (side === 2) {
    position = { x: randomBetween(viewport.x, viewport.x + viewport.width, rng), y: viewport.y + viewport.height + margin };
  } else {
    position = { x: viewport.x - margin, y: randomBetween(viewport.y, viewport.y + viewport.height, rng) };
  }

  return {
    ...stats,
    id: `${type}-${Math.floor(rng() * 1_000_000_000)}`,
    position,
    velocity: { x: 0, y: 0 },
    cooldown: type === 'ranged' ? randomBetween(0.4, 1.6, rng) : 0,
    hitFlash: 0
  };
}

export function chooseEnemyType(elapsed: number, difficultyTier: number, rng: () => number): EnemyType {
  const roll = rng();

  if (elapsed > 70 && roll < Math.min(0.16, 0.04 + difficultyTier * 0.015)) {
    return 'ranged';
  }

  if (elapsed > 45 && roll < Math.min(0.3, 0.08 + difficultyTier * 0.018)) {
    return 'tank';
  }

  if (elapsed > 20 && roll < Math.min(0.46, 0.16 + difficultyTier * 0.02)) {
    return 'fast';
  }

  return 'basic';
}

export function updateEnemies(enemies: Enemy[], playerPosition: { x: number; y: number }, dt: number): Enemy[] {
  return enemies.map((enemy) => {
    const toPlayer = normalizeVector({
      x: playerPosition.x - enemy.position.x,
      y: playerPosition.y - enemy.position.y
    });
    const distanceToPlayer = Math.hypot(playerPosition.x - enemy.position.x, playerPosition.y - enemy.position.y);
    const shouldKite = enemy.type === 'ranged' && distanceToPlayer < 280;
    const direction = shouldKite ? { x: -toPlayer.x, y: -toPlayer.y } : toPlayer;
    const speed = enemy.type === 'boss' && distanceToPlayer < 180 ? enemy.speed * 0.55 : enemy.speed;

    return {
      ...enemy,
      position: {
        x: enemy.position.x + direction.x * speed * dt,
        y: enemy.position.y + direction.y * speed * dt
      },
      velocity: { x: direction.x * speed, y: direction.y * speed },
      cooldown: Math.max(0, enemy.cooldown - dt),
      hitFlash: Math.max(0, enemy.hitFlash - dt)
    };
  });
}

export function getBossSpawn(viewport: Viewport, difficultyTier: number): Enemy {
  const stats = scaleEnemyStats('boss', difficultyTier);
  const position = {
    x: viewport.x + viewport.width + 180,
    y: viewport.y + viewport.height * 0.5
  };

  return {
    ...stats,
    id: 'boss-night-lich',
    position,
    velocity: vectorFromAngle(angleTo(position, { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 }), stats.speed),
    cooldown: 1.2,
    hitFlash: 0
  };
}
