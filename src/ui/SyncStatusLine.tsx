import { useAuthStore } from '../sync/auth';
import { syncLine } from '../sync/describe';
import { useSyncStore } from '../sync/syncStore';

/** One line saying where backing up stands. Shows nothing when there is nothing to say. */
export function SyncStatusLine() {
  const auth = useAuthStore((s) => s.status);
  const status = useSyncStore((s) => s.status);
  const pending = useSyncStore((s) => s.pending);
  const line = syncLine(auth, { status, pending });
  return line ? (
    <p className="muted" role="status">
      {line}
    </p>
  ) : null;
}
