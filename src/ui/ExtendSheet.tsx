import { useState } from 'react';
import { extendSession } from '../engine';
import { useSessionStore } from '../store/sessionStore';
import { Sheet } from './Sheet';

const CHOICES = [
  { label: '+15 min', minutes: 15, said: '15 minutes' },
  { label: '+30 min', minutes: 30, said: '30 minutes' },
  { label: '+1 hour', minutes: 60, said: '1 hour' },
];

/** Moves the planned end of the running session later, with a way back through Undo. */
export function ExtendSheet({ onClose }: { onClose: () => void }) {
  const apply = useSessionStore((s) => s.apply);
  const [error, setError] = useState<string | null>(null);

  function extend(minutes: number, said: string) {
    const res = apply((s, ctx) => extendSession(s, minutes, ctx), `Extended by ${said}`);
    if (res.ok) onClose();
    else setError(res.error);
  }

  return (
    <Sheet title="Extend the session" onClose={onClose}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="stack">
        {CHOICES.map((c) => (
          <button key={c.label} type="button" className="btn btn-block" onClick={() => extend(c.minutes, c.said)}>
            {c.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
