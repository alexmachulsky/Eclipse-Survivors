import type { DamageText, Enemy, Projectile } from './types';

export function resolveProjectileEnemyHit(projectile: Projectile, enemy: Enemy): { projectile: Projectile; enemy: Enemy; damageText: DamageText } {
  const damage = Math.round(projectile.damage);
  const nextProjectile = {
    ...projectile,
    pierce: Math.max(0, projectile.pierce - 1)
  };
  const nextEnemy = {
    ...enemy,
    health: Math.max(0, enemy.health - damage),
    hitFlash: 0.12
  };

  return {
    projectile: nextProjectile,
    enemy: nextEnemy,
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

export function updateProjectiles(projectiles: Projectile[], dt: number): Projectile[] {
  return projectiles
    .map((projectile) => {
      const life = projectile.life - dt;
      const radius =
        projectile.kind === 'pulse' && projectile.maxRadius
          ? projectile.radius + (projectile.maxRadius / projectile.maxLife) * dt
          : projectile.radius;

      return {
        ...projectile,
        position: {
          x: projectile.position.x + projectile.velocity.x * dt,
          y: projectile.position.y + projectile.velocity.y * dt
        },
        radius: Math.min(projectile.maxRadius ?? radius, radius),
        life,
        alpha: projectile.kind === 'pulse' ? Math.max(0, life / projectile.maxLife) : projectile.alpha
      };
    })
    .filter((projectile) => projectile.life > 0 && projectile.pierce > 0);
}
