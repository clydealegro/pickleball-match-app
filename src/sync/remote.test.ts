import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_BUCKET, RemoteError, isRemoteError, photoFolder, photoPath, supabaseRemote } from './remote';
import type { PushRow } from './rows';

const OWNER = '0a1b2c3d-0000-4000-8000-00000000000a';
const ROW: PushRow = { id: 'p1', name: 'Ann', photo_version: 0, photo_seq: 0, last_played_at: null, deleted_at: null };

type Reply = { data?: unknown; error?: Record<string, unknown> | null; status?: number };

/** A stand-in for the part of the Supabase client the adapter uses. It records every call the adapter makes. */
function fakeClient(replies: { table?: (ops: string[]) => Reply; storage?: Record<string, Reply | (() => Reply)> }) {
  const calls: string[] = [];
  const from = vi.fn((table: string) => {
    const ops: string[] = [`from(${table})`];
    const builder: Record<string, unknown> = {};
    for (const method of ['upsert', 'select', 'is', 'gte', 'order', 'range']) {
      builder[method] = (...args: unknown[]) => {
        ops.push(`${method}(${args.map((a) => JSON.stringify(a)).join(',')})`);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => void) => {
      calls.push(ops.join('.'));
      const reply = replies.table?.(ops) ?? {};
      resolve({ data: reply.data ?? null, error: reply.error ?? null, status: reply.status ?? 200 });
    };
    return builder;
  });
  const storageCalls: { bucket: string; method: string; args: unknown[] }[] = [];
  const storage = {
    from: (bucket: string) =>
      Object.fromEntries(
        ['upload', 'download', 'list', 'remove'].map((method) => [
          method,
          async (...args: unknown[]) => {
            storageCalls.push({ bucket, method, args });
            const reply = replies.storage?.[method];
            const value = (typeof reply === 'function' ? reply() : reply) ?? {};
            return { data: value.data ?? null, error: value.error ?? null };
          },
        ]),
      ),
  };
  return { client: { from, storage } as unknown as SupabaseClient, calls, storageCalls };
}

const kind = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return isRemoteError(error) ? error.kind : 'other';
  }
  return 'none';
};

afterEach(() => vi.unstubAllGlobals());

describe('paths', () => {
  it('puts a photo at {owner}/{player}/{seq}.jpg with the owner in lower case', () => {
    expect(photoFolder(OWNER.toUpperCase(), 'P1')).toBe(`${OWNER}/p1`);
    expect(photoPath(OWNER.toUpperCase(), 'p1', 4)).toBe(`${OWNER}/p1/4.jpg`);
  });
});

describe('pushing a player', () => {
  it('upserts one row with the owner, on the primary key', async () => {
    const { client, calls } = fakeClient({});
    expect(await supabaseRemote(client, OWNER).upsertPlayer(ROW)).toBe('ok');
    expect(calls).toEqual([`from(players).upsert(${JSON.stringify({ owner_id: OWNER, ...ROW })},{"onConflict":"owner_id,id"})`]);
  });

  it('says nameTaken for a unique violation, and fails for anything else', async () => {
    const taken = fakeClient({ table: () => ({ error: { code: '23505', message: 'duplicate key' }, status: 409 }) });
    expect(await supabaseRemote(taken.client, OWNER).upsertPlayer(ROW)).toBe('nameTaken');
    const other = fakeClient({ table: () => ({ error: { code: '42501', message: 'row-level security' }, status: 403 }) });
    expect(await kind(supabaseRemote(other.client, OWNER).upsertPlayer(ROW))).toBe('server');
  });

  it('tells a missing connection and a rejected session from a server fault', async () => {
    const offline = fakeClient({ table: () => ({ error: { message: 'TypeError: Failed to fetch' }, status: 0 }) });
    expect(await kind(supabaseRemote(offline.client, OWNER).upsertPlayer(ROW))).toBe('offline');
    const noStatus = fakeClient({ table: () => ({ error: { message: 'NetworkError when attempting to fetch resource.' }, status: 500 }) });
    expect(await kind(supabaseRemote(noStatus.client, OWNER).upsertPlayer(ROW))).toBe('offline');
    const expired = fakeClient({ table: () => ({ error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 }) });
    expect(await kind(supabaseRemote(expired.client, OWNER).upsertPlayer(ROW))).toBe('auth');
    const bare401 = fakeClient({ table: () => ({ error: { message: 'x' }, status: 401 }) });
    expect(await kind(supabaseRemote(bare401.client, OWNER).upsertPlayer(ROW))).toBe('auth');
    const broken = fakeClient({ table: () => ({ error: { message: 'boom' }, status: 500 }) });
    expect(await kind(supabaseRemote(broken.client, OWNER).upsertPlayer(ROW))).toBe('server');
    vi.stubGlobal('navigator', { onLine: false });
    expect(await kind(supabaseRemote(broken.client, OWNER).upsertPlayer(ROW))).toBe('offline');
  });

  it('never shows the server\'s own wording', async () => {
    const { client } = fakeClient({ table: () => ({ error: { message: 'secret detail' }, status: 500 }) });
    const error = await supabaseRemote(client, OWNER).upsertPlayer(ROW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RemoteError);
    expect((error as Error).message).not.toContain('secret');
  });
});

