import type { ReactNode } from 'react';
import { regularsForWeekday } from '../store/attendance';
import { homeLabel, usualTurnout } from '../store/homeInfo';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { formatRange, type Slot } from '../store/slots';
import type { LastWeekStats } from '../store/lastWeekStats';
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
  /** The slot has Just this time changes, so a one-off change is not mistaken for a lasting one. */
  thisTimeOnly?: boolean;
  /** The foot of the card: who is in and the Share button. Without it, the regulars show instead. */
  attendance?: ReactNode;
  /** Opens the venue drawer; the dashed "+ Add a venue" chip calls it. Falls back to the edit sheet. */
  onVenue?: () => void;
  /** Who stood out last time on this weekday. */
  last?: LastWeekStats;
  /** The card came in from a swipe to the right, so it slides in from the left. */
  fromLeft?: boolean;
}

const STAT_LABEL: Record<'played' | 'wins' | 'losses', string> = { played: 'most played', wins: 'most wins', losses: 'most losses' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The black card: who played, won and lost most the last time this weekday was played. */
function LastWeek({ last, weekday }: { last: LastWeekStats; weekday: number }) {
  const d = new Date(last.at);
  return (
    <section className="home-last-week" aria-label="Last session">
      <p className="home-last-head">
        <strong>Last {WEEKDAY_NAMES[weekday]}</strong>
        <span>
          {d.getDate()} {MONTHS[d.getMonth()]} · {last.games} games
        </span>
      </p>
      <ul className="home-last-stats">
        {last.stats.map((st) => (
          <li key={st.key} className="home-last-stat">
            <b>{st.value}</b>
            <strong>{st.name}</strong>
            <span>{STAT_LABEL[st.key]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const ClockIcon = () => (
  <svg className="home-row-icon" width="20" height="20" viewBox="0 0 24 24" {...ICON}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const PinIcon = () => (
  <svg className="home-row-icon" width="20" height="20" viewBox="0 0 24 24" {...ICON}>
    <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

/** The lime card for one slot. It only shows things; the Start bar is the only way to go on. */
export function SlotHero({ effective, now, onEdit, thisTimeOnly = false, attendance, onVenue, last, fromLeft = false }: SlotHeroProps) {
  const loaded = useHistoryStore((s) => s.loaded);
  const day = WEEKDAY_NAMES[effective.weekday];
  const courts = effective.courts === undefined ? undefined : `${effective.courts} ${effective.courts === 1 ? 'court' : 'courts'}`;
  const noTime = effective.startMin === undefined && effective.endMin === undefined;
  return (
    <section className={`home-hero home-hero-split home-hero-in${fromLeft ? ' home-hero-in-left' : ''}`}>
      <CourtLines />
      <div className="home-hero-head">
        <div className="home-hero-top">
          <div className="home-hero-tags">
            <span className="home-pill">{homeLabel(effective, now)}</span>
          </div>
          <button type="button" className="home-edit" aria-label={`Edit ${day}`} onClick={onEdit}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 20h4L19 9l-4-4L4 16z" />
              <path d="M13.5 6.5l4 4" />
            </svg>
          </button>
        </div>
        <h1 className="home-day">{day}</h1>
        <div className="home-rows">
          <div className="home-row">
            <ClockIcon />
            {noTime ? <DashedChip label="+ Add a time" onClick={onEdit} /> : <span className="home-time">{formatRange(effective.startMin, effective.endMin)}</span>}
          </div>
          <div className="home-row">
            <PinIcon />
            {effective.venue !== undefined ? (
              // The venue is a button too, so a place can be changed without opening the whole sheet.
              <button type="button" className="home-line-btn" onClick={onVenue ?? onEdit}>
                <span>{courts !== undefined ? `${effective.venue} · ${courts}` : effective.venue}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            ) : (
              <>
                <DashedChip label="+ Add a venue" onClick={onVenue ?? onEdit} />
                {courts !== undefined && <span className="home-time">{courts}</span>}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="home-hero-body">
        {thisTimeOnly && <p className="home-once">This time only</p>}
        {last && <LastWeek last={last} weekday={effective.weekday} />}
        {attendance ?? <div className="home-foot">{loaded && <Regulars weekday={effective.weekday} />}</div>}
      </div>
    </section>
  );
}

/** The calm hero for a one-off session: same shape, no pencil, no pill. */
export function OneOffHero({ fromLeft = false }: { fromLeft?: boolean }) {
  return (
    <section className={`home-hero home-hero-in${fromLeft ? ' home-hero-in-left' : ''}`}>
      <CourtLines />
      <h1 className="home-day home-day-oneoff">One-off session</h1>
      <p className="home-line">Pick who is playing and go.</p>
    </section>
  );
}
