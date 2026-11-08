import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addRosterPlayer, resetRosterDbForTests, setRosterPhoto } from '../store/rosterDb';
import { loadCardPhotos } from './cardPhotos';

beforeEach(async () => {
  await resetRosterDbForTests();
});
afterEach(() => vi.unstubAllGlobals());

async function withPhoto(name: string) {
  const p = await addRosterPlayer(name);
  await setRosterPhoto(p.id, { type: 'image/jpeg', data: new Uint8Array([1, 2, 3]).buffer });
  return p.id;
}

describe('loadCardPhotos', () => {
  it('decodes the photos players have, and skips the rest', async () => {
    const ann = await withPhoto('Ann');
    const ben = (await addRosterPlayer('Ben')).id;
    const bitmap = { width: 10, height: 10 } as ImageBitmap;
    const decode = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', decode);
    const photos = await loadCardPhotos([ann, ben, 'gone']);
    expect([...photos.keys()]).toEqual([ann]);
    expect(photos.get(ann)).toBe(bitmap);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect((decode.mock.calls[0][0] as Blob).type).toBe('image/jpeg');
  });

  it('reads each player once, however many times they are listed', async () => {
    const ann = await withPhoto('Ann');
    const decode = vi.fn().mockResolvedValue({ width: 1, height: 1 });
    vi.stubGlobal('createImageBitmap', decode);
    await loadCardPhotos([ann, ann]);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('leaves out a photo that cannot be decoded, so that player shows initials', async () => {
    const ann = await withPhoto('Ann');
    const ben = await withPhoto('Ben');
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValueOnce(new Error('bad image')).mockResolvedValue({ width: 1, height: 1 }));
    const photos = await loadCardPhotos([ann, ben]);
    expect(photos.size).toBe(1);
  });

  it('gives no photos in a browser that cannot decode them', async () => {
    const ann = await withPhoto('Ann');
    vi.stubGlobal('createImageBitmap', undefined);
    expect((await loadCardPhotos([ann])).size).toBe(0);
  });
});
