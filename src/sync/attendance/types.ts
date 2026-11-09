export type AttendanceStatus = 'in' | 'maybe' | 'out';

/** Why a request failed, as the card reports it. The same three kinds as `RemoteFailure`. */
export type Failure = 'offline' | 'auth' | 'server';

/** What `attendance_view` returns for a link code. */
export interface AttendanceViewData {
  title: string;
  weekday: number;
  venue: string | null;
  start_min: number | null;
  end_min: number | null;
  courts: number | null;
  /** The date the link is about, as YYYY-MM-DD. The database decides it. */
  play_date: string;
  cancelled: { reason: string | null } | null;
  players: { id: string; first_name: string; last_initial: string | null; has_photo: boolean; photo_seq: number }[];
  answers: { player_id: string; status: AttendanceStatus; late: boolean }[];
  friends: number;
}

/** A name waiting for the organizer: a new member asking to join, or a friend someone is bringing. */
export interface WaitingName {
  id: string;
  name: string;
  broughtBy: string | null;
}

/** What the Home card shows for one slot. */
export interface Summary {
  slotId: string;
  code: string;
  playDate: string;
  cancelled: { reason: string | null } | null;
  counts: { in: number; maybe: number; out: number; late: number };
  friends: number;
  waiting: WaitingName[];
  /** Friends the organizer said will play tonight. */
  tonight: WaitingName[];
  /** Players whose answer is In and who said they are late. */
  lateIds: string[];
  answers: Record<string, AttendanceStatus>;
  /** Display first name by player id, with a last initial when two players share a first name. */
  names: Record<string, string>;
  /** When this summary was fetched, in ms. */
  fetchedAt: number;
}

/** The columns the client writes on a link. Never `code` or `closed_through`. */
export interface LinkRow {
  slot_id: string;
  title: string;
  weekday: number;
  start_min: number | null;
  end_min: number | null;
  venue: string | null;
  courts: number | null;
  timezone: string;
}

/** The latest answer that changed, for the "Ben changed to Out" line. */
export interface ChangeNote {
  player: string;
  from: AttendanceStatus;
  to: AttendanceStatus;
  at: number;
}
