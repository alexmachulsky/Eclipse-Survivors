import { clamp, distance, randomBetween, vectorFromAngle } from './collisions';
import { ELITE_SCHEDULE, OBJECTIVE_SCHEDULE, RUN_LENGTH_SECONDS } from './content';
import type { ArenaBounds, ObjectiveState, RunDirectorState, Vector } from './types';

export type RunDirectorEvent =
  | { type: 'elite'; scheduledAt: number }
  | { type: 'objective'; scheduledAt: number }
  | { type: 'boss'; scheduledAt: number };

export function createRunDirectorState(): RunDirectorState {
  return {
    spawnedElites: [],
    spawnedObjectives: [],
    bossSpawned: false
  };
}

export function getActLabel(elapsed: number): string {
  if (elapsed < 210) {
    return 'Act 1';
  }

  if (elapsed < 480) {
    return 'Act 2';
  }

  if (elapsed < RUN_LENGTH_SECONDS) {
    return 'Act 3';
  }

  return 'Finale';
}

function crossesTime(previousElapsed: number, elapsed: number, scheduledAt: number): boolean {
  return previousElapsed < scheduledAt && elapsed >= scheduledAt;
}

export function collectRunDirectorEvents(director: RunDirectorState, previousElapsed: number, elapsed: number): RunDirectorEvent[] {
  const events: RunDirectorEvent[] = [];

  for (const scheduledAt of ELITE_SCHEDULE) {
    if (!director.spawnedElites.includes(scheduledAt) && crossesTime(previousElapsed, elapsed, scheduledAt)) {
      director.spawnedElites.push(scheduledAt);
      events.push({ type: 'elite', scheduledAt });
    }
  }

  for (const scheduledAt of OBJECTIVE_SCHEDULE) {
    if (!director.spawnedObjectives.includes(scheduledAt) && crossesTime(previousElapsed, elapsed, scheduledAt)) {
      director.spawnedObjectives.push(scheduledAt);
      events.push({ type: 'objective', scheduledAt });
    }
  }

  if (!director.bossSpawned && crossesTime(previousElapsed, elapsed, RUN_LENGTH_SECONDS)) {
    director.bossSpawned = true;
    events.push({ type: 'boss', scheduledAt: RUN_LENGTH_SECONDS });
  }

  return events;
}

export function createRiftObjective(id: string, playerPosition: Vector, arena: ArenaBounds, elapsed: number, rng: () => number): ObjectiveState {
  const angle = rng() * Math.PI * 2;
  const offset = vectorFromAngle(angle, randomBetween(350, 650, rng));

  return {
    id,
    position: {
      x: clamp(playerPosition.x + offset.x, 90, arena.width - 90),
      y: clamp(playerPosition.y + offset.y, 90, arena.height - 90)
    },
    radius: 72,
    spawnedAt: elapsed,
    captureProgress: 0,
    requiredCapture: 15,
    ignoreAfter: 45,
    state: 'active'
  };
}

export function updateObjectiveProgress(
  objectives: ObjectiveState[],
  playerPosition: Vector,
  dt: number
): { objectives: ObjectiveState[]; completedIds: string[]; cursedIds: string[] } {
  const completedIds: string[] = [];
  const cursedIds: string[] = [];

  for (const objective of objectives) {
    if (objective.state !== 'active') {
      continue;
    }

    const inside = distance(playerPosition, objective.position) <= objective.radius;

    if (inside) {
      objective.captureProgress = Math.min(objective.requiredCapture, objective.captureProgress + dt);
    } else if (objective.captureProgress <= 0) {
      objective.ignoreAfter -= dt;
    }

    if (objective.captureProgress >= objective.requiredCapture) {
      objective.state = 'completed';
      completedIds.push(objective.id);
    } else if (objective.ignoreAfter <= 0) {
      objective.state = 'cursed';
      cursedIds.push(objective.id);
    }
  }

  return { objectives, completedIds, cursedIds };
}

export function getBossPhase(healthRatio: number): 1 | 2 | 3 {
  if (healthRatio > 0.66) {
    return 1;
  }

  if (healthRatio > 0.33) {
    return 2;
  }

  return 3;
}
