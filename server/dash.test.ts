import { describe, it, expect } from 'vitest';
import { GameSim } from '../src/game/GameSim';
import type { Enemy, PlayerCommand } from '../src/game/types';

function baseCommand(playerId: string, overrides: Partial<PlayerCommand> = {}): PlayerCommand {
  return {
    type: 'command',
    playerId,
    seq: 0,
    moveUp: false,
    moveDown: false,
    moveLeft: false,
    moveRight: false,
    aimWorldX: 1700,
    aimWorldY: 1200,
    reviveHeld: false,
    dashHeld: false,
    ...overrides
  };
}

function makeEnemy(id: string, x: number, y: number): Enemy {
  return {
    id,
    type: 'basic',
    rank: 'normal',
    position: { x, y },
    velocity: { x: 0, y: 0 },
    radius: 14,
    maxHealth: 22,
    health: 22,
    speed: 0,
    damage: 6,
    xpValue: 1,
    color: '#abc',
    cooldown: 0,
    hitFlash: 0
  };
}

function makeSim(): { sim: GameSim; playerId: string } {
  const sim = new GameSim(() => 0.5); // deterministic RNG
  const runtime = sim.addPlayer('Tester', 'p1');
  sim.startRun();
  return { sim, playerId: runtime.id };
}

describe('LAN dash', () => {
  it('server applies a valid dash command (player moves toward aim)', () => {
    const { sim, playerId } = makeSim();
    const startPos = sim.getState().players[0].player.position.x;
    sim.applyCommand(baseCommand(playerId, { dashHeld: true, aimWorldX: 5000, aimWorldY: 1200 }));
    sim.update(0.05);
    const endPos = sim.getState().players[0].player.position.x;
    expect(endPos).toBeGreaterThan(startPos);
  });

  it('server rejects dash when no charges left (movement is unchanged on extra dash attempt)', () => {
    const { sim, playerId } = makeSim();
    // Directly modify player state to have 0 charges (simulating exhausted state)
    const player = sim.getState().players[0].player;
    player.dash.charges = 0;
    player.dash.active = false;
    player.dash.queued = false;

    const beforePos = sim.getState().players[0].player.position.x;
    sim.applyCommand(baseCommand(playerId, { dashHeld: true, aimWorldX: 5000, aimWorldY: 1200 }));
    sim.update(0.05);
    const afterPos = sim.getState().players[0].player.position.x;
    // With 0 charges, dash does not start. Position only advanced by normal movement (no WASD held = no movement).
    expect(afterPos).toBe(beforePos);
  });

  it('server rejects dash when phase is not playing', () => {
    const sim = new GameSim(() => 0.5);
    const runtime = sim.addPlayer('Tester', 'p1');
    // Do NOT call startRun — phase stays 'menu' and the player is 'disconnected' or similar
    const startPos = sim.getState().players[0].player.position.x;
    sim.applyCommand(baseCommand(runtime.id, { dashHeld: true, aimWorldX: 5000, aimWorldY: 1200 }));
    sim.update(0.10);
    const endPos = sim.getState().players[0].player.position.x;
    expect(endPos).toBe(startPos);
  });

  it('server applies dash damage authoritatively to enemies in path', () => {
    const { sim, playerId } = makeSim();
    // Verify player is active
    const playerRuntime = sim.getState().players[0];
    expect(playerRuntime.status).toBe('active');

    // Inject an enemy close enough to be hit by the first dash tick
    // Player starts at (1600, 1200), moves 61px/tick at 1220 px/s
    // Enemy reach = player.radius * 0.5 + enemy.radius = 8 + 14 = 22
    // Place enemy at (1650, 1200) - within reach after first tick
    const state = sim.getState();
    state.enemies.push(makeEnemy('test-enemy', 1650, 1200));
    const initialHealth = state.enemies[0].health;
    const initialPlayerX = playerRuntime.player.position.x;

    // Dash toward +X (the player starts at 1600,1200)
    sim.applyCommand(baseCommand(playerId, { dashHeld: true, aimWorldX: 2000, aimWorldY: 1200 }));

    // Run one update to trigger dash start and hit
    sim.update(0.05);

    const playerX = state.players[0].player.position.x;
    // First verify that the dash caused movement
    expect(playerX).toBeGreaterThan(initialPlayerX);

    // Check if enemy took damage
    const finalEnemy = state.enemies[0];
    // With DASH_CONFIG.baseDamage = 28 and default multiplier = 1, damage should be 28
    // So health should go from 22 to max(0, 22 - 28) = 0
    // Either the enemy health dropped or enemy was removed
    expect(finalEnemy.health < initialHealth || state.enemies.length === 0).toBe(true);
  });
});
