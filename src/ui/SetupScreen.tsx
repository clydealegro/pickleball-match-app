import { gsap } from 'gsap';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { attendanceByRoster, regularsForWeekday, sortByAttendance } from '../store/attendance';
import { useHistoryStore } from '../store/historyStore';
import { lastSessionIds } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { effectiveSlot, formatClock, formatRange, useSlotsStore } from '../store/slots';
import { getDefaultMode, useDefaultMode } from './matchmaking';
import { AUTO_START_KEY, COURTS_KEY, getBoolPref, getNumPref, REGULARS_FIRST_KEY, setNumPref, useBoolPref } from './prefs';
import type { SessionPlan } from './HomeScreen';
import { motionOK, MOTION } from './motion';
import { PlayerAvatar } from './PlayerAvatar';
import { WEEKDAY_NAMES } from './weekdays';

const MIN_PLAYERS = 4;
const MAX_COURTS = 12;

interface Props {
  onManage: () => void;
  /** The slot this session starts from. Without one it is a one-off session. */
  plan?: SessionPlan;
  /** Shows a Back button when given. */
  onBack?: () => void;
}

const norm = (name: string) => name.trim().toLowerCase();

/** "Saturday open play": enough to tell sessions apart without asking for a name. */
function defaultSessionName(weekday: number): string {
  return `${WEEKDAY_NAMES[weekday]} open play`;
}

interface PickRowProps {
  name: string;
  /** The saved player behind the row. A friend has none. */
  rosterId?: string;
  checked: boolean;
  onToggle: () => void;
  /** A small label on the row. The checkbox keeps the plain name and is described by it. */
  tag?: string;
}

function PickRow({ name, rosterId, checked, onToggle, tag }: PickRowProps) {
  const tagId = useId();
  return (
    <li className={tag ? 'pick-wide' : undefined}>
      <label className="pick">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={tag ? name : undefined} aria-describedby={tag ? tagId : undefined} />
        <PlayerAvatar name={name} rosterId={rosterId} size="sm" />
        <span className="row-name">{name}</span>
        {tag && (
          <span id={tagId} className="tag pick-tag">
            {tag}
          </span>
        )}
      </label>
    </li>
  );
}

/** The saved players list. With groups above it, it gets a heading of its own. */
function ListWrap({ grouped, children }: { grouped: boolean; children: ReactNode }) {
  const list = (
    <ul className="pick-grid" aria-label="Saved players">
      {children}
    </ul>
  );
  if (!grouped) return list;
  return (
    <section className="pick-group">
      <h2 className="pick-group-title">Everyone else</h2>
      {list}
    </section>
  );
}

function PickGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pick-group">
      <h2 className="pick-group-title">{title}</h2>
      <ul className="pick-grid">{children}</ul>
    </section>
  );
}

