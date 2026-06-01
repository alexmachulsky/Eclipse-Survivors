export interface RunRecord {
  timeSurvived: number;   // seconds
  kills: number;
  level: number;
  damageDealt: number;
  weaponPath: string[];   // weapon upgrade titles only (filtered from upgradeHistory)
}

export interface RunHistory {
  best: RunRecord | null;  // best by timeSurvived
  last: RunRecord | null;
}

const KEY = 'eclipse-survivors:run-history';

// Validate a parsed value really is a RunRecord before trusting it. Without
// this, a schema change (or corrupted save) would deserialize into malformed
// objects and break the best/last summary screen with no error.
function isRunRecord(value: unknown): value is RunRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    Number.isFinite(r.timeSurvived) &&
    Number.isFinite(r.kills) &&
    Number.isFinite(r.level) &&
    Number.isFinite(r.damageDealt) &&
    Array.isArray(r.weaponPath) &&
    r.weaponPath.every((entry) => typeof entry === 'string')
  );
}

export function loadRunHistory(): RunHistory {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { best: null, last: null };
    const parsed = JSON.parse(raw) as Partial<RunHistory>;
    return {
      best: isRunRecord(parsed.best) ? parsed.best : null,
      last: isRunRecord(parsed.last) ? parsed.last : null,
    };
  } catch {
    return { best: null, last: null };
  }
}

export function saveRunRecord(record: RunRecord): void {
  try {
    const history = loadRunHistory();
    const isBetter = !history.best || record.timeSurvived > history.best.timeSurvived;
    const next: RunHistory = {
      best: isBetter ? record : history.best,
      last: record,
    };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('[persistence] failed to persist run history', err);
  }
}
