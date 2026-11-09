import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../sync/client', () => ({ getSupabase: () => backend.client }));

const live = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn() }));
vi.mock('../sync/live/publisher', () => ({ startLivePublisher: live.start }));

async function startApp() {
  vi.resetModules();
  const { default: App } = await import('./App');
  return render(<App />);
}

beforeEach(() => {
  localStorage.clear();
  live.stop.mockReset();
  live.start.mockReset().mockReturnValue(live.stop);
  backend.client = null;
});
afterEach(() => cleanup());

describe('App and the live board', () => {
  it('starts the live board publisher once and stops it when the app goes away', async () => {
    const view = await startApp();
    expect(live.start).toHaveBeenCalledTimes(1);
    expect(live.stop).not.toHaveBeenCalled();
    view.unmount();
    expect(live.stop).toHaveBeenCalledTimes(1);
  });
});
