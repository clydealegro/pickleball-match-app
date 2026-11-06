import * as engine from '../engine';
import type { Session } from '../engine';
import { PlayerChip } from './PlayerChip';

export function UpNextCard({ session }: { session: Session }) {
  const next = engine.previewNext(session);
  const byId = new Map(session.players.map((p) => [p.id, p]));
  const waiting = engine.orderedWaiting(session).length;

  return (
    <section className={`card stack ${next ? 'up-next' : ''}`} aria-labelledby="upnext-title">
      <h2 id="upnext-title" className="section-title">
        Up next
      </h2>
      {next ? (
        <>
          <p className="up-next-court">Court {next.courtNumber}</p>
          <ul className="up-next-list" aria-label="Up next players">
            {next.playerIds.map((id) => {
              const p = byId.get(id);
              return p ? (
                <li key={id}>
                  <PlayerChip player={p} />
                </li>
              ) : null;
            })}
          </ul>
        </>
      ) : waiting >= 4 ? (
        <p>No open court to play on.</p>
      ) : (
        <p>Need {4 - waiting} more waiting to fill the next game.</p>
      )}
    </section>
  );
}
