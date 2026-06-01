import type { GameStats } from './types';

export interface Wallet {
  shards: number;
  lifetimeEarned: number;
}

const KEY = 'eclipse-survivors:wallet';

// Coerce a stored value to a safe, non-negative number. Guards against NaN,
// Infinity, non-numbers and negative balances injected via edited localStorage.
function sanitizeAmount(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

export function loadWallet(): Wallet {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { shards: 0, lifetimeEarned: 0 };
    const parsed = JSON.parse(raw) as Partial<Wallet>;
    return {
      shards: sanitizeAmount(parsed.shards),
      lifetimeEarned: sanitizeAmount(parsed.lifetimeEarned),
    };
  } catch {
    return { shards: 0, lifetimeEarned: 0 };
  }
}

export function saveWallet(w: Wallet): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch (err) {
    // localStorage unavailable or quota exceeded. Warn rather than swallow so a
    // lost reward is at least diagnosable instead of vanishing silently.
    console.warn('[wallet] failed to persist wallet; reward may not be saved', err);
  }
}

export function calculateRunReward(stats: GameStats, won: boolean): number {
  const time = Math.floor(stats.timeSurvived / 10);
  const kills = Math.floor(stats.kills / 20);
  const level = stats.level * 5;
  const winBonus = won ? 200 : 0;
  return time + kills + level + winBonus;
}

// Credit a finished run's reward into the persistent wallet and return the
// amount earned. Shared by the solo engine (GameEngine.creditWallet) and the
// LAN client (App.tsx) so both modes feed the same shard ledger.
export function creditRunReward(stats: GameStats, won: boolean): number {
  const reward = calculateRunReward(stats, won);
  const wallet = loadWallet();
  saveWallet({
    shards: wallet.shards + reward,
    lifetimeEarned: wallet.lifetimeEarned + reward,
  });
  return reward;
}
