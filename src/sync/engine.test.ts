// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PhotoData } from '../store/rosterDb';
import { USER_A, USER_B } from './db/harness';
import { createDevice, type Device } from './device';
import { createFakeServer, type FakeServer } from './fakeServer';

let server: FakeServer;
let a: Device;
let b: Device;

beforeAll(async () => {
  server = await createFakeServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await server.db.exec('truncate public.players cascade');
  server.files.clear();
  server.calls.length = 0;
  server.offline = false;
  server.downloadsOffline = false;
  server.refuse.clear();
  a = await createDevice();
  b = await createDevice();
});

const jpeg = (...bytes: number[]): PhotoData => ({ type: 'image/jpeg', data: new Uint8Array(bytes).buffer });
const bytesOf = (photo: PhotoData | undefined) => (photo ? [...new Uint8Array(photo.data)] : undefined);
const syncA = () => a.engine.syncOnce(server.remote(USER_A), USER_A);
const syncB = () => b.engine.syncOnce(server.remote(USER_A), USER_A);
const names = async (device: Device) => (await device.roster.listRoster()).map((p) => p.name);

async function serverRows() {
  const { rows } = await server.db.query(
    `select name, photo_version, photo_seq, deleted_at is not null as deleted, last_played_at from public.players order by name, id`,
  );
  return rows as { name: string; photo_version: number; photo_seq: number; deleted: boolean; last_played_at: Date | null }[];
}
const live = async () => (await serverRows()).filter((r) => !r.deleted).map((r) => r.name);
const filesOf = () => [...server.files.keys()].sort();

describe('pushing', () => {
  it('sends every saved player on the first sync, with their photo, and clears the marks', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1, 2, 3));
    const ben = await a.roster.addRosterPlayer('Ben');
    await a.roster.deleteRosterPlayer(ben.id);

    expect(await syncA()).toEqual({ ok: true, pushed: 2, pulled: 0, skippedRows: 0, pending: 0 });

    expect((await serverRows()).map((r) => [r.name, r.photo_version, r.photo_seq, r.deleted])).toEqual([
      ['Ann', 1, 1, false],
      ['Ben', 0, 0, true],
    ]);
    expect(filesOf()).toEqual([`${USER_A}/${ann.id}/1.jpg`]);
    expect(await a.roster.listOutbox()).toEqual([]);
  });

  it('marks players that were saved before the first sign-in, even if they never changed since', async () => {
    // Saved with no sync engine running, as every install of the app before this one did.
    await a.roster.addRosterPlayer('Ann');
    await a.roster.ackOutbox((await a.roster.listOutbox())[0].playerId, (await a.roster.listOutbox())[0].rev);
    expect(await a.roster.listOutbox()).toEqual([]);
    await syncA();
    expect(await live()).toEqual(['Ann']);
  });

  it('sends nothing when nothing changed, and only a pull', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    server.calls.length = 0;
    expect(await syncA()).toEqual({ ok: true, pushed: 0, pulled: 0, skippedRows: 0, pending: 0 });
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toMatch(/^pull:/);
  });

  it('sends a rename and a played time without uploading the unchanged photo again', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    await a.roster.renameRosterPlayer(ann.id, 'Annie');
    await a.roster.markRosterPlayed([ann.id], Date.UTC(2026, 10, 7, 9));
    server.calls.length = 0;
    await syncA();
    expect(server.calls.some((c) => c.startsWith('uploadPhoto'))).toBe(false);
    const [row] = await serverRows();
    expect(row.name).toBe('Annie');
    expect(row.last_played_at?.toISOString()).toBe('2026-11-07T09:00:00.000Z');
  });

  it('uploads a new photo under a new path and deletes the one it replaces', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    await a.roster.setRosterPhoto(ann.id, jpeg(2));
    await syncA();
    expect(filesOf()).toEqual([`${USER_A}/${ann.id}/2.jpg`]);
    expect((await serverRows())[0]).toMatchObject({ photo_version: 2, photo_seq: 2 });
  });

  it('removes the file when the photo is removed, and a photo added again never reuses the path', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    await a.roster.removeRosterPhoto(ann.id);
    await syncA();
    expect(filesOf()).toEqual([]);
    expect((await serverRows())[0]).toMatchObject({ photo_version: 0, photo_seq: 1 });
    await a.roster.setRosterPhoto(ann.id, jpeg(3));
    await syncA();
    expect(filesOf()).toEqual([`${USER_A}/${ann.id}/2.jpg`]);
  });

  it('removes every photo file of a deleted player, and marks the row deleted', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    await a.roster.deleteRosterPlayer(ann.id);
    await syncA();
    expect(filesOf()).toEqual([]);
    expect((await serverRows())[0].deleted).toBe(true);
  });

  it('lets a name be used again after the player who had it was deleted, in one sync', async () => {
    const old = await a.roster.addRosterPlayer('Ann');
    await syncA();
    await a.roster.deleteRosterPlayer(old.id);
    await a.roster.addRosterPlayer('Ann');
    server.calls.length = 0;
    expect(await syncA()).toMatchObject({ ok: true, pending: 0 });
    expect(await live()).toEqual(['Ann']);
    // The deleted player went first, so the new one was never refused and nobody had to look for a holder.
    expect(server.calls).not.toContain('listLive');
  });

  it('puts a player off until the player holding their new name has been renamed', async () => {
    const x = await a.roster.addRosterPlayer('Ann');
    const y = await a.roster.addRosterPlayer('Bob');
    await syncA();
    // The one pushed first takes the name the other one is giving up.
    const [first, second] = [x, y].sort((p, q) => p.id.localeCompare(q.id));
    const taken = second.name;
    await a.roster.renameRosterPlayer(second.id, 'Zed');
    await a.roster.renameRosterPlayer(first.id, taken);
    expect(await syncA()).toMatchObject({ ok: true, pending: 0 });
    expect((await live()).sort()).toEqual([taken, 'Zed'].sort());
  });

  it('swaps the names of two players', async () => {
    const x = await a.roster.addRosterPlayer('Ann');
    const y = await a.roster.addRosterPlayer('Bob');
    await syncA();
    await a.roster.renameRosterPlayer(x.id, 'Tmp');
    await a.roster.renameRosterPlayer(y.id, 'Ann');
    await a.roster.renameRosterPlayer(x.id, 'Bob');
    expect(await syncA()).toMatchObject({ ok: true, pending: 0 });
    expect(await live()).toEqual(['Ann', 'Bob']);
    const { rows } = await server.db.query('select id, name from public.players order by name');
    expect(rows).toEqual([
      { id: y.id, name: 'Ann' },
      { id: x.id, name: 'Bob' },
    ]);
  });
});

