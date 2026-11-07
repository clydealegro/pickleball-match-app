import { describe, expect, it } from 'vitest';
import { syncLine } from './describe';

const at = (status: Parameters<typeof syncLine>[1]['status'], pending = 0) => ({ status, pending });

describe('the sync line', () => {
  it('says nothing without a backend or while the sign-in is being checked', () => {
    expect(syncLine('unconfigured', at('off'))).toBeNull();
    expect(syncLine('loading', at('off'))).toBeNull();
  });

  it('says signed out, and that the sign-in could not be checked', () => {
    expect(syncLine('signedOut', at('off'))).toBe('Signed out');
    expect(syncLine('linkSent', at('off'))).toBe('Signed out');
    expect(syncLine('unknown', at('off'))).toBe("Can't check sign-in without a connection");
  });

  it('says syncing before the first round has finished, and during one', () => {
    expect(syncLine('signedIn', at('off'))).toBe('Syncing…');
    expect(syncLine('signedIn', at('syncing'))).toBe('Syncing…');
  });

  it('says synced only when nothing is left to send', () => {
    expect(syncLine('signedIn', at('synced', 0))).toBe('Synced');
    expect(syncLine('signedIn', at('synced', 2))).toBe('Syncing…');
  });

  it('counts the changes waiting while offline, in the singular and the plural', () => {
    expect(syncLine('signedIn', at('offline', 0))).toBe('Offline');
    expect(syncLine('signedIn', at('offline', 1))).toBe('Offline, 1 change waiting');
    expect(syncLine('signedIn', at('offline', 3))).toBe('Offline, 3 changes waiting');
  });

  it('says the server cannot be reached, and that it will retry', () => {
    expect(syncLine('signedIn', at('error', 0))).toBe("Can't reach server, will retry");
    expect(syncLine('signedIn', at('error', 2))).toBe("Can't reach server, will retry. 2 changes waiting");
  });

  it('tells a rejected session and another account\'s players apart', () => {
    expect(syncLine('signedIn', at('auth'))).toMatch(/sign out and sign in again/i);
    expect(syncLine('signedIn', at('otherAccount'))).toMatch(/another account/i);
  });

  it('uses no em dash', () => {
    for (const status of ['off', 'syncing', 'synced', 'offline', 'error', 'auth', 'otherAccount'] as const) {
      expect(syncLine('signedIn', at(status, 2)) ?? '').not.toContain('—');
    }
  });
});
