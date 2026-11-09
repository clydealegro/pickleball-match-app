import { describe, expect, it, vi } from 'vitest';
import { chooseRoot, watchJoin } from './chooseRoot';

describe('chooseRoot', () => {
  it('opens the member page for a join hash', () => {
    expect(chooseRoot('#/j/abc123')).toEqual({ kind: 'member', code: 'abc123' });
  });

  it('keeps dashes and underscores in the code', () => {
    expect(chooseRoot('#/j/a-b_C9')).toEqual({ kind: 'member', code: 'a-b_C9' });
  });

  it('opens the app for anything else', () => {
    for (const hash of ['', '#', '#/', '#/j/', '#/j/abc/extra', '#/x/abc123', '#/j/ab c', '/j/abc123', '#/j/abc?x=1']) {
      expect(chooseRoot(hash), hash).toEqual({ kind: 'app' });
    }
  });
});

describe('watchJoin', () => {
  function setup(code: string | null) {
    const listeners: (() => void)[] = [];
    const win = {
      location: { hash: '' },
      addEventListener: vi.fn((type: string, fn: () => void) => {
        expect(type).toBe('hashchange');
        listeners.push(fn);
      }),
    };
    const reload = vi.fn();
    watchJoin(code, win, reload);
    return { win, reload, fire: () => listeners.forEach((fn) => fn()) };
  }

  it('listens for hash changes once', () => {
    expect(setup('abc').win.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('reloads when the code changes', () => {
    const { win, reload, fire } = setup('abc');
    win.location.hash = '#/j/xyz';
    fire();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when a code appears or goes away', () => {
    const appears = setup(null);
    appears.win.location.hash = '#/j/abc';
    appears.fire();
    expect(appears.reload).toHaveBeenCalledTimes(1);
    const goes = setup('abc');
    goes.win.location.hash = '';
    goes.fire();
    expect(goes.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the code is the same, or the hash is not a join hash and there was none', () => {
    const same = setup('abc');
    same.win.location.hash = '#/j/abc';
    same.fire();
    expect(same.reload).not.toHaveBeenCalled();
    const none = setup(null);
    none.win.location.hash = '#/settings';
    none.fire();
    expect(none.reload).not.toHaveBeenCalled();
  });
});
