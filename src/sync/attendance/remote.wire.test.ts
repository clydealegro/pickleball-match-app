// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { isRemoteError } from '../remote';
import { linkRow } from './links';
import { supabaseAttendanceRemote } from './remote';

const OWNER = '0a1b2c3d-0000-4000-8000-00000000000a';
const ROW = linkRow({ id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall', courts: 3 }, 'Asia/Manila');

interface Seen {
  method: string;
  url: URL;
  headers: Headers;
  body: string | undefined;
}
let seen: Seen[];
let reply: (request: Seen, index: number) => Response;

/** The real Supabase client, with the network replaced: what the adapter really sends. */
function realRemote() {
  const fetchStub: typeof fetch = async (input, init) => {
    const request = new Request(input as string, init);
    const entry: Seen = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    seen.push(entry);
    return reply(entry, seen.length - 1);
  };
  const client = createClient('http://localhost:54321', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchStub },
  });
  return supabaseAttendanceRemote(client, OWNER);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  seen = [];
  reply = () => json(200, []);
});

describe('what the attendance remote sends', () => {
  it('upserts the link on owner and slot, with no code and no closed date', async () => {
    reply = () => new Response(null, { status: 201 });
    await realRemote().upsertLink(ROW);
    const [call] = seen;
    expect(call.method).toBe('POST');
    expect(call.url.pathname).toBe('/rest/v1/attendance_links');
    expect(call.url.searchParams.get('on_conflict')).toBe('owner_id,slot_id');
    expect(call.headers.get('prefer')).toContain('resolution=merge-duplicates');
    const body = JSON.parse(call.body!);
    expect(body).toEqual({ owner_id: OWNER, ...ROW });
    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('closed_through');
  });

  it('reads one link by slot, asking for the code and the closed date only', async () => {
    reply = () => json(200, [{ code: 'abc', closed_through: '2026-11-10' }]);
    expect(await realRemote().getLink('tue')).toEqual({ code: 'abc', closedThrough: '2026-11-10' });
    const { method, url } = seen[0];
    expect(method).toBe('GET');
    expect(url.pathname).toBe('/rest/v1/attendance_links');
    expect(url.searchParams.get('select')).toBe('code,closed_through');
    expect(url.searchParams.get('slot_id')).toBe('eq.tue');
  });

  it('reads no link as null', async () => {
    reply = () => json(200, []);
    expect(await realRemote().getLink('tue')).toBeNull();
  });

  it('asks the database function for the view, by code', async () => {
    const view = { title: 'Tuesday open play', play_date: '2026-11-10' };
    reply = () => json(200, view);
    expect(await realRemote().view('abc123')).toEqual(view);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url.pathname).toBe('/rest/v1/rpc/attendance_view');
    expect(JSON.parse(seen[0].body!)).toEqual({ p_code: 'abc123' });
  });

  it('reads an unknown code as null', async () => {
    reply = () => json(200, null);
    expect(await realRemote().view('nope')).toBeNull();
  });

  it('lists the pending names for a slot and date, oldest first', async () => {
    reply = () => json(200, [{ id: 'g1', name: 'Zed', brought_by: null }, { id: 'g2', name: 'Fay', brought_by: 'p1' }]);
    expect(await realRemote().listWaiting('tue', '2026-11-10')).toEqual([
      { id: 'g1', name: 'Zed', broughtBy: null },
      { id: 'g2', name: 'Fay', broughtBy: 'p1' },
    ]);
    const { method, url } = seen[0];
    expect(method).toBe('GET');
    expect(url.pathname).toBe('/rest/v1/attendance_guests');
    expect(url.searchParams.get('select')).toBe('id,name,brought_by');
    expect(url.searchParams.get('slot_id')).toBe('eq.tue');
    expect(url.searchParams.get('play_date')).toBe('eq.2026-11-10');
    expect(url.searchParams.get('state')).toBe('eq.pending');
    expect(url.searchParams.get('order')).toBe('created_at.asc');
  });

  it('lists the play-tonight guests the same way as the waiting ones, with the other state', async () => {
    reply = () => json(200, [{ id: 'g2', name: 'Fay', brought_by: 'p1' }]);
    expect(await realRemote().listTonight('tue', '2026-11-10')).toEqual([{ id: 'g2', name: 'Fay', broughtBy: 'p1' }]);
    const { method, url } = seen[0];
    expect(method).toBe('GET');
    expect(url.pathname).toBe('/rest/v1/attendance_guests');
    expect(url.searchParams.get('select')).toBe('id,name,brought_by');
    expect(url.searchParams.get('slot_id')).toBe('eq.tue');
    expect(url.searchParams.get('play_date')).toBe('eq.2026-11-10');
    expect(url.searchParams.get('state')).toBe('eq.play_tonight');
    expect(url.searchParams.get('order')).toBe('created_at.asc');
  });

  it('sets a guest state with an update filtered on the guest id', async () => {
    reply = () => new Response(null, { status: 204 });
    await realRemote().setGuestState('g9', 'play_tonight');
    expect(seen).toHaveLength(1);
    const { method, url, body } = seen[0];
    expect(method).toBe('PATCH');
    expect(url.pathname).toBe('/rest/v1/attendance_guests');
    expect(url.searchParams.get('id')).toBe('eq.g9');
    expect([...url.searchParams.keys()]).toEqual(['id']);
    expect(JSON.parse(body!)).toEqual({ state: 'play_tonight' });
  });

  it('writes each state in the body', async () => {
    reply = () => new Response(null, { status: 204 });
    for (const state of ['play_tonight', 'added', 'dismissed'] as const) await realRemote().setGuestState('g1', state);
    expect(seen.map((c) => JSON.parse(c.body!).state)).toEqual(['play_tonight', 'added', 'dismissed']);
  });

  it('turns a refused guest update into the right error kind', async () => {
    reply = () => json(401, { code: 'PGRST301', message: 'JWT expired' });
    let error = await realRemote().setGuestState('g1', 'added').catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('auth');
    reply = () => json(500, { code: 'XX000', message: 'boom' });
    error = await realRemote().listTonight('tue', '2026-11-10').catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('server');
    error = await realRemote().setGuestState('g1', 'added').catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('server');
  });

  it('resets the link through the database function and returns the new code', async () => {
    reply = () => json(200, 'newcode0123456789abcdef');
    expect(await realRemote().resetLink('tue')).toBe('newcode0123456789abcdef');
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url.pathname).toBe('/rest/v1/rpc/reset_attendance_link');
    expect(JSON.parse(seen[0].body!)).toEqual({ p_slot_id: 'tue' });
  });

  it('reads a reset with no link as null', async () => {
    reply = () => json(200, null);
    expect(await realRemote().resetLink('tue')).toBeNull();
  });

  it('cancels by deleting any row for the date, then inserting one', async () => {
    reply = (_r, i) => (i === 0 ? new Response(null, { status: 204 }) : new Response(null, { status: 201 }));
    await realRemote().cancel('tue', '2026-11-10', 'Rain');
    expect(seen).toHaveLength(2);
    const [del, ins] = seen;
    expect(del.method).toBe('DELETE');
    expect(del.url.pathname).toBe('/rest/v1/attendance_cancellations');
    expect(del.url.searchParams.get('slot_id')).toBe('eq.tue');
    expect(del.url.searchParams.get('play_date')).toBe('eq.2026-11-10');
    expect(ins.method).toBe('POST');
    expect(ins.url.pathname).toBe('/rest/v1/attendance_cancellations');
    expect(ins.url.searchParams.get('on_conflict')).toBeNull();
    expect(ins.headers.get('prefer') ?? '').not.toContain('merge-duplicates');
    expect(JSON.parse(ins.body!)).toEqual({ owner_id: OWNER, slot_id: 'tue', play_date: '2026-11-10', reason: 'Rain' });
  });

  it('writes an empty reason as null', async () => {
    reply = () => new Response(null, { status: 204 });
    await realRemote().cancel('tue', '2026-11-10', '   ');
    expect(JSON.parse(seen[1].body!).reason).toBeNull();
  });

  it('undoes a cancellation by deleting the row for the date', async () => {
    reply = () => new Response(null, { status: 204 });
    await realRemote().undoCancel('tue', '2026-11-10');
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('DELETE');
    expect(seen[0].url.pathname).toBe('/rest/v1/attendance_cancellations');
    expect(seen[0].url.searchParams.get('slot_id')).toBe('eq.tue');
    expect(seen[0].url.searchParams.get('play_date')).toBe('eq.2026-11-10');
  });

  it('closes a date with an update that only moves forward', async () => {
    reply = () => new Response(null, { status: 204 });
    await realRemote().closeThrough('tue', '2026-11-10');
    const { method, url, body } = seen[0];
    expect(method).toBe('PATCH');
    expect(url.pathname).toBe('/rest/v1/attendance_links');
    expect(url.searchParams.get('slot_id')).toBe('eq.tue');
    expect(url.searchParams.get('or')).toBe('(closed_through.is.null,closed_through.lt.2026-11-10)');
    expect(JSON.parse(body!)).toEqual({ closed_through: '2026-11-10' });
  });

  it('turns a dropped connection into an offline error', async () => {
    reply = () => {
      throw new TypeError('Failed to fetch');
    };
    const error = await realRemote().upsertLink(ROW).catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('offline');
  });

  it('turns a rejected session into an auth error, for a read, a write and a function call', async () => {
    reply = () => json(401, { code: 'PGRST301', message: 'JWT expired' });
    for (const call of [
      (r: ReturnType<typeof realRemote>) => r.getLink('tue'),
      (r: ReturnType<typeof realRemote>) => r.upsertLink(ROW),
      (r: ReturnType<typeof realRemote>) => r.view('abc'),
      (r: ReturnType<typeof realRemote>) => r.closeThrough('tue', '2026-11-10'),
    ]) {
      const error = await call(realRemote()).catch((e: unknown) => e);
      expect(isRemoteError(error) && error.kind).toBe('auth');
    }
  });

  it('turns any other failure into a server error', async () => {
    reply = () => json(500, { code: 'XX000', message: 'boom' });
    const error = await realRemote().listWaiting('tue', '2026-11-10').catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('server');
  });
});