describe('reading players', () => {
  it('asks for everything, oldest write first, when there is no cursor', async () => {
    const { client, calls } = fakeClient({ table: () => ({ data: [{ id: 'a' }] }) });
    expect(await supabaseRemote(client, OWNER).pull(undefined)).toEqual([{ id: 'a' }]);
    expect(calls).toEqual(['from(players).select("*").order("updated_at",{"ascending":true}).order("id",{"ascending":true}).range(0,499)']);
  });

  it('asks only for rows written at or after the time given', async () => {
    const { client, calls } = fakeClient({ table: () => ({ data: [] }) });
    await supabaseRemote(client, OWNER).pull('2026-11-06T10:00:00.000Z');
    expect(calls[0]).toContain('.select("*").gte("updated_at","2026-11-06T10:00:00.000Z").order("updated_at"');
  });

  it('reads long lists a page at a time', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i) }));
    const { client, calls } = fakeClient({ table: (ops) => ({ data: ops.some((o) => o === 'range(0,499)') ? page(500) : page(2) }) });
    expect(await supabaseRemote(client, OWNER).pull(undefined)).toHaveLength(502);
    expect(calls.map((c) => c.slice(c.indexOf('range')))).toEqual(['range(0,499)', 'range(500,999)']);
  });

  it('lists the players that are not deleted', async () => {
    const { client, calls } = fakeClient({ table: () => ({ data: [] }) });
    await supabaseRemote(client, OWNER).listLive();
    expect(calls[0]).toBe('from(players).select("*").is("deleted_at",null).order("id").range(0,499)');
  });

  it('fails when a page fails', async () => {
    const { client } = fakeClient({ table: () => ({ error: { message: 'boom' }, status: 500 }) });
    expect(await kind(supabaseRemote(client, OWNER).pull(undefined))).toBe('server');
    expect(await kind(supabaseRemote(client, OWNER).listLive())).toBe('server');
  });
});

describe('photo files', () => {
  const photo = { type: 'image/jpeg', data: new Uint8Array([1, 2, 3]).buffer };

  it('uploads a JPEG to the private bucket without replacing anything', async () => {
    const { client, storageCalls } = fakeClient({});
    await supabaseRemote(client, OWNER).uploadPhoto(`${OWNER}/p1/1.jpg`, photo);
    expect(storageCalls).toHaveLength(1);
    const [call] = storageCalls;
    expect([call.bucket, call.method, call.args[0], call.args[2]]).toEqual([
      PHOTO_BUCKET,
      'upload',
      `${OWNER}/p1/1.jpg`,
      { contentType: 'image/jpeg', upsert: false },
    ]);
    const body = call.args[1] as Blob;
    expect(body.type).toBe('image/jpeg');
    expect(body.size).toBe(3);
  });

  it('counts a file that is already there as uploaded, and fails for other errors', async () => {
    const exists = fakeClient({ storage: { upload: { error: { status: 409, statusCode: '409', code: 'ResourceAlreadyExists', message: 'The resource already exists' } } } });
    await expect(supabaseRemote(exists.client, OWNER).uploadPhoto('x/y/1.jpg', photo)).resolves.toBeUndefined();
    const bad = fakeClient({ storage: { upload: { error: { status: 413, message: 'too big' } } } });
    expect(await kind(supabaseRemote(bad.client, OWNER).uploadPhoto('x/y/1.jpg', photo))).toBe('server');
    const offline = fakeClient({ storage: { upload: { error: { message: 'Failed to fetch' } } } });
    expect(await kind(supabaseRemote(offline.client, OWNER).uploadPhoto('x/y/1.jpg', photo))).toBe('offline');
  });

  it('downloads the bytes, and says null for a file that is not there', async () => {
    const ok = fakeClient({ storage: { download: { data: { arrayBuffer: async () => new Uint8Array([4, 5]).buffer } } } });
    expect([...new Uint8Array((await supabaseRemote(ok.client, OWNER).downloadPhoto('x/y/1.jpg'))!)]).toEqual([4, 5]);
    for (const error of [{ status: 404, message: 'x' }, { status: 400, statusCode: '404', message: 'Object not found' }, { code: 'NoSuchKey', message: 'x' }]) {
      const missing = fakeClient({ storage: { download: { error } } });
      expect(await supabaseRemote(missing.client, OWNER).downloadPhoto('x/y/1.jpg')).toBeNull();
    }
    const bad = fakeClient({ storage: { download: { error: { status: 500, message: 'boom' } } } });
    expect(await kind(supabaseRemote(bad.client, OWNER).downloadPhoto('x/y/1.jpg'))).toBe('server');
  });

  it('lists the files in a folder', async () => {
    const { client, storageCalls } = fakeClient({ storage: { list: { data: [{ name: '1.jpg' }, { name: '2.jpg' }] } } });
    expect(await supabaseRemote(client, OWNER).listPhotoFiles(`${OWNER}/p1`)).toEqual(['1.jpg', '2.jpg']);
    expect(storageCalls[0].args).toEqual([`${OWNER}/p1`, { limit: 100 }]);
    const bad = fakeClient({ storage: { list: { error: { status: 500, message: 'x' } } } });
    expect(await kind(supabaseRemote(bad.client, OWNER).listPhotoFiles('x'))).toBe('server');
  });

  it('removes files, and makes no request when there is nothing to remove', async () => {
    const { client, storageCalls } = fakeClient({});
    await supabaseRemote(client, OWNER).removePhotoFiles([]);
    expect(storageCalls).toEqual([]);
    await supabaseRemote(client, OWNER).removePhotoFiles(['a/b/1.jpg']);
    expect(storageCalls.map((c) => [c.method, c.args])).toEqual([['remove', [['a/b/1.jpg']]]]);
    const bad = fakeClient({ storage: { remove: { error: { status: 500, message: 'x' } } } });
    expect(await kind(supabaseRemote(bad.client, OWNER).removePhotoFiles(['a']))).toBe('server');
  });
});
