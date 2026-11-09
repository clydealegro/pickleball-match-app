import type { PGlite } from '@electric-sql/pglite';
import { run } from '../sync/db/harness';
import type { AttendanceViewData } from '../sync/attendance/types';
import { MemberError, memberFailure, type MemberRemote } from './remote';

/** Switches and a log a test holds on to. */
export interface MemberFlags {
  /** While true, every request fails the way a request with no connection does. */
  offline: boolean;
  /** What the remote was asked, in order. */
  calls: string[];
}

/**
 * A stand-in for the real server, for tests: the three public functions as real SQL, run as the anonymous role on
 * the in-memory Postgres from `createDb()`, so the migration's rules really apply. A refused call keeps its reason.
 */
export function fakeMemberRemote(db: PGlite, flags: MemberFlags = { offline: false, calls: [] }): MemberRemote {
  const sql = async (call: string, text: string, params: unknown[]) => {
    flags.calls.push(call);
    if (flags.offline) throw new MemberError('offline');
    try {
      return (await run(db, 'anon', text, params)).rows as Record<string, unknown>[];
    } catch (error) {
      throw memberFailure(error as { message?: string; code?: string });
    }
  };
  return {
    async view(code) {
      const rows = await sql(`view:${code}`, 'select public.attendance_view($1) as v', [code]);
      return (rows[0]?.v as AttendanceViewData | null) ?? null;
    },
    async answer(code, playerId, status, late) {
      await sql(`answer:${code}:${playerId}:${status}:${late}`, 'select public.attendance_answer($1, $2, $3, $4)', [code, playerId, status, late]);
    },
    async addGuest(code, name, broughtBy) {
      await sql(`addGuest:${code}:${name}:${broughtBy}`, 'select public.attendance_add_guest($1, $2, $3)', [code, name, broughtBy]);
    },
  };
}
