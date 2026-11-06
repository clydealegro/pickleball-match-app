import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stop = vi.fn();
const start = vi.fn(() => stop);
vi.mock('../sync/coordinator', () => ({ startSyncCoordinator: () => start() }));

beforeEach(() => {
  start.mockClear();
  stop.mockClear();
});

describe('sync in the app', () => {
  it('starts when the app opens and stops when it closes', async () => {
    const { default: App } = await import('./App');
    const { unmount } = render(<App />);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
