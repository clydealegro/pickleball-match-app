import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from './useWakeLock';

type Sentinel = { released: boolean; release: ReturnType<typeof vi.fn> };
let sentinels: Sentinel[];
let request: ReturnType<typeof vi.fn>;

function stubWakeLock(impl?: () => Promise<Sentinel>) {
  request = vi.fn(
    impl ??
      (async () => {
        const s: Sentinel = {
          released: false,
          release: vi.fn(async () => {
            s.released = true;
          }),
        };
        sentinels.push(s);
        return s;
      }),
  );
  vi.stubGlobal('navigator', { wakeLock: { request } });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  sentinels = [];
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useWakeLock', () => {
  it('asks for one screen lock while active, and lets it go when it stops being active', async () => {
    stubWakeLock();
    const { rerender, unmount } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: true } });
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');
    rerender({ on: false });
    await act(async () => {});
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    unmount();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing while inactive', async () => {
    stubWakeLock();
    renderHook(() => useWakeLock(false));
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
  });

  it('asks again when the page comes back after the browser dropped the lock', async () => {
    stubWakeLock();
    renderHook(() => useWakeLock(true));
    await act(async () => {});
    sentinels[0].released = true; // the browser drops it when the page is hidden
    act(() => setVisibility('hidden'));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1); // not asked while hidden
    act(() => setVisibility('visible'));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not ask twice while it still holds a lock', async () => {
    stubWakeLock();
    renderHook(() => useWakeLock(true));
    await act(async () => {});
    act(() => setVisibility('visible'));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('releases a lock that arrives after it was stopped', async () => {
    let resolve!: (s: Sentinel) => void;
    stubWakeLock(() => new Promise<Sentinel>((r) => (resolve = r)));
    const { unmount } = renderHook(() => useWakeLock(true));
    unmount();
    const late: Sentinel = { released: false, release: vi.fn(async () => {}) };
    await act(async () => resolve(late));
    expect(late.release).toHaveBeenCalledTimes(1);
  });

  it('does nothing without the feature, and survives a refusal', async () => {
    vi.stubGlobal('navigator', {});
    renderHook(() => useWakeLock(true));
    await act(async () => {});
    stubWakeLock(async () => {
      throw new Error('refused');
    });
    renderHook(() => useWakeLock(true));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);
  });
});
