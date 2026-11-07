import { useAuthStore } from '../sync/auth';
import { syncLine } from '../sync/describe';
import { useSyncStore } from '../sync/syncStore';

type Tone = 'none' | 'ok' | 'busy' | 'warn' | 'bad';

/** The round button that opens Settings, with a small dot for where backing up stands. */
export function AccountButton({ onClick }: { onClick: () => void }) {
  const auth = useAuthStore((s) => s.status);
  const status = useSyncStore((s) => s.status);
  const pending = useSyncStore((s) => s.pending);
  const line = syncLine(auth, { status, pending });
  let tone: Tone = 'none';
  if (auth === 'signedIn') {
    if (status === 'synced' && pending === 0) tone = 'ok';
    else if (status === 'offline') tone = 'warn';
    else if (status === 'error' || status === 'auth' || status === 'otherAccount') tone = 'bad';
    else tone = 'busy';
  }
  return (
    <button type="button" className="account-btn" aria-label={line ? `Settings. ${line}` : 'Settings'} onClick={onClick}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
      </svg>
      {tone !== 'none' && <span className={`dot dot-${tone}`} aria-hidden="true" />}
    </button>
  );
}
