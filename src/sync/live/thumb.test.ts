import { describe, expect, it } from 'vitest';
import type { PhotoIo } from '../../lib/photo';
import { MAX_THUMB_CHARS, THUMB_SIZE, thumbFromPhoto } from './thumb';

const photo = { type: 'image/jpeg', data: new Uint8Array([1, 2, 3]).buffer };
const io = (over: Partial<PhotoIo> = {}, bytes = new Uint8Array([255, 216, 255, 224])): PhotoIo & { calls: unknown[][] } => {
  const calls: unknown[][] = [];
  return {
    calls,
    decode: async () => ({ width: 256, height: 200, source: {} as CanvasImageSource, release: () => calls.push(['release']) }),
    encode: async (_image, crop, size, type, quality) => {
      calls.push(['encode', crop, size, type, quality]);
      return { type: 'image/jpeg', data: bytes.buffer };
    },
    ...over,
  };
};

describe('thumbFromPhoto', () => {
  it('makes a small centred JPEG data URI', async () => {
    const fake = io();
    const uri = await thumbFromPhoto(photo, fake);
    expect(uri).toBe('data:image/jpeg;base64,/9j/4A==');
    expect(fake.calls[0]).toEqual(['encode', { sx: 28, sy: 0, side: 200 }, THUMB_SIZE, 'image/jpeg', 0.7]);
    expect(fake.calls[1]).toEqual(['release']);
  });

  it('is null when the picture cannot be read, drawn or has no size', async () => {
    expect(await thumbFromPhoto(photo, io({ decode: async () => { throw new Error('bad'); } }))).toBeNull();
    expect(await thumbFromPhoto(photo, io({ encode: async () => { throw new Error('bad'); } }))).toBeNull();
    expect(await thumbFromPhoto(photo, io({ decode: async () => ({ width: 0, height: 0, source: {} as CanvasImageSource }) }))).toBeNull();
  });

  it('is null when the result would be too big for the database', async () => {
    const big = new Uint8Array(MAX_THUMB_CHARS);
    expect(await thumbFromPhoto(photo, io({}, big))).toBeNull();
  });

  it('handles a picture longer than one slice', async () => {
    const bytes = new Uint8Array(9000).fill(65);
    const uri = await thumbFromPhoto(photo, io({}, bytes));
    expect(uri?.startsWith('data:image/jpeg;base64,QUFB')).toBe(true);
    expect(uri).not.toBeNull();
  });
});
