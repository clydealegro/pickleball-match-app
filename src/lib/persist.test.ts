import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage } from './persist';

function stubStorage(storage: unknown) {
  vi.stubGlobal('navigator', { ...navigator, storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestPersistentStorage', () => {
  it('asks the browser to protect storage, and says whether it did', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when storage is already protected', async () => {
    const persist = vi.fn();
    stubStorage({ persisted: vi.fn().mockResolvedValue(true), persist });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('reports false when the browser says no', async () => {
    stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(false) });
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('does nothing where the browser has no such call', async () => {
    stubStorage(undefined);
    expect(await requestPersistentStorage()).toBe(false);
    stubStorage({});
    expect(await requestPersistentStorage()).toBe(false);
  });

  it('never throws', async () => {
    stubStorage({ persisted: vi.fn().mockRejectedValue(new Error('boom')), persist: vi.fn() });
    expect(await requestPersistentStorage()).toBe(false);
  });
});