describe('pulling', () => {
  it('brings a new device the players and photos of the account', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(9, 8));
    await a.roster.addRosterPlayer('Ben');
    await syncA();

    expect(await syncB()).toMatchObject({ ok: true, pushed: 0, pulled: 2, pending: 0 });
    expect(await names(b)).toEqual(['Ann', 'Ben']);
    expect(bytesOf(await b.roster.getRosterPhoto(ann.id))).toEqual([9, 8]);
    expect(await b.roster.getRosterEntry(ann.id)).toMatchObject({ photoVersion: 1, photoSeq: 1 });
    expect(await b.roster.listOutbox()).toEqual([]);
  });

  it('follows renames, new photos and deletions made on another device', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    const ben = await a.roster.addRosterPlayer('Ben');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    await syncB();

    await a.roster.renameRosterPlayer(ann.id, 'Annie');
    await a.roster.setRosterPhoto(ann.id, jpeg(2));
    await a.roster.deleteRosterPlayer(ben.id);
    await syncA();
    expect(await syncB()).toMatchObject({ ok: true, pulled: 2, pending: 0 });

    expect(await names(b)).toEqual(['Annie']);
    expect(bytesOf(await b.roster.getRosterPhoto(ann.id))).toEqual([2]);
    expect(await b.roster.getRosterEntry(ann.id)).toMatchObject({ photoVersion: 2, photoSeq: 2 });
    expect(await b.roster.getRosterEntry(ben.id)).toMatchObject({ deletedAt: expect.any(Number) });
  });

  it('removes a photo another device removed, and keeps the sequence going up', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    await syncB();
    await a.roster.removeRosterPhoto(ann.id);
    await syncA();
    await syncB();
    expect(await b.roster.getRosterPhoto(ann.id)).toBeUndefined();
    expect(await b.roster.getRosterEntry(ann.id)).toMatchObject({ photoVersion: 0, photoSeq: 1 });
  });

  it('never overwrites a change still waiting to be pushed', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await syncA();
    await syncB();
    await a.roster.renameRosterPlayer(ann.id, 'Annie');
    await syncA();
    await b.roster.renameRosterPlayer(ann.id, 'Anna');
    server.refuse.add(ann.id); // B cannot push it this time
    expect(await syncB()).toMatchObject({ ok: false, reason: 'server', pending: 1 });
    expect(await names(b)).toEqual(['Anna']);
    server.refuse.clear();
    expect(await syncB()).toMatchObject({ ok: true, pending: 0 });
    expect(await live()).toEqual(['Anna']);
    expect(await syncA()).toMatchObject({ pulled: 1 });
    expect(await names(a)).toEqual(['Anna']);
  });

  it('shows nothing for a player deleted on the server that this device never had', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await syncA();
    await a.roster.deleteRosterPlayer(ann.id);
    await syncA();
    expect(await syncB()).toMatchObject({ ok: true, pulled: 0 });
    expect(await b.roster.getRosterEntry(ann.id)).toBeUndefined();
  });

  it('reads the rows of the last two minutes again, and saves nothing new for them', async () => {
    await a.roster.addRosterPlayer('Ann');
    await syncA();
    await syncB();
    server.calls.length = 0;
    expect(await syncB()).toMatchObject({ ok: true, pulled: 0 });
    const pullCall = server.calls.find((c) => c.startsWith('pull:'))!;
    const since = Date.parse(pullCall.slice('pull:'.length));
    const newest = (await server.db.query('select updated_at from public.players')).rows[0] as { updated_at: Date };
    expect(newest.updated_at.getTime() - since).toBeGreaterThanOrEqual(120_000);
    expect(newest.updated_at.getTime() - since).toBeLessThan(121_000);
  });

  it('skips rows this app would not have written, counts them, and tidies names the way the app does', async () => {
    await server.db.query(
      `insert into public.players (owner_id, id, name) values ($1, $2, E'\\t'), ($1, $3, $4), ($1, $5, 'Cy')`,
      [USER_A, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Dee\u00a0', '00000000-0000-4000-8000-000000000003'],
    );
    expect(await syncB()).toMatchObject({ ok: true, pulled: 2, skippedRows: 1 });
    expect(await names(b)).toEqual(['Cy', 'Dee']);
  });

  it('shows a player whose picture is gone from the server without one', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    server.files.clear();
    expect(await syncB()).toMatchObject({ ok: true, pulled: 1 });
    expect(await names(b)).toEqual(['Ann']);
    expect(await b.roster.getRosterEntry(ann.id)).toMatchObject({ photoVersion: 0 });
  });

  it('stops a pull that cannot download a picture, and reads the same rows again next time', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(ann.id, jpeg(1));
    await syncA();
    server.downloadsOffline = true;
    expect(await syncB()).toEqual({ ok: false, reason: 'offline', pending: 0 });
    expect(await b.roster.getSyncMeta('syncCursor')).toBeUndefined();
    server.downloadsOffline = false;
    expect(await syncB()).toMatchObject({ ok: true, pulled: 1 });
    expect(bytesOf(await b.roster.getRosterPhoto(ann.id))).toEqual([1]);
  });
});