export function SetupScreen({ onManage, plan, onBack }: Props) {
  const saved = useRosterStore((s) => s.players);
  const history = useHistoryStore((s) => s.entries);
  const [regularsFirst] = useBoolPref(REGULARS_FIRST_KEY, true);
  // The people who come most often go first, so the usual crowd is at the top of a long list.
  const roster = useMemo(() => (regularsFirst ? sortByAttendance(saved, attendanceByRoster(history)) : saved), [saved, history, regularsFirst]);
  const weekday = plan?.weekday ?? new Date().getDay();
  const slot = useSlotsStore((s) => s.slots.find((x) => x.id === plan?.slotId));
  const tonight = useSlotsStore((s) => s.tonight);
  const clearTonight = useSlotsStore((s) => s.clearTonight);
  const weekdayIds = useMemo(() => {
    const here = new Set(saved.map((p) => p.id));
    return regularsForWeekday(history, weekday).filter((id) => here.has(id));
  }, [saved, history, weekday]);
  const addToRoster = useRosterStore((s) => s.add);
  const start = useSessionStore((s) => s.start);
  const [mode] = useDefaultMode();

  // What the plan says about where and when, for the line under the title.
  const eff = slot ? effectiveSlot(slot, tonight) : undefined;
  const plannedEnd = plan?.plannedEndAt === undefined ? undefined : new Date(plan.plannedEndAt);
  const when =
    eff && (eff.startMin !== undefined || eff.endMin !== undefined)
      ? formatRange(eff.startMin, eff.endMin)
      : plannedEnd
        ? `Until ${formatClock(plannedEnd.getHours() * 60 + plannedEnd.getMinutes())}`
        : undefined;
  const planLine = [plan?.venue, when].filter(Boolean).join(' · ');

  const [courtCount, setCourtCount] = useState(() => plan?.courts ?? getNumPref(COURTS_KEY, 2, 1, MAX_COURTS));
  const attendance = plan?.attendance;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(attendance?.inIds ?? []));
  // The friends ticked for tonight, by guest id. Shortcuts below never touch them.
  const [friendsOn, setFriendsOn] = useState<Set<string>>(() => new Set(attendance?.friends.map((f) => f.id) ?? []));
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Adds run one after another, so typing on while a name is being saved cannot create doubles.
  const adding = useRef<Promise<void>>(Promise.resolve());

  // A start error belongs to the selection it was raised for.
  useEffect(() => {
    setStartError(null);
  }, [selected]);

  const lastIds = lastSessionIds(roster);
  const chosen = roster.filter((p) => selected.has(p.id));
  // A friend with the same name as a player in the list, or as an earlier friend, would be a duplicate: the engine refuses those.
  const seenNames = new Set(chosen.map((p) => norm(p.name)));
  const friendPlayers: { id: string; name: string }[] = [];
  for (const f of attendance?.friends ?? []) {
    if (!friendsOn.has(f.id) || seenNames.has(norm(f.name))) continue;
    seenNames.add(norm(f.name));
    friendPlayers.push(f);
  }
  const total = chosen.length + friendPlayers.length;
  const canStart = total >= MIN_PLAYERS;
  const countRef = useRef<HTMLSpanElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const counted = useRef<{ count: number; canStart: boolean } | null>(null);

  // The count gives a small bump each time it changes, and the Start button springs when it becomes available.
  useEffect(() => {
    const before = counted.current;
    counted.current = { count: total, canStart };
    if (!before || !motionOK()) return;
    if (before.count !== total && countRef.current) {
      gsap.fromTo(countRef.current, { y: before.count < total ? 6 : -6, scale: 1.18 }, { y: 0, scale: 1, duration: MOTION.fast + 0.1, ease: MOTION.out, clearProps: 'transform' });
    }
    if (canStart && !before.canStart && startRef.current) {
      gsap.fromTo(startRef.current, { scale: 0.94 }, { scale: 1, duration: MOTION.slow + 0.1, ease: 'back.out(2.4)', clearProps: 'transform' });
    }
  }, [total, canStart]);
  // The groups the link fills in. Players the link names but this phone does not have are only counted.
  const byId = new Map(roster.map((p) => [p.id, p]));
  const found = (ids: string[]) => ids.flatMap((id) => byId.get(id) ?? []);
  const saidIn = found(attendance?.inIds ?? []);
  const maybe = found(attendance?.maybeIds ?? []);
  const missing = (attendance?.inIds.length ?? 0) - saidIn.length;
  const friends = attendance?.friends ?? [];
  const grouped = saidIn.length + maybe.length + friends.length > 0;
  const inGroup = new Set([...saidIn, ...maybe].map((p) => p.id));
  const rest = grouped ? roster.filter((p) => !inGroup.has(p.id)) : roster;
  const late = new Set(attendance?.lateIds ?? []);
  const typed = query.trim();
  const exact = roster.find((p) => norm(p.name) === norm(typed));
  const matches = (p: { name: string }) => !typed || norm(p.name).includes(norm(typed));
  const shown = rest.filter(matches);
  const anyMatch = roster.some(matches);
  const canAdd = typed !== '' && !exact;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Saves each name and picks it. Names that already exist are just picked. */
  function addNames(names: string[]) {
    const lines = names.map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    adding.current = adding.current.then(async () => {
      const ids: string[] = [];
      let failure: string | null = null;
      for (const line of lines) {
        try {
          ids.push((await addToRoster(line)).id);
        } catch (e) {
          failure = e instanceof Error ? e.message : 'Could not add that player.';
        }
      }
      setSelected((prev) => new Set([...prev, ...ids]));
      setError(failure);
    });
  }

  function submitQuery() {
    if (!typed) return;
    // Enter picks the player the typing points at, or adds a new one.
    if (exact) setSelected((prev) => new Set(prev).add(exact.id));
    else addNames([typed]);
    setQuery('');
  }

  function toggleFriend(id: string) {
    setFriendsOn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startSession() {
    const res = start({
      name: defaultSessionName(weekday),
      mode: getDefaultMode(),
      courtCount,
      autoStart: getBoolPref(AUTO_START_KEY, false),
      players: [
        ...chosen.map((p) => ({ name: p.name, rosterId: p.id, ...(late.has(p.id) ? { onBreak: true } : {}) })),
        ...friendPlayers.map((f) => ({ name: f.name })),
      ],
      venue: plan?.venue,
      plannedEndAt: plan?.plannedEndAt,
      weekday: plan?.weekday,
      slotId: plan?.slotId,
    });
    if (res.ok) {
      setNumPref(COURTS_KEY, courtCount);
      // The this-time-only edits were for this session, so they end with it.
      if (plan) clearTonight(plan.slotId);
    } else setStartError(res.error);
  }

  return (
    <div className="stack setup">
      {onBack && (
        <div>
          <button type="button" className="btn" onClick={onBack}>
            Back
          </button>
        </div>
      )}
      <div className="setup-head">
        <h1 className="screen-title">Who’s playing?</h1>
        <span ref={countRef} className="setup-count" aria-live="polite">
          {total} selected
        </span>
      </div>
      {planLine && <p className="muted setup-plan">{planLine}</p>}

      {missing > 0 && (
        <p className="muted setup-note">{`${missing} who said In ${missing === 1 ? 'is' : 'are'} not saved on this phone yet.`}</p>
      )}
      {saidIn.length > 0 && (
        <PickGroup title={`Said In, ${saidIn.length}`}>
          {saidIn.map((p) => (
            <PickRow key={p.id} name={p.name} rosterId={p.id} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} tag={late.has(p.id) ? 'Late, starts on a break' : undefined} />
          ))}
        </PickGroup>
      )}
      {maybe.length > 0 && (
        <PickGroup title={`Maybe, ${maybe.length}`}>
          {maybe.map((p) => (
            <PickRow key={p.id} name={p.name} rosterId={p.id} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} />
          ))}
        </PickGroup>
      )}
      {friends.length > 0 && (
        <PickGroup title={`Friends, ${friends.length}`}>
          {friends.map((f) => (
            <PickRow key={f.id} name={f.name} checked={friendsOn.has(f.id)} onToggle={() => toggleFriend(f.id)} tag="Friend, tonight only" />
          ))}
        </PickGroup>
      )}

      <input
        className="field"
        type="text"
        aria-label="Search or add players"
        placeholder={roster.length > 0 ? 'Search or add a name' : 'Add a name, then press Enter'}
        autoComplete="off"
        enterKeyHint="done"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitQuery();
          }
        }}
        onPaste={(e) => {
          // A pasted list becomes one player per line.
          const text = e.clipboardData.getData('text');
          if (!text.includes('\n')) return;
          e.preventDefault();
          addNames(text.split('\n'));
          setQuery('');
        }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {roster.length === 0 && <p className="muted setup-note">Add the people who play regularly. They are saved for next time.</p>}
      {mode === 'queue' && <p className="muted setup-note">Simple queue matchmaking. Change it in Settings.</p>}

      {roster.length > 0 && (
        <div className="quick">
          {lastIds.length > 0 && (
            <button type="button" className="btn btn-small" onClick={() => setSelected(new Set(lastIds))}>
              Same as last time ({lastIds.length})
            </button>
          )}
          {weekdayIds.length >= MIN_PLAYERS && (
            <button type="button" className="btn btn-small" onClick={() => setSelected(new Set(weekdayIds))}>
              {WEEKDAY_NAMES[weekday]} regulars ({weekdayIds.length})
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setSelected(new Set(roster.map((p) => p.id)))}>
            Select all
          </button>
          {selected.size > 0 && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          )}
        </div>
      )}

      {(shown.length > 0 || canAdd) && (
        <ListWrap grouped={grouped}>
          {canAdd && (
            <li>
              <button type="button" className="pick pick-add" onClick={submitQuery}>
                + Add “{typed}”
              </button>
            </li>
          )}
          {shown.map((p) => (
            <PickRow key={p.id} name={p.name} rosterId={p.id} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} />
          ))}
        </ListWrap>
      )}
      {typed !== '' && !anyMatch && !canAdd && <p className="muted">No one matches.</p>}

      {roster.length > 0 && (
        <button type="button" className="btn btn-ghost btn-small edit-players" onClick={onManage}>
          Edit players
        </button>
      )}

      <div className="sticky-bar start-bar">
        <div className="start-row">
          <div className="stepper stepper-sm" role="group" aria-label="Courts">
            <button
              type="button"
              className="btn"
              aria-label="Fewer courts"
              disabled={courtCount <= 1}
              onClick={() => setCourtCount((c) => c - 1)}
            >
              −
            </button>
            <output aria-live="polite" aria-label="Courts">
              <span className="stepper-value">{courtCount}</span>
              <span className="stepper-caption">{courtCount === 1 ? 'court' : 'courts'}</span>
            </output>
            <button
              type="button"
              className="btn"
              aria-label="More courts"
              disabled={courtCount >= MAX_COURTS}
              onClick={() => setCourtCount((c) => c + 1)}
            >
              +
            </button>
          </div>
          <button
            ref={startRef}
            type="button"
            className={`btn btn-block start-btn${canStart ? ' btn-live' : ''}`}
            disabled={!canStart}
            onClick={startSession}
          >
            {canStart ? `Start ${total} players` : `Pick at least ${MIN_PLAYERS}`}
          </button>
        </div>
        {startError && (
          <p className="error" role="alert">
            {startError}
          </p>
        )}
      </div>
    </div>
  );
}
