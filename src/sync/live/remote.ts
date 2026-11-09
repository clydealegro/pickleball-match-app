import type { SupabaseClient } from '@supabase/supabase-js';
import { fail } from '../remote';
import type { LiveBoard } from './board';

export interface LivePublish {
  slotId: string;
  sessionId: string;
  board: LiveBoard;
  /** Grows with every change, so a visitor can ask for only what is new. */
  version: number;
  paused: boolean;
  showPhotos: boolean;
}

export interface LiveFace {
  rosterId: string;
  /** The saved player's photo sequence, so a visitor knows when a face changed. */
  seq: number;
  /** A small JPEG as a data URI. */
  data: string;
}

/** What the organizer's phone asks of the server to run the live board. Every method throws a `RemoteError` when it fails. */
export interface LiveRemote {
  /** Writes the board for a slot, and turns it on. */
  publish(p: LivePublish): Promise<void>;
  /** Marks the board as still being kept up, without changing it. */
  heartbeat(slotId: string, sessionId: string): Promise<void>;
  putFaces(slotId: string, faces: LiveFace[]): Promise<void>;
  removeFaces(slotId: string): Promise<void>;
  /** Turns the board off and takes its faces down. */
  stop(slotId: string): Promise<void>;
}

/** The real server, as the signed-in organizer `ownerId`. */
export function supabaseLiveRemote(client: SupabaseClient, ownerId: string): LiveRemote {
  const removeFaces = async (slotId: string) => {
    const { error, status } = await client.from('live_photos').delete().eq('slot_id', slotId);
    if (error) fail(error, status);
  };
  return {
    async publish(p) {
      const { error, status } = await client.from('live_boards').upsert(
        {
          owner_id: ownerId,
          slot_id: p.slotId,
          session_id: p.sessionId,
          snapshot: p.board,
          version: p.version,
          active: true,
          paused: p.paused,
          show_photos: p.showPhotos,
        },
        { onConflict: 'owner_id,slot_id' },
      );
      if (error) fail(error, status);
    },
    async heartbeat(slotId, sessionId) {
      const { error, status } = await client.from('live_boards').update({ session_id: sessionId }).eq('slot_id', slotId).eq('active', true);
      if (error) fail(error, status);
    },
    async putFaces(slotId, faces) {
      if (faces.length === 0) return;
      const rows = faces.map((f) => ({ owner_id: ownerId, slot_id: slotId, roster_id: f.rosterId, photo_seq: f.seq, data: f.data }));
      const { error, status } = await client.from('live_photos').upsert(rows, { onConflict: 'owner_id,slot_id,roster_id' });
      if (error) fail(error, status);
    },
    removeFaces,
    async stop(slotId) {
      const { error, status } = await client.from('live_boards').update({ active: false }).eq('slot_id', slotId);
      if (error) fail(error, status);
      await removeFaces(slotId);
    },
  };
}
