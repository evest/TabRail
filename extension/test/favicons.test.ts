import { describe, expect, it } from 'vitest';
import { FaviconCache } from '../src/background/favicons';

describe('FaviconCache', () => {
  it('caches per host and skips non-http pages', async () => {
    let calls = 0;
    const c = new FaviconCache(async (u) => {
      calls++;
      return u.includes('invalid') ? 'GLOBE' : `icon:${new URL(u).host}`;
    });
    expect(await c.ensure('https://a.example/x')).toBe(true);
    expect(await c.ensure('https://a.example/y')).toBe(false);
    expect(await c.ensure('chrome://settings')).toBe(false);
    expect(c.get('a.example')).toBe('icon:a.example');
    expect(calls).toBe(2); // default-icon probe + a.example
  });

  it('never caches the default globe and retries after a cooldown', async () => {
    let now = 0;
    let known = false;
    const c = new FaviconCache(
      async (u) => (u.includes('invalid') || !known ? 'GLOBE' : 'REAL'),
      () => now,
    );
    expect(await c.ensure('https://b.example/')).toBe(false);
    known = true;
    expect(await c.ensure('https://b.example/')).toBe(false); // still cooling down
    now = 61_000;
    expect(await c.ensure('https://b.example/')).toBe(true);
    expect(c.get('b.example')).toBe('REAL');
  });
});
