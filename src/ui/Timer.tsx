import { useEffect, useState } from 'react';
import { formatElapsed } from '../lib/time';

/** The time since a game started. `labelled={false}` leaves the label off where the clock sits inside a named control. */
export function Timer({ startedAt, labelled = true }: { startedAt: number; labelled?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <time className="timer" aria-label={labelled ? 'Game time' : undefined}>
      {formatElapsed(now - startedAt)}
    </time>
  );
}
