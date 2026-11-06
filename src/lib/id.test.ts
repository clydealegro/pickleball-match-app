import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './id';

afterEach(() => vi.unstubAllGlobals());

describe('newId', () => {
  it('is unique across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });

  it('builds a v4 UUID from getRandomValues when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const ids = Array.from({ length: 50 }, () => newId());
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(ids).size).toBe(50);
  });

  it('still returns an id with no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newId()).not.toBe('');
  });
});
