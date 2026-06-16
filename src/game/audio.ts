// Procedural Web Audio SFX bus.
//
// Every sound is synthesized from oscillators + gain envelopes — there are NO
// audio asset files, so SFX add zero bytes to the network and never block on a
// fetch. The bus stays completely inert outside a browser (SSR / Vitest's node
// env) because it only ever touches `AudioContext` lazily inside `resume()`,
// which is a no-op when `window`/`AudioContext` is absent.
//
// Design notes:
// - Browsers block audio until a user gesture, so `resume()` must be called from
//   a click/keydown. Until then `play()` is a silent no-op.
// - Per-event cooldowns (see COOLDOWN_MS) keep high-frequency events like `kill`
//   from machine-gunning under a horde; one-shot events (levelUp, boss) never
//   throttle.
// - The snapshot→events mapping (`diffSnapshotForAudio`) and the throttle gate
//   (`gateEvent`) are pure and unit-tested; the actual synthesis needs a real
//   AudioContext and is exercised in the browser.

export type SfxEvent =
  | 'kill'
  | 'hurt'
  | 'levelUp'
  | 'boss'
  | 'lowHealth'
  | 'dashReady'
  | 'chest'
  | 'gameOver'
  | 'victory';

/** Minimum gap between repeats of an event, in ms. 0 = never throttled. */
const COOLDOWN_MS: Record<SfxEvent, number> = {
  kill: 70,
  hurt: 110,
  levelUp: 0,
  boss: 0,
  lowHealth: 600,
  dashReady: 140,
  chest: 0,
  gameOver: 0,
  victory: 0
};

const LOW_HEALTH_RATIO = 0.25;

/** The slice of a game snapshot the audio layer reacts to. */
export interface AudioInputs {
  phase: string;
  health: number;
  maxHealth: number;
  level: number;
  kills: number;
  bossSpawned: boolean;
  dashCharges: number;
}

/**
 * Pure: derive the SFX events implied by the delta between two snapshots.
 * Returns [] when there is no previous snapshot (first frame primes the state).
 */
export function diffSnapshotForAudio(prev: AudioInputs | null, next: AudioInputs): SfxEvent[] {
  if (!prev) return [];

  const events: SfxEvent[] = [];

  if (next.level > prev.level) events.push('levelUp');
  if (next.kills > prev.kills) events.push('kill');
  if (next.health < prev.health && next.health > 0) events.push('hurt');

  const prevRatio = prev.maxHealth > 0 ? prev.health / prev.maxHealth : 1;
  const nextRatio = next.maxHealth > 0 ? next.health / next.maxHealth : 1;
  if (prevRatio >= LOW_HEALTH_RATIO && nextRatio < LOW_HEALTH_RATIO && next.health > 0) {
    events.push('lowHealth');
  }

  if (next.bossSpawned && !prev.bossSpawned) events.push('boss');
  if (next.dashCharges > prev.dashCharges) events.push('dashReady');

  if (prev.phase === 'playing' && next.phase === 'gameOver') events.push('gameOver');
  if (prev.phase === 'playing' && next.phase === 'victory') events.push('victory');

  return events;
}

/**
 * Pure: is `event` allowed to play at `now` (ms)? Mutates `lastPlayed` to record
 * the play time when it passes the cooldown. Extracted so the throttle is
 * testable without an AudioContext.
 */
