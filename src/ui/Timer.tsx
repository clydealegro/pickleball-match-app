import { useEffect, useRef, useState } from 'react';
import { formatElapsed } from '../lib/time';

/** The time since a game started. `labelled={false}` leaves the label off where the clock sits inside a named control. */
export function Timer({ startedAt, labelled = true }: { startedAt: number; labelled?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  // The first reading shows as it is; after that, each digit that changes rolls in.
  const ticked = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      ticked.current = true;
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <time className="timer" aria-label={labelled ? 'Game time' : undefined}>
      {Array.from(formatElapsed(now - startedAt)).map((ch, i) => (
        <span key={`${i}:${ch}`} className={ticked.current ? 'digit digit-tick' : 'digit'}>
          {ch}
        </span>
      ))}
    </time>
  );
}
