import { useEffect, useId, useState } from 'react';
import * as engine from '../engine';
import type { PlayerSummary, Session } from '../engine';
import { useHistoryStore } from '../store/historyStore';
import { useSessionStore } from '../store/sessionStore';
import { PlayerAvatar } from './PlayerAvatar';
import { Sheet } from './Sheet';
import { sharePictureFor } from './sharePicture';

function countList(items: { name: string; count: number }[]): string {
  return items.map((p) => (p.count > 1 ? `${p.name} ×${p.count}` : p.name)).join(', ');
}

/** "Ann ×2 · 2W 0L": a partner, how often, and how the pair did when games had a result. */
function partnerList(items: PlayerSummary['partners']): string {
  return items
    .map((p) => {
      const base = p.count > 1 ? `${p.name} ×${p.count}` : p.name;
      return p.wins + p.losses > 0 ? `${base} · ${p.wins}W ${p.losses}L` : base;
    })
    .join(', ');
}

function PlayerRow({ row, maxGames }: { row: PlayerSummary; maxGames: number }) {
  const width = maxGames > 0 ? Math.round((row.gamesPlayed / maxGames) * 100) : 0;
  return (
    <li>
      <details className="sum-player">
        <summary>
          <PlayerAvatar name={row.name} rosterId={row.rosterId} size="sm" />
          <span className="sum-name">
            <span className="sum-who">
              <span className="row-name">{row.name}</span>
              {row.status === 'left' && <span className="tag">Left</span>}
            </span>
            {row.wins + row.losses > 0 && (
              <span className="sum-record">
                {row.wins}W {row.losses}L
              </span>
            )}
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
          {row.wins + row.losses > 0 && (
            <>
              <dt>Record</dt>
              <dd>
                {row.wins} {row.wins === 1 ? 'win' : 'wins'}, {row.losses} {row.losses === 1 ? 'loss' : 'losses'}
              </dd>
            </>
          )}
          <dt>Partners</dt>
          <dd>{row.partners.length ? partnerList(row.partners) : '—'}</dd>
          <dt>Played against</dt>
          <dd>{row.opponents.length ? countList(row.opponents) : '—'}</dd>
        </dl>
      </details>
    </li>
  );
}

/** Two ways to send the session on. The wins and losses switch starts off each time the sheet opens. */
function ShareSheet({
  canShare,
  anyResults,
  making,
  onPick,
  onClose,
}: {
  canShare: boolean;
  anyResults: boolean;
  making: boolean;
  onPick: (how: 'picture' | 'text', withResults: boolean) => void;
  onClose: () => void;
}) {
  const [withResults, setWithResults] = useState(false);
  const pictureSub = useId();
  const textSub = useId();
  return (
    <Sheet title="Share this session" onClose={onClose}>
      <button type="button" className="share-option" disabled={making} aria-describedby={pictureSub} onClick={() => onPick('picture', withResults)}>
        <span className="share-option-name">{making ? 'Making picture…' : 'As a picture'}</span>
        <span id={pictureSub} aria-hidden="true" className="muted share-option-sub">
          The card with highlights and photos
        </span>
      </button>
      <button type="button" className="share-option" aria-describedby={textSub} onClick={() => onPick('text', withResults)}>
        <span className="share-option-name">{canShare ? 'As text' : 'Copy as text'}</span>
        <span id={textSub} aria-hidden="true" className="muted share-option-sub">
          {canShare ? 'For a group chat' : 'Copies it to the clipboard'}
        </span>
      </button>
      {anyResults && (
        // Win records can sting in a friendly group, so they only go out when switched on, each time.
        <label className="switch-row">
          <span>Include wins and losses</span>
          <input type="checkbox" role="switch" checked={withResults} onChange={(e) => setWithResults(e.target.checked)} />
        </label>
      )}
    </Sheet>
  );
}

/** `onBack` makes it a read-only look at a past session: nothing is saved again and there is no Start new. */
export function SummaryScreen({ session, onBack }: { session: Session; onBack?: () => void }) {
  const reset = useSessionStore((s) => s.reset);
  const saveToHistory = useHistoryStore((s) => s.save);
  const kept = useHistoryStore((s) => s.entries.some((e) => e.id === session.id));
  const readOnly = onBack !== undefined;
  const [message, setMessage] = useState('');
  const [shared, setShared] = useState(false);
  const [making, setMaking] = useState(false);
  const [sharing, setSharing] = useState(false);
  const rows = engine.summarize(session);
  const stats = engine.sessionStats(session);
  const log = engine.gameLog(session);
  const fairness = engine.fairnessLine(stats);
  const line = engine.summaryLine(session);
  // This screen already shows every record, so the highlights may too. The shared text and picture follow the switch.
  const notable = engine.highlights(session, { results: true });
  const anyResults = engine.hasResults(session);
  // A session that has ended is kept for the Past sessions list. Saving twice just replaces the same entry.
  useEffect(() => {
    if (!readOnly) void saveToHistory(session);
  }, [readOnly, saveToHistory, session]);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function shareText(withResults: boolean) {
    // Pass the device's UTC offset so the date in the text is the local date.
    const offsetMinutes = -new Date(session.createdAt).getTimezoneOffset();
    const text = engine.formatSummaryText(session, offsetMinutes, { results: withResults });
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

  async function sharePicture(withResults: boolean) {
    setMaking(true);
    setMessage('');
    try {
      const outcome = await sharePictureFor(session, { results: withResults, theme: document.documentElement.dataset.theme });
      if (outcome !== 'cancelled') setShared(true);
      if (outcome === 'saved') setMessage('Picture saved to this device.');
    } catch {
      setMessage('Could not make the picture.');
    } finally {
      setMaking(false);
    }
  }

  async function pick(how: 'picture' | 'text', withResults: boolean) {
    if (how === 'picture') await sharePicture(withResults);
    else await shareText(withResults);
    setSharing(false);
  }

  function done() {
    // Once it is in Past sessions, leaving loses nothing, so there is nothing to warn about.
    if (!kept && !shared && stats.games > 0 && !window.confirm('Close this summary? It could not be saved to Past sessions and you have not shared it yet.')) return;
    reset();
  }

  return (
    <div className="stack">
      <div className="row-flex spread">
        <div>
          <h1 className="screen-title">Session summary</h1>
          <p className="muted">{session.name}</p>
          {session.venue && <p className="muted sum-venue">{session.venue}</p>}
          {line && <p className="sum-line">{line}</p>}
        </div>
        {readOnly && (
          <button type="button" className="btn" onClick={onBack}>
            Back
          </button>
        )}
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
      {notable.length > 0 && (
        <ul className="sum-highlights" aria-label="Highlights">
          {notable.map((h) => (
            <li key={h.key}>{h.text}</li>
          ))}
        </ul>
      )}

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
                {g.winner && (
                  <span className="sum-log-result">
                    {(g.winner === 1 ? g.team1 : g.team2).join(' & ')} won
                    {g.score ? ` ${Math.max(...g.score)} to ${Math.min(...g.score)}` : ''}
                  </span>
                )}
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

      <div className="sticky-bar sum-actions">
        <button type="button" className="btn sum-share" aria-haspopup="dialog" onClick={() => setSharing(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
          </svg>
          Share
        </button>
        {!readOnly && (
          <button type="button" className="btn sum-done" onClick={done}>
            Done
          </button>
        )}
      </div>
      {sharing && <ShareSheet canShare={canShare} anyResults={anyResults} making={making} onPick={(how, w) => void pick(how, w)} onClose={() => setSharing(false)} />}
    </div>
  );
}
