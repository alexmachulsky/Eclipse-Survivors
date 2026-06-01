/**
 * Decides whether the React HUD/overlay snapshot should refresh for an incoming
 * server snapshot.
 *
 * The LAN canvas consumes the full 30 Hz snapshot stream (interpolated in its
 * own rAF loop), but re-rendering the React HUD on every snapshot floods the
 * main thread with React work (render + effects + DOM) that competes with the
 * canvas rAF and drops frames. We therefore refresh the HUD on a throttled
 * cadence — except on a phase/local-status transition (level-up, death, end of
 * run), where the overlay must appear immediately.
 */
export interface HudRefreshDecision {
  refresh: boolean;
  /** The throttle key to store (room phase + local player status). */
  key: string;
  /** The throttle timestamp to store (unchanged when not refreshing). */
  time: number;
}

export function shouldRefreshHud(
  prevKey: string | null,
  prevTime: number,
  phase: string,
  localStatus: string | undefined,
  now: number,
  intervalMs: number
): HudRefreshDecision {
  const key = `${phase}:${localStatus ?? ''}`;
  // Force an immediate refresh on any phase/status transition; otherwise hold
  // until the throttle window elapses.
  const refresh = key !== prevKey || now - prevTime >= intervalMs;
  return { refresh, key, time: refresh ? now : prevTime };
}
