import { describe, expect, it, vi } from 'vitest';
import { PHOTO_QUALITY, PHOTO_SIZE, PHOTO_TYPE, PhotoError, processPhoto, squareCrop, type PhotoIo } from './photo';

describe('squareCrop', () => {
  it('centers a square in a landscape picture', () => {
    expect(squareCrop(400, 300)).toEqual({ sx: 50, sy: 0, side: 300 });
  });

  it('centers a square in a portrait picture', () => {
    expect(squareCrop(300, 500)).toEqual({ sx: 0, sy: 100, side: 300 });
  });

  it('keeps a square picture whole', () => {
    expect(squareCrop(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 });
  });

  it('rounds down when the margin is odd', () => {
    expect(squareCrop(301, 300)).toEqual({ sx: 0, sy: 0, side: 300 });
    expect(squareCrop(305, 300)).toEqual({ sx: 2, sy: 0, side: 300 });
  });
});

function fakeIo(over: Partial<PhotoIo> = {}) {
  const release = vi.fn();
  const io: PhotoIo = {
    decode: vi.fn().mockResolvedValue({ width: 400, height: 300, source: {}, release }),
    encode: vi.fn().mockResolvedValue({ type: 'image/jpeg', data: new ArrayBuffer(3) }),
    ...over,
  };
  return { io, release };
}
const picture = new Blob(['x'], { type: 'image/png' });

describe('processPhoto', () => {
  it('crops to a centered square, scales to 256 px and encodes as JPEG at about 80%', async () => {
    const { io } = fakeIo();
    const out = await processPhoto(picture, io);
    expect(io.encode).toHaveBeenCalledWith(
      expect.objectContaining({ width: 400, height: 300 }),
      { sx: 50, sy: 0, side: 300 },
      256,
      'image/jpeg',
      0.8,
    );
    expect(out.type).toBe('image/jpeg');
    expect(out.data.byteLength).toBe(3);
    expect([PHOTO_SIZE, PHOTO_TYPE, PHOTO_QUALITY]).toEqual([256, 'image/jpeg', 0.8]);
  });

  it('releases the decoded picture after success', async () => {
    const { io, release } = fakeIo();
    await processPhoto(picture, io);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rejects a file that is not an image without decoding it', async () => {
    const { io } = fakeIo();
    await expect(processPhoto(new Blob(['x'], { type: 'text/plain' }), io)).rejects.toThrow(PhotoError);
    expect(io.decode).not.toHaveBeenCalled();
  });

  it('reports a picture that cannot be decoded', async () => {
    const { io } = fakeIo({ decode: vi.fn().mockRejectedValue(new Error('bad data')) });
    await expect(processPhoto(picture, io)).rejects.toThrow(/couldn't be read/i);
  });

  it('reports a picture with no size and still releases it', async () => {
    const release = vi.fn();
    const { io } = fakeIo({ decode: vi.fn().mockResolvedValue({ width: 0, height: 0, source: {}, release }) });
    await expect(processPhoto(picture, io)).rejects.toThrow(PhotoError);
    expect(io.encode).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('turns an encoding failure into a PhotoError and still releases the picture', async () => {
    const { io, release } = fakeIo({ encode: vi.fn().mockRejectedValue(new Error('toBlob returned null')) });
    await expect(processPhoto(picture, io)).rejects.toThrow(PhotoError);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
