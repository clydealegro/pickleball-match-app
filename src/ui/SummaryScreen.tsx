import { useState } from 'react';
import * as engine from '../engine';
import type { PlayerSummary, Session } from '../engine';
import { useSessionStore } from '../store/sessionStore';
import { PlayerAvatar } from './PlayerAvatar';

function countList(items: { name: string; count: number }[]): string {
  return items.map((p) => (p.count > 1 ? `${p.name} ×${p.count}` : p.name)).join(', ');
}

function PlayerRow({ row, maxGames }: { row: PlayerSummary; maxGames: number }) {
  const width = maxGames > 0 ? Math.round((row.gamesPlayed / maxGames) * 100) : 0;
  return (
    <li>
      <details className="sum-player">
        <summary>
          <PlayerAvatar name={row.name} rosterId={row.rosterId} size="sm" />
          <span className="sum-name">
            <span className="row-name">{row.name}</span>
            {row.status === 'left' && <span className="tag">Left</span>}
          </span>
          <span className="sum-bar" aria-hidden="true">
            <span style={{ width: `${width}%` }} />
          </span>
          <span className="sum-count">
            {row.gamesPlayed}
            <span className="sr-only"> {row.gamesPlayed === 1 ? 'game' : 'games'}</span>
          </span>
        </summary>
        <dl className="sum-detail">
          <dt>Partners</dt>
          <dd>{row.partners.length ? countList(row.partners) : '—'}</dd>
          <dt>Played against</dt>
          <dd>{row.opponents.length ? countList(row.opponents) : '—'}</dd>
        </dl>
      </details>
    </li>
  );
}

export function SummaryScreen({ session }: { session: Session }) {
  const reset = useSessionStore((s) => s.reset);
  const [message, setMessage] = useState('');
  const [shared, setShared] = useState(false);
  const rows = engine.summarize(session);
  const stats = engine.sessionStats(session);
  const log = engine.gameLog(session);
  const fairness = engine.fairnessLine(stats);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function share() {
    // Pass the device's UTC offset so the date in the text is the local date.
    const offsetMinutes = -new Date(session.createdAt).getTimezoneOffset();
    const text = engine.formatSummaryText(session, offsetMinutes);
    if (canShare) {
      try {
        await navigator.share({ title: session.name, text });
        setShared(true);
        setMessage('');
        return;
      } catch (e) {
        // Closing the share sheet is not an error.
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setShared(true);
      setMessage('Copied to clipboard.');
    } catch {
      setMessage('Could not copy automatically.');
    }
  }

  function startNew() {
    if (!shared && stats.games > 0 && !window.confirm('Start a new session? This summary will be cleared, and you have not shared it yet.')) return;
    reset();
  }

  return (
    <div className="stack">
      <div>
        <h1 className="screen-title">Session summary</h1>
        <p className="muted">{session.name}</p>
      </div>

      <dl className="sum-stats">
        <div>
          <dt>Games</dt>
          <dd>{stats.games}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{stats.games ? engine.formatDuration(stats.playingMs) : '—'}</dd>
        </div>
        <div>
          <dt>Players</dt>
          <dd>{stats.players}</dd>
        </div>
      </dl>
      {fairness && <p className="sum-fairness">{fairness}</p>}

      <div className="card">
        <ul className="sum-list" aria-label="Games per player">
          {rows.map((r) => (
            <PlayerRow key={r.id} row={r} maxGames={stats.maxGames} />
          ))}
        </ul>
        <p className="muted sum-hint">Tap a player to see partners and opponents.</p>
      </div>

      {log.length > 0 && (
        <details className="card sum-log">
          <summary>Game by game ({log.length})</summary>
          <ol>
            {log.map((g, i) => (
              <li key={i}>
                <span className="sum-log-meta">
                  Court {g.courtNumber} · {engine.formatDuration(g.durationMs)}
                </span>
                <span>
                  {g.team1.join(' & ')} <span className="muted">vs</span> {g.team2.join(' & ')}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}

      <div className="sticky-bar">
        <button type="button" className="btn btn-primary btn-block" onClick={() => void share()}>
          {canShare ? 'Share results' : 'Copy results'}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={startNew}>
          Start new session
        </button>
      </div>
    </div>
  );
}
