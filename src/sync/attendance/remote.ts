import type { SupabaseClient } from '@supabase/supabase-js';
import { fail } from '../remote';
import type { AttendanceViewData, LinkRow, WaitingName } from './types';

/** What the organizer's attendance link asks of the server. Every method throws a `RemoteError` when it fails. */
export interface AttendanceRemote {
  /** The link of this slot, or null when there is none. */
  getLink(slotId: string): Promise<{ code: string; closedThrough: string | null } | null>;
  /** Creates the link, or updates what the slot shows. Never sends or changes the code or the closed date. */
  upsertLink(row: LinkRow): Promise<void>;
  /** What the public page shows for a code, or null for an unknown code. */
  view(code: string): Promise<AttendanceViewData | null>;
  /** Names waiting for the organizer on a date. Pending ones only. */
  listWaiting(slotId: string, playDate: string): Promise<WaitingName[]>;
  /** A new code for the slot's link, or null when there is no link. */
  resetLink(slotId: string): Promise<string | null>;
  /** Cancels a date, replacing any earlier cancellation and its reason. */
  cancel(slotId: string, playDate: string, reason: string | null): Promise<void>;
  undoCancel(slotId: string, playDate: string): Promise<void>;
  /** Closes the link through a date. Only ever moves forward. */
  closeThrough(slotId: string, date: string): Promise<void>;
}

/** The real server, as the signed-in organizer `ownerId`. */
export function supabaseAttendanceRemote(client: SupabaseClient, ownerId: string): AttendanceRemote {
  return {
    async getLink(slotId) {
      const { data, error, status } = await client.from('attendance_links').select('code,closed_through').eq('slot_id', slotId).maybeSingle();
      if (error) fail(error, status);
      return data ? { code: String(data.code), closedThrough: (data.closed_through as string | null) ?? null } : null;
    },
    async upsertLink(row) {
      const { error, status } = await client.from('attendance_links').upsert({ owner_id: ownerId, ...row }, { onConflict: 'owner_id,slot_id' });
      if (error) fail(error, status);
    },
    async view(code) {
      const { data, error, status } = await client.rpc('attendance_view', { p_code: code });
      if (error) fail(error, status);
      return (data as AttendanceViewData | null) ?? null;
    },
    async listWaiting(slotId, playDate) {
      const { data, error, status } = await client
        .from('attendance_guests')
        .select('id,name,brought_by')
        .eq('slot_id', slotId)
        .eq('play_date', playDate)
        .eq('state', 'pending')
        .order('created_at', { ascending: true });
      if (error) fail(error, status);
      return (data ?? []).map((g) => ({ id: String(g.id), name: String(g.name), broughtBy: (g.brought_by as string | null) ?? null }));
    },
    async resetLink(slotId) {
      const { data, error, status } = await client.rpc('reset_attendance_link', { p_slot_id: slotId });
      if (error) fail(error, status);
      return typeof data === 'string' ? data : null;
    },
    async cancel(slotId, playDate, reason) {
      // The database lets an organizer delete and insert a cancellation but not update one, so this is not an upsert.
      const removed = await client.from('attendance_cancellations').delete().eq('slot_id', slotId).eq('play_date', playDate);
      if (removed.error) fail(removed.error, removed.status);
      const { error, status } = await client
        .from('attendance_cancellations')
        .insert({ owner_id: ownerId, slot_id: slotId, play_date: playDate, reason: reason?.trim() || null });
      if (error) fail(error, status);
    },
    async undoCancel(slotId, playDate) {
      const { error, status } = await client.from('attendance_cancellations').delete().eq('slot_id', slotId).eq('play_date', playDate);
      if (error) fail(error, status);
    },
    async closeThrough(slotId, date) {
      const { error, status } = await client
        .from('attendance_links')
        .update({ closed_through: date })
        .eq('slot_id', slotId)
        .or(`closed_through.is.null,closed_through.lt.${date}`);
      if (error) fail(error, status);
    },
  };
}