export function gateEvent(event: SfxEvent, now: number, lastPlayed: Record<string, number>): boolean {
  const cooldown = COOLDOWN_MS[event] ?? 0;
  const last = lastPlayed[event];
  if (last !== undefined && now - last < cooldown) {
    return false;
  }
  lastPlayed[event] = now;
  return true;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private volume = 0.55;
  private readonly lastPlayed: Record<string, number> = {};

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) {
      this.master.gain.value = on ? this.volume : 0;
    }
  }

  setVolume(value: number): void {
    this.volume = clamp01(value);
    if (this.master && this.enabled) {
      this.master.gain.value = this.volume;
    }
  }

  /**
   * Create/resume the AudioContext. MUST be called from a user gesture
   * (browsers suspend audio until then). No-op outside a browser.
   */
  resume(): void {
    if (typeof window === 'undefined') return;

    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  /** Play the SFX for an event (silent until `resume()`, when muted, or throttled). */
  play(event: SfxEvent): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime * 1000;
    if (!gateEvent(event, now, this.lastPlayed)) return;
    this.synth(event);
  }

  /** One oscillator with an attack/decay envelope. */
  private tone(opts: {
    type: OscillatorType;
    from: number;
    to?: number;
    duration: number;
    gain?: number;
    delay?: number;
  }): void {
    if (!this.ctx || !this.master) return;
    const { type, from, to = from, duration, gain = 0.3, delay = 0 } = opts;
    const t0 = this.ctx.currentTime + delay;

    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
    }

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.012, duration * 0.4));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(env);
    env.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  private synth(event: SfxEvent): void {
    switch (event) {
      case 'kill':
        this.tone({ type: 'square', from: 660, to: 880, duration: 0.06, gain: 0.16 });
        break;
      case 'hurt':
        this.tone({ type: 'sawtooth', from: 240, to: 90, duration: 0.16, gain: 0.28 });
        break;
      case 'levelUp':
        this.tone({ type: 'sine', from: 523, duration: 0.1, gain: 0.3 });
        this.tone({ type: 'sine', from: 659, duration: 0.1, gain: 0.3, delay: 0.08 });
        this.tone({ type: 'sine', from: 784, duration: 0.16, gain: 0.32, delay: 0.16 });
        break;
      case 'boss':
        this.tone({ type: 'sine', from: 70, to: 55, duration: 0.6, gain: 0.4 });
        this.tone({ type: 'sawtooth', from: 110, to: 88, duration: 0.6, gain: 0.12 });
        break;
      case 'lowHealth':
        this.tone({ type: 'triangle', from: 440, duration: 0.12, gain: 0.26 });
        this.tone({ type: 'triangle', from: 440, duration: 0.12, gain: 0.26, delay: 0.18 });
        break;
      case 'dashReady':
        this.tone({ type: 'triangle', from: 520, to: 920, duration: 0.09, gain: 0.18 });
        break;
      case 'chest':
        this.tone({ type: 'sine', from: 784, duration: 0.12, gain: 0.28 });
        this.tone({ type: 'sine', from: 1175, duration: 0.16, gain: 0.26, delay: 0.06 });
        break;
      case 'gameOver':
        this.tone({ type: 'sawtooth', from: 330, to: 110, duration: 0.7, gain: 0.32 });
        break;
      case 'victory':
        this.tone({ type: 'square', from: 523, duration: 0.12, gain: 0.26 });
        this.tone({ type: 'square', from: 659, duration: 0.12, gain: 0.26, delay: 0.12 });
        this.tone({ type: 'square', from: 784, duration: 0.12, gain: 0.26, delay: 0.24 });
        this.tone({ type: 'square', from: 1047, duration: 0.3, gain: 0.3, delay: 0.36 });
        break;
    }
  }
}

/** Shared singleton used across the app. */
export const audioBus = new AudioBus();

/** Map a full game snapshot to the slice the audio layer needs. */
export function toAudioInputs(snapshot: {
  phase: string;
  health: number;
  maxHealth: number;
  level: number;
  kills: number;
  bossSpawned: boolean;
  dash: { charges: number };
}): AudioInputs {
  return {
    phase: snapshot.phase,
    health: snapshot.health,
    maxHealth: snapshot.maxHealth,
    level: snapshot.level,
    kills: snapshot.kills,
    bossSpawned: snapshot.bossSpawned,
    dashCharges: snapshot.dash.charges
  };
}