describe('the same player saved on two devices', () => {
  it('keeps the server entry, and the other device adopts it', async () => {
    const annA = await a.roster.addRosterPlayer('Ann');
    const annB = await b.roster.addRosterPlayer(' ann ');
    await syncA();
    expect(await syncB()).toMatchObject({ ok: true, pending: 0 });

    expect(await live()).toEqual(['Ann']);
    expect(await names(b)).toEqual(['Ann']);
    expect((await b.roster.listRoster())[0].id).toBe(annA.id);
    expect(await b.roster.getRosterEntry(annB.id)).toMatchObject({ deletedAt: expect.any(Number) });
    expect(await b.roster.listOutbox()).toEqual([]);
  });

  it('gives the server entry the photo and the later played time the other device had', async () => {
    const annA = await a.roster.addRosterPlayer('Ann');
    await a.roster.markRosterPlayed([annA.id], 1_000);
    const annB = await b.roster.addRosterPlayer('Ann');
    await b.roster.setRosterPhoto(annB.id, jpeg(5, 5));
    await b.roster.markRosterPlayed([annB.id], 9_000);
    await syncA();
    expect(await syncB()).toMatchObject({ ok: true, pending: 0 });

    expect((await serverRows())[0]).toMatchObject({ photo_version: 1, photo_seq: 1 });
    expect((await serverRows())[0].last_played_at?.getTime()).toBe(9_000);
    expect(filesOf()).toEqual([`${USER_A}/${annA.id}/1.jpg`]);
    expect(bytesOf(await b.roster.getRosterPhoto(annA.id))).toEqual([5, 5]);
    expect(await syncA()).toMatchObject({ pulled: 1 });
    expect(bytesOf(await a.roster.getRosterPhoto(annA.id))).toEqual([5, 5]);
  });

  it('keeps the server photo when both have one', async () => {
    const annA = await a.roster.addRosterPlayer('Ann');
    await a.roster.setRosterPhoto(annA.id, jpeg(1));
    const annB = await b.roster.addRosterPlayer('Ann');
    await b.roster.setRosterPhoto(annB.id, jpeg(2));
    await syncA();
    await syncB();
    expect(bytesOf(await b.roster.getRosterPhoto(annA.id))).toEqual([1]);
    expect(filesOf()).toEqual([`${USER_A}/${annA.id}/1.jpg`]);
  });

  it('merges every duplicate when a device with a whole roster signs in to an account that has one', async () => {
    for (const name of ['Ann', 'Ben', 'Cy']) await a.roster.addRosterPlayer(name);
    for (const name of ['Ben', 'Cy', 'Dee']) await b.roster.addRosterPlayer(name);
    await syncA();
    await syncB();
    await syncA();
    expect(await live()).toEqual(['Ann', 'Ben', 'Cy', 'Dee']);
    expect(await names(a)).toEqual(['Ann', 'Ben', 'Cy', 'Dee']);
    expect(await names(b)).toEqual(['Ann', 'Ben', 'Cy', 'Dee']);
  });
});

