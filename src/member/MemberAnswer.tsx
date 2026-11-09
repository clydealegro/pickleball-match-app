import { useState } from 'react';
import type { AttendanceStatus, AttendanceViewData } from '../sync/attendance/types';
import { displayNames } from '../sync/attendance/links';
import { downloadFile } from './download';
import { busyLine, dateLabel, statusLine } from './format';
import { calendarFile } from './ics';
import { FriendSheet } from './MemberSheets';
import { MemberTile } from './MemberTile';
import type { ActionResult } from './useMemberPage';

const FACES = 12;

interface MemberAnswerProps {
  view: AttendanceViewData;
  /** The player id of the member. */
  me: string;
  busy: boolean;
  message: { text: string; ok: boolean } | null;
  onAnswer: (status: AttendanceStatus, late?: boolean) => void;
  onForget: () => void;
  onAddFriend: (name: string) => Promise<ActionResult>;
}

const BUTTONS: { status: AttendanceStatus; label: string }[] = [
  { status: 'in', label: 'In' },
  { status: 'maybe', label: 'Maybe' },
  { status: 'out', label: 'Out' },
];

/** Screen 2: answer In, Maybe or Out, and see who is coming. Never shows who is out. */
export function MemberAnswer({ view, me, busy, message, onAnswer, onForget, onAddFriend }: MemberAnswerProps) {
  const [friend, setFriend] = useState(false);
  const names = displayNames(view.players);
  const mine = view.answers.find((a) => a.player_id === me);
  const first = view.players.find((p) => p.id === me)?.first_name ?? '';
  const onRoster = new Set(view.players.map((p) => p.id));
  const status = new Map(view.answers.filter((a) => onRoster.has(a.player_id)).map((a) => [a.player_id, a.status]));
  const inPeople = view.players.filter((p) => status.get(p.id) === 'in');
  const maybe = [...status.values()].filter((s) => s === 'maybe').length;
  const busyText = busyLine(view);
  const lateOn = mine?.status === 'in' && mine.late;

  return (
    <div className="member-section">
      <div className="member-greet">
        <h2 className="member-heading">Hi {first}</h2>
        <button type="button" className="member-link" onClick={onForget}>
          Not {first}?
        </button>
      </div>
      {mine && (
        <p className="member-banner" role="status">
          {statusLine(mine.status, dateLabel(view.play_date))}
        </p>
      )}
      <div className="member-answers">
        {BUTTONS.map(({ status: s, label }) => (
          <button
            key={s}
            type="button"
            className={`member-answer member-answer-${s}`}
            aria-pressed={mine?.status === s}
            disabled={busy}
            // Tapping In again keeps the late mark.
            onClick={() => (s === 'in' ? onAnswer('in', lateOn) : onAnswer(s))}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="member-chips">
        <button type="button" className="member-chip" aria-pressed={lateOn} disabled={busy} onClick={() => onAnswer('in', !lateOn)}>
          I'll arrive late
        </button>
        <button type="button" className="member-chip" disabled={busy} onClick={() => setFriend(true)}>
          Bring a friend
        </button>
      </div>
      {message && (
        <p className="member-message" role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      <section className="member-section" aria-labelledby="member-in">
        <div className="member-section-head">
          <h3 id="member-in" className="member-heading">
            In
          </h3>
          {inPeople.length > 0 && <span>{inPeople.length === 1 ? '1 person' : `${inPeople.length} people`}</span>}
        </div>
        {inPeople.length === 0 ? (
          <p className="member-note">Nobody yet.</p>
        ) : (
          <ul className="member-faces">
            {inPeople.slice(0, FACES).map((p) => (
              <li key={p.id} className="member-face">
                <MemberTile name={names[p.id]} size="sm" />
                <span className="member-face-name">{names[p.id]}</span>
              </li>
            ))}
            {inPeople.length > FACES && (
              <li className="member-face">
                <span className="member-face-name">+{inPeople.length - FACES} more</span>
              </li>
            )}
          </ul>
        )}
      </section>
      {maybe > 0 && <p className="member-line">{maybe} maybe</p>}
      {view.friends > 0 && <p className="member-line">Plus {view.friends} {view.friends === 1 ? 'friend' : 'friends'}</p>}
      {busyText && <p className="member-busy">{busyText}</p>}
      <button
        type="button"
        className="member-calendar"
        onClick={() => {
          const file = calendarFile(view);
          downloadFile(file.name, file.text);
        }}
      >
        Add to calendar
      </button>
      {friend && <FriendSheet onSubmit={onAddFriend} onClose={() => setFriend(false)} />}
    </div>
  );
}
