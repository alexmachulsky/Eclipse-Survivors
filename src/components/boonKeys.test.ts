import { describe, it, expect } from 'vitest';
import { keyToBoonAction } from './boonKeys';

describe('keyToBoonAction', () => {
  it('maps digit keys to in-range choices', () => {
    expect(keyToBoonAction('Digit1', 3, false)).toEqual({ kind: 'choose', index: 0 });
    expect(keyToBoonAction('Digit2', 3, false)).toEqual({ kind: 'choose', index: 1 });
    expect(keyToBoonAction('Digit3', 3, false)).toEqual({ kind: 'choose', index: 2 });
  });

  it('ignores digits past the number of choices', () => {
    expect(keyToBoonAction('Digit4', 3, false)).toBeNull();
    expect(keyToBoonAction('Digit9', 3, true)).toBeNull();
  });

  it('maps Space to reroll only when rerolling is allowed', () => {
    expect(keyToBoonAction('Space', 3, true)).toEqual({ kind: 'reroll' });
    expect(keyToBoonAction('Space', 3, false)).toBeNull();
  });

  it('ignores unrelated keys', () => {
    expect(keyToBoonAction('KeyA', 3, true)).toBeNull();
    expect(keyToBoonAction('Digit0', 3, true)).toBeNull();
    expect(keyToBoonAction('Enter', 3, true)).toBeNull();
  });
});
