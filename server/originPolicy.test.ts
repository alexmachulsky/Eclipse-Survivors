import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from './index';

describe('websocket origin policy', () => {
  it('does not allow attacker-controlled dns names implicitly', () => {
    expect(isAllowedOrigin('http://attacker.test', [])).toBe(false);
  });

  it('allows explicit configured origins', () => {
    expect(isAllowedOrigin('https://game.example', ['https://game.example'])).toBe(true);
  });

  it('allows local network browser origins without trusting request Host', () => {
    expect(isAllowedOrigin('http://localhost:5176', [])).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5176', [])).toBe(true);
    expect(isAllowedOrigin('http://192.168.1.42:5176', [])).toBe(true);
  });

  it('rejects missing or malformed origins', () => {
    expect(isAllowedOrigin(undefined, [])).toBe(false);
    expect(isAllowedOrigin('not an origin', [])).toBe(false);
  });

  it('refuses the local-network fallback when it is disabled', () => {
    // Strict mode (allowLocalNetwork=false) must not silently re-widen an
    // explicit allowlist back out to every loopback/RFC1918 origin.
    expect(isAllowedOrigin('http://192.168.1.42:5176', [], false)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5176', [], false)).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:5176', [], false)).toBe(false);
  });

  it('still honors explicit origins in strict mode', () => {
    expect(isAllowedOrigin('https://game.example', ['https://game.example'], false)).toBe(true);
  });
});
