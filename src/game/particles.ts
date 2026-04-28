import type { Enemy, Particle, XPGem } from './types';
import { randomBetween, vectorFromAngle } from './collisions';

let particleSequence = 0;
let gemSequence = 0;

function nextParticleId(): string {
  particleSequence += 1;
  return `particle-${particleSequence}`;
}

function nextGemId(): string {
  gemSequence += 1;
  return `gem-${gemSequence}`;
}

export function createDeathParticles(enemy: Enemy, rng: () => number): Particle[] {
  const count = enemy.type === 'boss' ? 48 : enemy.type === 'tank' ? 18 : 10;

  return Array.from({ length: count }, () => {
    const angle = rng() * Math.PI * 2;
    const speed = randomBetween(45, enemy.type === 'boss' ? 280 : 180, rng);

    return {
      id: nextParticleId(),
      position: { ...enemy.position },
      velocity: vectorFromAngle(angle, speed),
      radius: randomBetween(2, enemy.type === 'boss' ? 7 : 5, rng),
      color: enemy.color,
      life: randomBetween(0.35, 0.95, rng),
      maxLife: 0.95
    };
  });
}

export function createXpGem(enemy: Enemy): XPGem {
  const value = enemy.type === 'boss' ? 60 : enemy.xpValue;

  return {
    id: nextGemId(),
    position: { ...enemy.position },
    value,
    radius: enemy.type === 'boss' ? 12 : 6 + Math.min(5, value),
    color: enemy.type === 'boss' ? '#ffd166' : value >= 5 ? '#c084fc' : '#5eead4',
    life: 0
  };
}

export function updateParticles(particles: Particle[], dt: number): Particle[] {
  return particles
    .map((particle) => ({
      ...particle,
      position: {
        x: particle.position.x + particle.velocity.x * dt,
        y: particle.position.y + particle.velocity.y * dt
      },
      velocity: {
        x: particle.velocity.x * 0.94,
        y: particle.velocity.y * 0.94
      },
      life: particle.life - dt
    }))
    .filter((particle) => particle.life > 0);
}
