import type { GameStats } from './types';

export interface Wallet {
  shards: number;
  lifetimeEarned: number;
}

const KEY = 'eclipse-survivors:wallet';

// SECURITY / TRUST BOUNDARY: this wallet is purely LOCAL, client-side cosmetic
// progression. It is never sent to or trusted by the multiplayer server, so a
// player editing localStorage only inflates their own offline shard count — no
// impact on other players or server state. If shards ever gate gameplay,
// cosmetics, accounts, or anything multiplayer-visible, the ledger MUST move
// server-side. Until then we only sanitize on load to keep the UI/state sane.
const MAX_AMOUNT = 1_000_000_000; // clamp tampered/corrupted values to a sane ceiling

// Coerce a stored value to a safe, non-negative, capped number. Guards against
// NaN, Infinity, non-numbers, negative and absurdly large balances injected via
// edited localStorage.
function sanitizeAmount(value: unknown): number {
  return Number.isFinite(value) ? Math.min(MAX_AMOUNT, Math.max(0, value as number)) : 0;
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
