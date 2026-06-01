import { describe, expect, it } from 'vitest';
import { shouldRefreshHud } from './hudThrottle';

const HUD_UPDATE_MS = 80;

/**
 * Simulate the LAN snapshot stream arriving at a steady rate and count how many
 * times the HUD would actually refresh, mirroring App.tsx's per-message gate.
 */
function simulate(snapshotHz: number, seconds: number, phase = 'playing', status = 'active') {
  const stepMs = 1000 / snapshotHz;
  let key: string | null = null;
  let time = 0;
  let refreshes = 0;
  const totalMessages = Math.round(snapshotHz * seconds);
  for (let i = 0; i < totalMessages; i++) {
    const now = i * stepMs;
    const decision = shouldRefreshHud(key, time, phase, status, now, HUD_UPDATE_MS);
    if (decision.refresh) refreshes++;
    key = decision.key;
    time = decision.time;
  }
  return { refreshes, totalMessages };
}

describe('shouldRefreshHud', () => {
  it('throttles a 30 Hz snapshot stream down to ~12 Hz HUD refreshes', () => {
    const { refreshes, totalMessages } = simulate(30, 5);
    expect(totalMessages).toBe(150);
    // With 33.3 ms snapshots and an 80 ms window the HUD refreshes every ~100 ms
    // (every 3rd snapshot) => ~10 Hz: roughly a 3x reduction in React work vs
    // re-rendering on every incoming snapshot.
    const hz = refreshes / 5;
    expect(hz).toBeLessThanOrEqual(11);
    expect(hz).toBeGreaterThanOrEqual(9);
    expect(refreshes).toBeLessThan(totalMessages * 0.5);
  });

  it('refreshes immediately on a phase transition (e.g. lobby -> playing)', () => {
    // Two snapshots 1 ms apart: same window, but the phase changes.
    const first = shouldRefreshHud(null, 0, 'lobby', 'idle', 0, HUD_UPDATE_MS);
    expect(first.refresh).toBe(true);
    const within = shouldRefreshHud(first.key, first.time, 'lobby', 'idle', 1, HUD_UPDATE_MS);
    expect(within.refresh).toBe(false); // throttled: same key, inside window
    const transition = shouldRefreshHud(first.key, first.time, 'playing', 'active', 2, HUD_UPDATE_MS);
    expect(transition.refresh).toBe(true); // forced: phase changed
  });

  it('refreshes immediately when the local player status changes (level-up)', () => {
    const base = shouldRefreshHud(null, 0, 'playing', 'active', 0, HUD_UPDATE_MS);
    // 10 ms later (inside the 80 ms window) the player enters the upgrade menu.
    const levelUp = shouldRefreshHud(base.key, base.time, 'playing', 'choosing', 10, HUD_UPDATE_MS);
    expect(levelUp.refresh).toBe(true);
  });

  it('does not advance the throttle timestamp when it withholds a refresh', () => {
    const base = shouldRefreshHud(null, 0, 'playing', 'active', 0, HUD_UPDATE_MS);
    const held = shouldRefreshHud(base.key, base.time, 'playing', 'active', 40, HUD_UPDATE_MS);
    expect(held.refresh).toBe(false);
    expect(held.time).toBe(base.time); // timestamp preserved so the window is measured from the last refresh
    const due = shouldRefreshHud(held.key, held.time, 'playing', 'active', 80, HUD_UPDATE_MS);
    expect(due.refresh).toBe(true);
  });
});
