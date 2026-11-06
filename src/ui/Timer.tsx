import { useEffect, useState } from 'react';
import { formatElapsed } from '../lib/time';

export function Timer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <time className="timer" aria-label="Game time">
      {formatElapsed(now - startedAt)}
    </time>
  );
}
