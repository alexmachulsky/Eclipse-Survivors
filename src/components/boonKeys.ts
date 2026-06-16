// Pure keyboard mapping for the level-up / boon screen, extracted so it can be
// unit-tested without rendering React. 1..9 pick a visible choice; Space rerolls
// (solo only — gated by `canReroll`).
export type BoonKeyAction = { kind: 'choose'; index: number } | { kind: 'reroll' };

export function keyToBoonAction(
  code: string,
  choiceCount: number,
  canReroll: boolean
): BoonKeyAction | null {
  if (code === 'Space') {
    return canReroll ? { kind: 'reroll' } : null;
  }
  const match = /^Digit([1-9])$/.exec(code);
  if (match) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < choiceCount) {
      return { kind: 'choose', index };
    }
  }
  return null;
}
