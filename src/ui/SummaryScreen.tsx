import { useState } from 'react';
import * as engine from '../engine';
import type { Session } from '../engine';
import { useSessionStore } from '../store/sessionStore';
import { Avatar } from './Avatar';

export function SummaryScreen({ session }: { session: Session }) {
  const reset = useSessionStore((s) => s.reset);
  const [message, setMessage] = useState('');
  const rows = engine.summarize(session);

  async function copy() {
    try {
      // Pass the device's UTC offset so the date in the text is the local date.
      const offsetMinutes = -new Date(session.createdAt).getTimezoneOffset();
      await navigator.clipboard.writeText(engine.formatSummaryText(session, offsetMinutes));
      setMessage('Copied to clipboard.');
    } catch {
      setMessage('Could not copy automatically.');
    }
  }

  return (
    <div className="stack">
      <h1 className="screen-title">Session summary</h1>
      <p className="muted">
        {session.name} · {session.history.length} {session.history.length === 1 ? 'game' : 'games'} played
      </p>

      <div className="card">
        <table>
          <caption>Games and partners</caption>
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Games</th>
              <th scope="col">Partners</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className="row-flex">
                    <Avatar name={r.name} size="sm" />
                    <span className="row-name">{r.name}</span>
                    {r.status === 'left' && <span className="tag">Left</span>}
                  </span>
                </td>
                <td>{r.gamesPlayed}</td>
                <td className="muted">
                  {r.partners.length === 0
                    ? '—'
                    : r.partners.map((p) => (p.count > 1 ? `${p.name} ×${p.count}` : p.name)).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="controls">
        <button type="button" className="btn" onClick={() => void copy()}>
          Copy results
        </button>
        <button type="button" className="btn btn-primary" onClick={reset}>
          Start new session
        </button>
      </div>
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
