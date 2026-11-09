import type { PGlite } from '@electric-sql/pglite';
import { run } from '../db/harness';
import { RemoteError } from '../remote';
import type { AttendanceRemote } from './remote';
import type { AttendanceViewData } from './types';

/** Switches and a log a test holds on to. */
export interface FakeFlags {
  /** While true, every request fails the way a request with no connection does. */
  offline: boolean;
  /** What the remote was asked, in order, as `method` or `method:detail`. */
  calls: string[];
}

/**
 * A stand-in for the real server, for tests: the same operations as real SQL, run as the organizer `user` on the
 * in-memory Postgres from `createDb()`, so the migration's rules (row-level security, grants, checks) really apply.
 * A refused statement becomes a `RemoteError('server')`, as a refused request does.
 */
export function fakeAttendanceRemote(db: PGlite, user: string, flags: FakeFlags = { offline: false, calls: [] }): AttendanceRemote {
  const sql = async (call: string | null, text: string, params: unknown[] = []) => {
    if (call) flags.calls.push(call);
    if (flags.offline) throw new RemoteError('offline');
    try {
      return (await run(db, { user }, text, params)).rows as Record<string, unknown>[];
    } catch {
      throw new RemoteError('server');
    }
  };
  return {
    async getLink(slotId) {
      const rows = await sql(`getLink:${slotId}`, 'select code, closed_through::text as closed_through from public.attendance_links where slot_id = $1', [slotId]);
      return rows[0] ? { code: String(rows[0].code), closedThrough: (rows[0].closed_through as string | null) ?? null } : null;
    },
    async upsertLink(row) {
      await sql(
        `upsertLink:${row.slot_id}`,
        `insert into public.attendance_links (owner_id, slot_id, title, weekday, start_min, end_min, venue, courts, timezone)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (owner_id, slot_id) do update set title = excluded.title, weekday = excluded.weekday,
           start_min = excluded.start_min, end_min = excluded.end_min, venue = excluded.venue, courts = excluded.courts,
           timezone = excluded.timezone`,
        [user, row.slot_id, row.title, row.weekday, row.start_min, row.end_min, row.venue, row.courts, row.timezone],
      );
    },
    async view(code) {
      const rows = await sql('view', 'select public.attendance_view($1) as v', [code]);
      return (rows[0]?.v as AttendanceViewData | null) ?? null;
    },
    async listWaiting(slotId, playDate) {
      const rows = await sql(
        `listWaiting:${slotId}:${playDate}`,
        `select id, name, brought_by from public.attendance_guests
         where slot_id = $1 and play_date = $2::date and state = 'pending' order by created_at, id`,
        [slotId, playDate],
      );
      return rows.map((g) => ({ id: String(g.id), name: String(g.name), broughtBy: (g.brought_by as string | null) ?? null }));
    },
    async resetLink(slotId) {
      const rows = await sql(`resetLink:${slotId}`, 'select public.reset_attendance_link($1) as code', [slotId]);
      return typeof rows[0]?.code === 'string' ? rows[0].code : null;
    },
    async cancel(slotId, playDate, reason) {
      await sql(`cancel:${slotId}:${playDate}`, 'delete from public.attendance_cancellations where slot_id = $1 and play_date = $2::date', [slotId, playDate]);
      await sql(
        null,
        'insert into public.attendance_cancellations (owner_id, slot_id, play_date, reason) values ($1, $2, $3::date, $4)',
        [user, slotId, playDate, reason?.trim() || null],
      );
    },
    async undoCancel(slotId, playDate) {
      await sql(`undoCancel:${slotId}:${playDate}`, 'delete from public.attendance_cancellations where slot_id = $1 and play_date = $2::date', [slotId, playDate]);
    },
    async closeThrough(slotId, date) {
      await sql(
        `closeThrough:${slotId}:${date}`,
        `update public.attendance_links set closed_through = $2::date
         where slot_id = $1 and (closed_through is null or closed_through < $2::date)`,
        [slotId, date],
      );
    },
  };
}