describe('when things go wrong', () => {
  it('keeps every change and says so when there is no connection', async () => {
    await a.roster.addRosterPlayer('Ann');
    server.offline = true;
    expect(await syncA()).toEqual({ ok: false, reason: 'offline', pending: 1 });
    server.offline = false;
    expect(await syncA()).toMatchObject({ ok: true, pending: 0 });
    expect(await live()).toEqual(['Ann']);
  });

  it('does not let one refused player hold up the others', async () => {
    const ann = await a.roster.addRosterPlayer('Ann');
    await a.roster.addRosterPlayer('Ben');
    server.refuse.add(ann.id);
    expect(await syncA()).toEqual({ ok: false, reason: 'server', pending: 1 });
    expect(await live()).toEqual(['Ben']);
  });

  it('does not loop forever when the holder of a name never moves', async () => {
    const x = await a.roster.addRosterPlayer('Ann');
    const y = await a.roster.addRosterPlayer('Bob');
    await syncA();
    await a.roster.renameRosterPlayer(x.id, 'Zed');
    await a.roster.renameRosterPlayer(y.id, 'Ann');
    server.refuse.add(x.id);
    expect(await syncA()).toMatchObject({ ok: false, reason: 'server' });
    // Nobody was parked under a made-up name while waiting for a holder that is not going to move.
    expect(await live()).toEqual(['Ann', 'Bob']);
  });

  it('will not mix another account into this one, and says so', async () => {
    await a.roster.addRosterPlayer('Ann');
    await syncA();
    server.calls.length = 0;
    expect(await a.engine.syncOnce(server.remote(USER_B), USER_B)).toEqual({ ok: false, reason: 'otherAccount', pending: 0 });
    expect(server.calls).toEqual([]);
  });

  it('treats the account id as the same whatever its case', async () => {
    await a.roster.addRosterPlayer('Ann');
    await a.engine.syncOnce(server.remote(USER_A), USER_A.toUpperCase());
    expect(await syncA()).toMatchObject({ ok: true });
  });
});
