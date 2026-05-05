import type { GameStats } from './types';

export interface Wallet {
  shards: number;
  lifetimeEarned: number;
}

const KEY = 'eclipse-survivors:wallet';

export function loadWallet(): Wallet {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { shards: 0, lifetimeEarned: 0 };
    const parsed = JSON.parse(raw) as Partial<Wallet>;
    return {
      shards: Number.isFinite(parsed.shards) ? (parsed.shards as number) : 0,
      lifetimeEarned: Number.isFinite(parsed.lifetimeEarned) ? (parsed.lifetimeEarned as number) : 0,
    };
  } catch {
    return { shards: 0, lifetimeEarned: 0 };
  }
}

export function saveWallet(w: Wallet): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    // localStorage unavailable or quota exceeded — silently ignore.
  }
}

export function calculateRunReward(stats: GameStats, won: boolean): number {
  const time = Math.floor(stats.timeSurvived / 10);
  const kills = Math.floor(stats.kills / 20);
  const level = stats.level * 5;
  const winBonus = won ? 200 : 0;
  return time + kills + level + winBonus;
}
