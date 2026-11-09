import { useEffect, useState, type CSSProperties } from 'react';
import { nameHue } from '../store/boardInfo';
import type { LiveBoard, LiveCourt, LivePlayer } from '../sync/live/board';
import { initials } from '../ui/Avatar';
import { timeText } from './format';

/** A board nobody has touched for this long is probably not being kept up: the organizer may have lost signal. */
export const STALE_AFTER_S = 120;

/** The time now, re-read every few seconds so "9 min in" and "updated 6 seconds ago" keep moving. */
function useNow(everyMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** "Ana", or "Ana R." when another player on the board shares the first name. */
function shownName(p: LivePlayer, all: LivePlayer[]): string {
  const same = all.filter((q) => q.f.toLowerCase() === p.f.toLowerCase()).length > 1;
  return same && p.l ? `${p.f} ${p.l}.` : p.f;
}

function Face({ player, face }: { player: LivePlayer; face?: string }) {
  if (face) return <img className="member-tile member-tile-sm live-face" src={face} alt="" />;
  return (
    <span className="member-tile member-tile-sm" style={{ '--h': nameHue(player.f) } as CSSProperties} aria-hidden="true">
      {initials(player.f)}
    </span>
  );
}

function Person({ id, board, faces }: { id: string; board: LiveBoard; faces: Record<string, string> }) {
  const p = board.players[id];
  if (!p) return null;
  return (
    <li className="live-person">
      <Face player={p} face={p.r ? faces[p.r] : undefined} />
      <span className="live-name">{shownName(p, Object.values(board.players))}</span>
    </li>
  );
}

function minutes(ms: number): number {
  return Math.max(0, Math.floor(ms / 60_000));
}

function courtStatus(c: LiveCourt, now: number): string {
  if (c.status === 'playing') return `${minutes(now - (c.startedAt ?? now))} min in${c.closing ? ', last game' : ''}`;
  if (c.status === 'ready') return 'Up next, starting soon';
  return c.closing ? 'Closed' : 'Free';
}

const whenText = (board: LiveBoard): string | null => timeText(board.startMin ?? null, board.endMin ?? null);

/** "6 seconds ago", "2 min ago". */
export function agoText(seconds: number): string {
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${Math.floor(seconds / 10) * 10} seconds ago`;
  return `${Math.floor(seconds / 60)} min ago`;
}

interface Props {
  board: LiveBoard;
  faces: Record<string, string>;
  /** The board's age in seconds when this page last asked, and when that was here. */
  ageS: number;
  fetchedAt: number;
  /** The last ask failed, so the board may be older than it looks. */
  failed: boolean;
}

/** The public live board: the courts, who is on them, and who is waiting. Read only. */
export function LiveBoardView({ board, faces, ageS, fetchedAt, failed }: Props) {
  const now = useNow();
  const age = ageS + Math.max(0, Math.round((now - fetchedAt) / 1000));
  const stale = failed || age >= STALE_AFTER_S;
  const when = [board.venue, whenText(board)].filter(Boolean).join(' · ');
  const nextIds = new Set(board.next?.ids ?? []);
  return (
    <section className="live" aria-label="Live board">
      <header className="live-head">
        <div>
          <h1 className="live-title">{board.title}</h1>
          {when && <p className="live-when">{when}</p>}
        </div>
        <span className="live-chip" data-state={stale ? 'stale' : 'on'}>
          <i aria-hidden="true" />
          {stale ? 'Waiting for update' : 'Live'}
        </span>
      </header>

      {stale && (
        <p className="live-stale" role="status">
          {failed ? 'You seem to be offline.' : `No update for ${Math.floor(age / 60)} min. The organizer may have lost signal.`} Showing the last board.
        </p>
      )}

      <ul className="live-courts">
        {board.courts.map((c) => (
          <li key={c.n} className="live-court" data-status={c.status}>
            <p className="live-court-head">
              <span>Court {c.n}</span>
              <span className="live-court-state">{courtStatus(c, now)}</span>
            </p>
            {c.teams ? (
              <div className="live-teams">
                <ul className="live-team">
                  {c.teams[0].map((id) => (
                    <Person key={id} id={id} board={board} faces={faces} />
                  ))}
                </ul>
                <span className="live-vs" aria-hidden="true">
                  VS
                </span>
                <ul className="live-team">
                  {c.teams[1].map((id) => (
                    <Person key={id} id={id} board={board} faces={faces} />
                  ))}
                </ul>
              </div>
            ) : (
              <p className="live-empty">Nobody on this court.</p>
            )}
          </li>
        ))}
      </ul>

      <h2 className="live-sec">{board.next ? `Waiting · likely next on Court ${board.next.court}` : 'Waiting'}</h2>
      {board.waiting.length === 0 ? (
        <p className="live-empty">Nobody is waiting.</p>
      ) : (
        <ol className="live-queue">
          {board.waiting.map((id, i) => (
            <li key={id} className="live-queue-row" data-next={nextIds.has(id)}>
              <b className="live-pos">{i + 1}</b>
              <ul className="live-team">
                <Person id={id} board={board} faces={faces} />
              </ul>
              {nextIds.has(id) && <span className="live-next">likely next</span>}
            </li>
          ))}
        </ol>
      )}

      {board.onBreak.length > 0 && (
        <>
          <h2 className="live-sec">On a break</h2>
          <ul className="live-team live-breaks">
            {board.onBreak.map((id) => (
              <Person key={id} id={id} board={board} faces={faces} />
            ))}
          </ul>
        </>
      )}

      <p className="live-foot">Updated {agoText(age)}</p>
    </section>
  );
}

/** What the page shows when the organizer has paused sharing. */
export function LivePaused() {
  return (
    <section className="live" aria-label="Live board">
      <p className="member-note" role="status">
        The organizer paused the live board. It will come back by itself.
      </p>
    </section>
  );
}
