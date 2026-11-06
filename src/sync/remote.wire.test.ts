// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { isRemoteError, supabaseRemote } from './remote';
import type { PushRow } from './rows';

const OWNER = '0a1b2c3d-0000-4000-8000-00000000000a';
const ROW: PushRow = { id: 'p1', name: 'Ann', photo_version: 1, photo_seq: 2, last_played_at: null, deleted_at: null };

interface Seen {
  method: string;
  url: URL;
  headers: Headers;
  body: string | FormData | undefined;
}
let seen: Seen[];
let reply: (request: Seen) => Response;

/** The real Supabase client, with the network replaced: what the adapter really sends, and how it reads real replies. */
function realClient() {
  const fetchStub: typeof fetch = async (input, init) => {
    const request = new Request(input as string, init);
    const body = init?.body;
    const entry: Seen = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body: typeof body === 'string' || body instanceof FormData ? body : undefined,
    };
    seen.push(entry);
    return reply(entry);
  };
  const client = createClient('http://localhost:54321', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchStub },
  });
  return supabaseRemote(client, OWNER);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  seen = [];
  reply = () => json(200, []);
});

describe('what the adapter sends to the real client library', () => {
  it('upserts one row on the primary key and merges duplicates', async () => {
    reply = () => new Response(null, { status: 201 });
    expect(await realClient().upsertPlayer(ROW)).toBe('ok');
    const [call] = seen;
    expect(call.method).toBe('POST');
    expect(call.url.pathname).toBe('/rest/v1/players');
    expect(call.url.searchParams.get('on_conflict')).toBe('owner_id,id');
    expect(call.headers.get('prefer')).toContain('resolution=merge-duplicates');
    expect(JSON.parse(call.body as string)).toEqual({ owner_id: OWNER, ...ROW });
  });

  it('reads the unique name violation from a real error reply', async () => {
    reply = () => json(409, { code: '23505', message: 'duplicate key value violates unique constraint', details: null, hint: null });
    expect(await realClient().upsertPlayer(ROW)).toBe('nameTaken');
  });

  it('asks for rows from a time on, oldest first, a page at a time', async () => {
    await realClient().pull('2026-11-06T10:00:00.000Z');
    const { url, method } = seen[0];
    expect(method).toBe('GET');
    expect(url.pathname).toBe('/rest/v1/players');
    expect(url.searchParams.get('select')).toBe('*');
    expect(url.searchParams.get('updated_at')).toBe('gte.2026-11-06T10:00:00.000Z');
    expect(url.searchParams.get('order')).toBe('updated_at.asc,id.asc');
    expect([url.searchParams.get('offset'), url.searchParams.get('limit')]).toEqual(['0', '500']);
  });

  it('asks for the players that are not deleted', async () => {
    await realClient().listLive();
    expect(seen[0].url.searchParams.get('deleted_at')).toBe('is.null');
  });

  it('turns a dropped connection into an offline error', async () => {
    reply = () => {
      throw new TypeError('Failed to fetch');
    };
    const error = await realClient().upsertPlayer(ROW).catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('offline');
  });

  it('turns a rejected session into an auth error', async () => {
    reply = () => json(401, { code: 'PGRST301', message: 'JWT expired' });
    const error = await realClient().pull(undefined).catch((e: unknown) => e);
    expect(isRemoteError(error) && error.kind).toBe('auth');
  });

  it('uploads a JPEG without replacing, and counts "already exists" as done', async () => {
    reply = () => json(200, { Key: 'player-photos/x/y/1.jpg' });
    await realClient().uploadPhoto('x/y/1.jpg', { type: 'image/jpeg', data: new Uint8Array([1, 2, 3]).buffer });
    const call = seen[0];
    expect(call.method).toBe('POST');
    expect(call.url.pathname).toBe('/storage/v1/object/player-photos/x/y/1.jpg');
    expect(call.headers.get('x-upsert')).toBe('false');

    reply = () => json(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    await expect(realClient().uploadPhoto('x/y/1.jpg', { type: 'image/jpeg', data: new ArrayBuffer(1) })).resolves.toBeUndefined();
  });

  it('downloads the bytes, and reads a missing file as null whichever way the server says so', async () => {
    reply = () => new Response(new Uint8Array([7, 8]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    const bytes = await realClient().downloadPhoto('x/y/1.jpg');
    expect([...new Uint8Array(bytes!)]).toEqual([7, 8]);
    expect(seen[0].url.pathname).toBe('/storage/v1/object/player-photos/x/y/1.jpg');

    for (const status of [400, 404]) {
      reply = () => json(status, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      expect(await realClient().downloadPhoto('x/y/1.jpg')).toBeNull();
    }
  });

  it('lists the files of a folder and removes files by path', async () => {
    reply = () => json(200, [{ name: '1.jpg' }, { name: '2.jpg' }]);
    expect(await realClient().listPhotoFiles('x/y')).toEqual(['1.jpg', '2.jpg']);
    expect(seen[0].url.pathname).toBe('/storage/v1/object/list/player-photos');
    expect(JSON.parse(seen[0].body as string)).toMatchObject({ prefix: 'x/y', limit: 100 });

    reply = () => json(200, []);
    await realClient().removePhotoFiles(['x/y/1.jpg']);
    expect(seen[1].method).toBe('DELETE');
    expect(seen[1].url.pathname).toBe('/storage/v1/object/player-photos');
    expect(JSON.parse(seen[1].body as string)).toEqual({ prefixes: ['x/y/1.jpg'] });
  });
});
