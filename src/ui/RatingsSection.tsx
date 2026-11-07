import { useRosterStore } from '../store/rosterStore';
import { MAX_RATING, MIN_RATING, setRating, useRatings } from '../store/ratings';
import { DEFAULT_RATING } from '../engine/selection';

/**
 * The organizer's private skill ratings. They stay on this device, are never synced, and never appear on a court, a
 * tile or the summary. Only the team split reads them, so teams come out close in strength.
 */
export function RatingsSection() {
  const roster = useRosterStore((s) => s.players);
  const ratings = useRatings();

  return (
    <section className="card stack" aria-labelledby="ratings-title">
      <h2 id="ratings-title" className="section-title">
        Skill ratings
      </h2>
      <p className="muted">
        1 is new to the game, 5 is a solid regular, 10 is tournament level. Only you see these. They stay on this device and
        only help balance the teams. A player with no rating counts as {DEFAULT_RATING}.
      </p>
      {roster.length === 0 ? (
        <p className="muted">Add saved players first, then rate them here.</p>
      ) : (
        <ul className="rating-list">
          {roster.map((p) => {
            const rating = ratings[p.id];
            return (
              <li key={p.id} className="rating-row">
                <label className="rating-name" htmlFor={`rating-${p.id}`}>
                  {p.name}
                </label>
                <input
                  id={`rating-${p.id}`}
                  type="range"
                  min={MIN_RATING}
                  max={MAX_RATING}
                  step={1}
                  value={rating ?? DEFAULT_RATING}
                  aria-valuetext={rating === undefined ? `Not rated, counts as ${DEFAULT_RATING}` : String(rating)}
                  className={rating === undefined ? 'rating-unset' : undefined}
                  onChange={(e) => setRating(p.id, Number(e.target.value))}
                />
                <span className="rating-value" aria-hidden="true">
                  {rating ?? '–'}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  disabled={rating === undefined}
                  aria-label={`Clear rating for ${p.name}`}
                  onClick={() => setRating(p.id, undefined)}
                >
                  Clear
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
