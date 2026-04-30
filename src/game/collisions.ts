import type { Vector } from './types';

export function normalizeVector(vector: Vector): Vector {
  const length = Math.hypot(vector.x, vector.y);

  if (length === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

export function circlesOverlap(a: Vector, aRadius: number, b: Vector, bRadius: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= aRadius + bRadius;
}

export function circlesOverlapSq(a: Vector, aRadius: number, b: Vector, bRadius: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const radius = aRadius + bRadius;

  return dx * dx + dy * dy <= radius * radius;
}

export function distance(a: Vector, b: Vector): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceSq(a: Vector, b: Vector): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;

  return dx * dx + dy * dy;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function angleTo(from: Vector, to: Vector): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function vectorFromAngle(angle: number, length = 1): Vector {
  return {
    x: Math.cos(angle) * length,
    y: Math.sin(angle) * length
  };
}

export function randomBetween(min: number, max: number, rng: () => number): number {
  return min + (max - min) * rng();
}
