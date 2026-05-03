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

export function loadRunHistory(): RunHistory {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { best: null, last: null };
    return JSON.parse(raw) as RunHistory;
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
  } catch {
    // localStorage unavailable — silently ignore
  }
}
