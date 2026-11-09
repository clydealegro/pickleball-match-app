// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { isMemberError, supabaseMemberRemote, type MemberReason } from './remote';

const ANA = '11111111-1111-4111-8111-111111111111';
const KEY = 'sb_publishable_test';

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
  const client = createClient('http://localhost:54321', KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchStub },
  });
  return supabaseMemberRemote(client);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const raised = (reason: string) => json(400, { code: 'P0001', details: null, hint: null, message: reason });

const reasonOf = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  return isMemberError(error) ? error.reason : `not a MemberError: ${String(error)}`;
};

const calls: [string, (r: ReturnType<typeof realRemote>) => Promise<unknown>][] = [
  ['view', (r) => r.view('abc')],
  ['answer', (r) => r.answer('abc', ANA, 'in', false)],
  ['addGuest', (r) => r.addGuest('abc', 'Zed', null)],
];

beforeEach(() => {
  seen = [];
  reply = () => json(200, null);
});

describe('what the member remote sends', () => {
  it('asks the database function for the view, by code', async () => {
    const view = { title: 'Tuesday open play', play_date: '2026-11-10' };
    reply = () => json(200, view);
    expect(await realRemote().view('abc123')).toEqual(view);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url.pathname).toBe('/rest/v1/rpc/attendance_view');
    expect(JSON.parse(seen[0].body!)).toEqual({ p_code: 'abc123' });
  });

  it('reads an unknown code as null', async () => {
    reply = () => json(200, null);
    expect(await realRemote().view('nope')).toBeNull();
  });

  it('sends an answer with the player, the status and the late flag', async () => {
    reply = () => json(200, { play_date: '2026-11-10', status: 'in', late: true });
    await realRemote().answer('abc123', ANA, 'in', true);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url.pathname).toBe('/rest/v1/rpc/attendance_answer');
    expect(JSON.parse(seen[0].body!)).toEqual({ p_code: 'abc123', p_player_id: ANA, p_status: 'in', p_late: true });
  });

  it('sends late false as false, not as a missing field', async () => {
    await realRemote().answer('abc123', ANA, 'maybe', false);
    expect(JSON.parse(seen[0].body!)).toEqual({ p_code: 'abc123', p_player_id: ANA, p_status: 'maybe', p_late: false });
  });

  it('sends a friend with the member who brings them', async () => {
    reply = () => json(200, { id: 'g1', play_date: '2026-11-10' });
    await realRemote().addGuest('abc123', 'Zed Zane', ANA);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url.pathname).toBe('/rest/v1/rpc/attendance_add_guest');
    expect(JSON.parse(seen[0].body!)).toEqual({ p_code: 'abc123', p_name: 'Zed Zane', p_brought_by: ANA });
  });

  it('sends a new member asking to join with p_brought_by null', async () => {
    await realRemote().addGuest('abc123', 'Newbie', null);
    expect(JSON.parse(seen[0].body!)).toEqual({ p_code: 'abc123', p_name: 'Newbie', p_brought_by: null });
  });

  it('sends the publishable key and no signed-in session, on every call', async () => {
    for (const [, call] of calls) await call(realRemote());
    expect(seen).toHaveLength(3);
    for (const s of seen) {
      expect(s.headers.get('apikey')).toBe(KEY);
      expect(s.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    }
  });

  it('makes one request for each call', async () => {
    for (const [, call] of calls) await call(realRemote());
    expect(seen.map((s) => s.url.pathname)).toEqual([
      '/rest/v1/rpc/attendance_view',
      '/rest/v1/rpc/attendance_answer',
      '/rest/v1/rpc/attendance_add_guest',
    ]);
  });
});

describe('what the member remote makes of a failure', () => {
  const reasons: MemberReason[] = ['bad_status', 'unknown_link', 'cancelled', 'unknown_player', 'bad_name', 'too_many'];

  it.each(reasons)('keeps the reason %s for every call', async (reason) => {
    reply = () => raised(reason);
    for (const [, call] of calls) expect(await reasonOf(call(realRemote()))).toBe(reason);
  });

  it('says server for a P0001 text it does not know', async () => {
    reply = () => raised('something_else');
    expect(await reasonOf(realRemote().answer('abc', ANA, 'in', false))).toBe('server');
  });

  it('says server for a known reason word that did not come from the database rule', async () => {
    reply = () => json(400, { code: '22P02', message: 'cancelled' });
    expect(await reasonOf(realRemote().answer('abc', ANA, 'in', false))).toBe('server');
  });

  it('says server for a 500', async () => {
    reply = () => json(500, { code: 'XX000', message: 'boom' });
    for (const [, call] of calls) expect(await reasonOf(call(realRemote()))).toBe('server');
  });

  it('says server for a 401, never signed out', async () => {
    reply = () => json(401, { code: 'PGRST301', message: 'JWT expired' });
    for (const [, call] of calls) expect(await reasonOf(call(realRemote()))).toBe('server');
  });

  it('says offline for a dropped connection', async () => {
    reply = () => {
      throw new TypeError('Failed to fetch');
    };
    for (const [, call] of calls) expect(await reasonOf(call(realRemote()))).toBe('offline');
  });

  it('says offline when the browser reports no connection, even for a server error', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
    try {
      reply = () => json(500, { code: 'XX000', message: 'boom' });
      expect(await reasonOf(realRemote().view('abc'))).toBe('offline');
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  it('never carries the raw database error in the error message', async () => {
    reply = () => json(400, { code: 'P0001', message: 'unknown_link', details: 'secret detail', hint: 'secret hint' });
    const error = await realRemote().view('abc').catch((e: unknown) => e);
    expect(isMemberError(error)).toBe(true);
    expect((error as Error).message).toBe('Member request failed (unknown_link)');
  });
});
