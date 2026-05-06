import type { MovementInput, Player, Vector } from './types';
import { clamp, normalizeVector } from './collisions';

export function updatePlayerMovement(player: Player, input: MovementInput, dt: number, bounds: { width: number; height: number }): Player {
  const direction = normalizeVector({
    x: Number(input.right) - Number(input.left),
    y: Number(input.down) - Number(input.up)
  });

  const nextPosition = {
    x: clamp(player.position.x + direction.x * player.speed * dt, player.radius, bounds.width - player.radius),
    y: clamp(player.position.y + direction.y * player.speed * dt, player.radius, bounds.height - player.radius)
  };

  return {
    ...player,
    position: nextPosition,
    invulnerableTimer: Math.max(0, player.invulnerableTimer - dt)
  };
}

export function setPlayerFacing(player: Player, target: Vector): Player {
  return {
    ...player,
    facingAngle: Math.atan2(target.y - player.position.y, target.x - player.position.x)
  };
}

export function damagePlayer(player: Player, amount: number): { player: Player; tookDamage: boolean } {
  if (player.invulnerableTimer > 0 || player.health <= 0 || player.dash.invulnRemaining > 0) {
    return { player, tookDamage: false };
  }

  return {
    player: {
      ...player,
      health: Math.max(0, player.health - amount),
      invulnerableTimer: 0.9
    },
    tookDamage: true
  };
}
