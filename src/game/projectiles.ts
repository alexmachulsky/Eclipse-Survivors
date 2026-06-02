import type { DamageText, Enemy, Projectile } from './types';

export function resolveProjectileEnemyHit(projectile: Projectile, enemy: Enemy): { projectile: Projectile; enemy: Enemy; damageText: DamageText } {
  const damage = Math.round(projectile.damage);
  projectile.pierce = Math.max(0, projectile.pierce - 1);
  enemy.health = Math.max(0, enemy.health - damage);
  enemy.hitFlash = 0.12;

  return {
    projectile,
    enemy,
    damageText: {
      id: `damage-${projectile.id}-${enemy.id}`,
      position: { x: enemy.position.x, y: enemy.position.y - enemy.radius - 6 },
      velocity: { x: 0, y: -36 },
      amount: damage,
      life: 0.55,
      maxLife: 0.55,
      color: projectile.kind === 'arrow' ? '#caff74' : '#bdf6ff'
    }
  };
}

// `enemies` is optional — pass it for the player projectile list so 'missile'
// projectiles can steer toward the nearest enemy. Enemy projectiles never home,
// so the enemy list is simply omitted there.
export function updateProjectiles(projectiles: Projectile[], dt: number, enemies?: Enemy[]): Projectile[] {
  let writeIndex = 0;

  for (let index = 0; index < projectiles.length; index += 1) {
    const projectile = projectiles[index];

    if (projectile.homingTurnRate && enemies && enemies.length > 0) {
      steerTowardNearest(projectile, enemies, dt);
    }

    const life = projectile.life - dt;
    const radius =
      projectile.kind === 'pulse' && projectile.maxRadius
        ? projectile.radius + (projectile.maxRadius / projectile.maxLife) * dt
        : projectile.radius;

    projectile.position.x += projectile.velocity.x * dt;
    projectile.position.y += projectile.velocity.y * dt;
    projectile.radius = Math.min(projectile.maxRadius ?? radius, radius);
    projectile.life = life;

    if (projectile.kind === 'pulse') {
      projectile.alpha = Math.max(0, life / projectile.maxLife);
    }

    if (projectile.life > 0 && projectile.pierce > 0) {
      projectiles[writeIndex] = projectile;
      writeIndex += 1;
    }
  }

  projectiles.length = writeIndex;
  return projectiles;
}

// Rotate a homing projectile's velocity toward the nearest enemy by at most
// homingTurnRate·dt this frame, preserving its speed. Pure: reads enemy
// positions, mutates only the projectile's velocity. Squared distance for the
// nearest-enemy scan, one sqrt for the speed (per the hot-path rules).
function steerTowardNearest(projectile: Projectile, enemies: Enemy[], dt: number): void {
  let nearest: Enemy | null = null;
  let bestSq = Infinity;
  for (const enemy of enemies) {
    const dx = enemy.position.x - projectile.position.x;
    const dy = enemy.position.y - projectile.position.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestSq) {
      bestSq = distSq;
      nearest = enemy;
    }
  }
  if (!nearest) {
    return;
  }

  const speed = Math.sqrt(projectile.velocity.x * projectile.velocity.x + projectile.velocity.y * projectile.velocity.y) || 1;
  const desired = Math.atan2(nearest.position.y - projectile.position.y, nearest.position.x - projectile.position.x);
  const current = Math.atan2(projectile.velocity.y, projectile.velocity.x);

  let diff = desired - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  const maxTurn = (projectile.homingTurnRate ?? 0) * dt;
  const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
  const next = current + turn;

  projectile.velocity.x = Math.cos(next) * speed;
  projectile.velocity.y = Math.sin(next) * speed;
}
