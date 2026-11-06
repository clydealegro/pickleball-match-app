import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateStore } from './pwa';

beforeEach(() => {
  useUpdateStore.setState({ ready: false, apply: null });
});

describe('useUpdateStore', () => {
  it('starts with no update ready', () => {
    expect(useUpdateStore.getState().ready).toBe(false);
    expect(useUpdateStore.getState().apply).toBeNull();
  });

  it('markReady flags the update and stores the apply function without calling it', () => {
    const apply = vi.fn();
    useUpdateStore.getState().markReady(apply);
    expect(useUpdateStore.getState().ready).toBe(true);
    expect(useUpdateStore.getState().apply).toBe(apply);
    expect(apply).not.toHaveBeenCalled();
  });
});
