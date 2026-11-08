import { regularsForWeekday } from '../store/attendance';
import { homeLabel, usualTurnout } from '../store/homeInfo';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { formatRange, type Slot } from '../store/slots';
import { PlayerAvatar } from './PlayerAvatar';
import { WEEKDAY_NAMES } from './weekdays';

const MAX_AVATARS = 4;

/** Faint court lines in the corner of the hero. They are decoration only. */
function CourtLines() {
  return (
    <svg className="home-court" viewBox="0 0 120 160" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="112" height="152" />
      <line x1="4" y1="80" x2="116" y2="80" />
      <line x1="4" y1="52" x2="116" y2="52" />
      <line x1="4" y1="108" x2="116" y2="108" />
      <line x1="60" y1="4" x2="60" y2="52" />
      <line x1="60" y1="108" x2="60" y2="156" />
    </svg>
  );
}

function DashedChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="dashed home-dashed" onClick={onClick}>
      {label}
    </button>
  );
}

function Regulars({ weekday }: { weekday: number }) {
  const entries = useHistoryStore((s) => s.entries);
  const players = useRosterStore((s) => s.players);
  const regulars = regularsForWeekday(entries, weekday).flatMap((id) => players.find((p) => p.id === id) ?? []);
  const turnout = usualTurnout(entries, weekday);
  const extra = regulars.length - MAX_AVATARS;
  return (
    <>
      {regulars.length > 0 && (
        <div className="home-avatars">
          {regulars.slice(0, MAX_AVATARS).map((p) => (
            <PlayerAvatar key={p.id} name={p.name} rosterId={p.id} size="sm" />
          ))}
          {extra > 0 && <span className="home-more">+{extra}</span>}
          <span className="sr-only">Regulars: {regulars.map((p) => p.name).join(', ')}</span>
        </div>
      )}
      {turnout && <p className="home-caption">{turnout.min === turnout.max ? `Usually ${turnout.min} play` : `Usually ${turnout.min} to ${turnout.max} play`}</p>}
    </>
  );
}

interface SlotHeroProps {
  /** The slot with this-time-only edits laid over it. */
  effective: Slot;
  now: Date;
  /** Opens the edit sheet. */
  onEdit: () => void;
}

/** The lime card for one slot. It only shows things; the Start bar is the only way to go on. */
export function SlotHero({ effective, now, onEdit }: SlotHeroProps) {
  const loaded = useHistoryStore((s) => s.loaded);
  const day = WEEKDAY_NAMES[effective.weekday];
  const courts = effective.courts === undefined ? undefined : `${effective.courts} ${effective.courts === 1 ? 'court' : 'courts'}`;
  const noTime = effective.startMin === undefined && effective.endMin === undefined;
  return (
    <section className="home-hero home-hero-in">
      <CourtLines />
      <div className="home-hero-top">
        <span className="home-pill">{homeLabel(effective, now)}</span>
        <button type="button" className="home-edit" aria-label={`Edit ${day}`} onClick={onEdit}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16z" />
            <path d="M13.5 6.5l4 4" />
          </svg>
        </button>
      </div>
      <h1 className="home-day">{day}</h1>
      {noTime ? <DashedChip label="+ Add a time" onClick={onEdit} /> : <p className="home-line">{formatRange(effective.startMin, effective.endMin)}</p>}
      {effective.venue !== undefined && courts !== undefined ? (
        <p className="home-line">
          {effective.venue} · {courts}
        </p>
      ) : (
        <div className="home-where">
          {effective.venue !== undefined ? <p className="home-line">{effective.venue}</p> : <DashedChip label="+ Add a venue" onClick={onEdit} />}
          {courts !== undefined ? <p className="home-line">{courts}</p> : <DashedChip label="+ Add courts" onClick={onEdit} />}
        </div>
      )}
      <div className="home-foot">{loaded && <Regulars weekday={effective.weekday} />}</div>
    </section>
  );
}

/** The calm hero for a one-off session: same shape, no pencil, no pill. */
export function OneOffHero() {
  return (
    <section className="home-hero home-hero-in">
      <CourtLines />
      <h1 className="home-day home-day-oneoff">One-off session</h1>
      <p className="home-line">Pick who is playing and go.</p>
    </section>
  );
}
