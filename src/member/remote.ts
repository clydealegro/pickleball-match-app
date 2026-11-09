import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttendanceStatus, AttendanceViewData } from '../sync/attendance/types';
import { asFaces, asLiveReply, type LiveFaceReply, type LiveViewReply } from './liveTypes';

/** The reasons the database raises, plus the two a failed request can be. */
export type MemberReason = 'bad_status' | 'unknown_link' | 'cancelled' | 'unknown_player' | 'bad_name' | 'too_many' | 'offline' | 'server';

const RAISED: readonly string[] = ['bad_status', 'unknown_link', 'cancelled', 'unknown_player', 'bad_name', 'too_many'];

export class MemberError extends Error {
  constructor(readonly reason: MemberReason) {
    super(`Member request failed (${reason})`);
    this.name = 'MemberError';
  }
}

/** True for a `MemberError`, even one made by another copy of this module. */
export function isMemberError(error: unknown): error is MemberError {
  return error instanceof Error && error.name === 'MemberError' && typeof (error as { reason?: unknown }).reason === 'string';
}

/** What the member page asks of the server. Every method throws a `MemberError` when it fails. */
export interface MemberRemote {
  /** What the page shows for a code, or null for an unknown code. */
  view(code: string): Promise<AttendanceViewData | null>;
  answer(code: string, playerId: string, status: AttendanceStatus, late: boolean): Promise<void>;
  /** A friend (with `broughtBy`) or a new member asking to join (null). Waits for the organizer. */
  addGuest(code: string, name: string, broughtBy: string | null): Promise<void>;
  /**
   * The live board for a code, or idle when none is up. With the version the page already has, an unchanged board
   * answers with a few bytes. Left out by a remote that has no live board.
   */
  live?(code: string, since: number | null): Promise<LiveViewReply>;
  /** The faces for a code, minus the ones the page already has, given as "saved player id:photo sequence". */
  liveFaces?(code: string, have: string[]): Promise<LiveFaceReply[]>;
}

interface Failure {
  message?: string;
  code?: string;
  status?: number;
}

const NETWORK = /failed to fetch|network|load failed|fetch failed/i;

/** Reads the reason the database raised (plain text, code P0001), else offline or server. Status 0 is a request that never arrived. */
export function memberFailure(error: Failure, status?: number): MemberError {
  if (error.code === 'P0001' && RAISED.includes(error.message ?? '')) return new MemberError(error.message as MemberReason);
  const code = status ?? error.status;
  const offline = code === 0 || NETWORK.test(error.message ?? '') || (typeof navigator !== 'undefined' && navigator.onLine === false);
  return new MemberError(offline ? 'offline' : 'server');
}

/** The real server, as an anonymous visitor. */
export function supabaseMemberRemote(client: SupabaseClient): MemberRemote {
  return {
    async view(code) {
      const { data, error, status } = await client.rpc('attendance_view', { p_code: code });
      if (error) throw memberFailure(error, status);
      return (data as AttendanceViewData | null) ?? null;
    },
    async answer(code, playerId, status, late) {
      const res = await client.rpc('attendance_answer', { p_code: code, p_player_id: playerId, p_status: status, p_late: late });
      if (res.error) throw memberFailure(res.error, res.status);
    },
    async addGuest(code, name, broughtBy) {
      const { error, status } = await client.rpc('attendance_add_guest', { p_code: code, p_name: name, p_brought_by: broughtBy });
      if (error) throw memberFailure(error, status);
    },
    async live(code, since) {
      const { data, error, status } = await client.rpc('live_view', { p_code: code, p_since: since });
      if (error) throw memberFailure(error, status);
      // An unknown code, or an answer the page does not understand, is the same as no live board.
      return asLiveReply(data) ?? { state: 'idle' };
    },
    async liveFaces(code, have) {
      const { data, error, status } = await client.rpc('live_photos', { p_code: code, p_have: have });
      if (error) throw memberFailure(error, status);
      return asFaces(data);
    },
  };
}
