import { describe, it, expect } from 'vitest';
import { diffSnapshotForAudio, gateEvent, type AudioInputs, type SfxEvent } from './audio';

const base: AudioInputs = {
  phase: 'playing',
  health: 100,
  maxHealth: 100,
  level: 1,
  kills: 0,
  bossSpawned: false,
  dashCharges: 1
};

function next(overrides: Partial<AudioInputs>): AudioInputs {
  return { ...base, ...overrides };
}

describe('diffSnapshotForAudio', () => {
  it('emits nothing on the first frame (no previous snapshot)', () => {
    expect(diffSnapshotForAudio(null, base)).toEqual([]);
  });

  it('emits levelUp when level increases', () => {
    expect(diffSnapshotForAudio(base, next({ level: 2 }))).toContain('levelUp');
  });

  it('emits kill when the kill count rises', () => {
    expect(diffSnapshotForAudio(base, next({ kills: 3 }))).toContain('kill');
  });

  it('emits hurt only when health drops and the player survives', () => {
    expect(diffSnapshotForAudio(base, next({ health: 80 }))).toContain('hurt');
    expect(diffSnapshotForAudio(base, next({ health: 0 }))).not.toContain('hurt');
    expect(diffSnapshotForAudio(base, next({ health: 120 }))).not.toContain('hurt');
  });

  it('emits lowHealth once when crossing below 25%', () => {
    const crossing = diffSnapshotForAudio(next({ health: 30 }), next({ health: 20 }));
    expect(crossing).toContain('lowHealth');
    // Already below the threshold → no repeat.
    const staying = diffSnapshotForAudio(next({ health: 20 }), next({ health: 15 }));
    expect(staying).not.toContain('lowHealth');
  });

  it('emits boss only on the false→true transition', () => {
    expect(diffSnapshotForAudio(base, next({ bossSpawned: true }))).toContain('boss');
    expect(diffSnapshotForAudio(next({ bossSpawned: true }), next({ bossSpawned: true }))).not.toContain('boss');
  });

  it('emits dashReady when a dash charge is regained', () => {
    expect(diffSnapshotForAudio(next({ dashCharges: 0 }), next({ dashCharges: 1 }))).toContain('dashReady');
  });

  it('emits gameOver / victory on the run-ending phase transition', () => {
    expect(diffSnapshotForAudio(base, next({ phase: 'gameOver' }))).toContain('gameOver');
    expect(diffSnapshotForAudio(base, next({ phase: 'victory' }))).toContain('victory');
  });
});

describe('gateEvent', () => {
  it('throttles a high-frequency event within its cooldown window', () => {
    const last: Record<string, number> = {};
    expect(gateEvent('kill', 1000, last)).toBe(true);
    expect(gateEvent('kill', 1040, last)).toBe(false); // < 70ms cooldown
    expect(gateEvent('kill', 1100, last)).toBe(true); // window elapsed
  });

  it('never throttles zero-cooldown one-shots', () => {
    const last: Record<string, number> = {};
    const oneShots: SfxEvent[] = ['levelUp', 'boss', 'gameOver', 'victory', 'chest'];
    for (const event of oneShots) {
      expect(gateEvent(event, 5000, last)).toBe(true);
      expect(gateEvent(event, 5000, last)).toBe(true);
    }
  });
});
