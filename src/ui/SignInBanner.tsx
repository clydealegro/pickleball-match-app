import { useState } from 'react';
import { useAuthStore } from '../sync/auth';
import { useRosterStore } from '../store/rosterStore';

const KEY = 'pikl.signInBannerDismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Offers to sign in once there is something to back up. Shown only to someone who is signed out (not while a sign-in
 * is in progress, not without a backend), and not again once dismissed.
 */
export function SignInBanner({ onSignIn }: { onSignIn: () => void }) {
  const status = useAuthStore((s) => s.status);
  const hasPlayers = useRosterStore((s) => s.players.length > 0);
  const [dismissed, setDismissed] = useState(wasDismissed);
  if (status !== 'signedOut' || !hasPlayers || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Without storage it comes back next visit, which is fine.
    }
  }

  return (
    <p className="notice">
      Sign in to back up and sync your players.{' '}
      <button type="button" className="btn btn-small btn-primary" onClick={onSignIn}>
        Sign in
      </button>{' '}
      <button type="button" className="btn btn-small btn-ghost" onClick={dismiss}>
        Not now
      </button>
    </p>
  );
}
