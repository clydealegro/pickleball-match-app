import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCtx, newTestSession } from '../engine/testing';
import { sharePictureFor } from './sharePicture';

const mocks = vi.hoisted(() => ({
  buildCardModel: vi.fn(),
  loadCardPhotos: vi.fn(),
  renderCardBlob: vi.fn(),
  deliverPicture: vi.fn(),
}));
vi.mock('./cardModel', async (original) => ({ ...(await original<typeof import('./cardModel')>()), buildCardModel: mocks.buildCardModel }));
vi.mock('./cardPhotos', () => ({ loadCardPhotos: mocks.loadCardPhotos }));
vi.mock('./cardDraw', async (original) => ({ ...(await original<typeof import('./cardDraw')>()), renderCardBlob: mocks.renderCardBlob }));
vi.mock('./cardShare', async (original) => ({ ...(await original<typeof import('./cardShare')>()), deliverPicture: mocks.deliverPicture }));

const blob = new Blob(['x'], { type: 'image/png' });
const photos = new Map();
const session = { ...newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, makeCtx(1, 1_000_000)), name: 'Open play' };

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.buildCardModel.mockReturnValue({ title: 'Open play', players: [{ rosterId: 'r1' }, { name: 'x' }, { rosterId: 'r2' }] });
  mocks.loadCardPhotos.mockResolvedValue(photos);
  mocks.renderCardBlob.mockResolvedValue(blob);
  mocks.deliverPicture.mockResolvedValue('shared');
});

describe('sharePictureFor', () => {
  it('builds the model with the results and theme, loads the photos of saved players, draws and delivers', async () => {
    const outcome = await sharePictureFor(session, { results: true, theme: 'dark' });
    expect(mocks.buildCardModel).toHaveBeenCalledWith(session, { results: true, theme: 'dark' });
    expect(mocks.loadCardPhotos).toHaveBeenCalledWith(['r1', 'r2']);
    expect(mocks.renderCardBlob).toHaveBeenCalledWith(mocks.buildCardModel.mock.results[0].value, photos);
    expect(mocks.deliverPicture).toHaveBeenCalledWith(blob, 'Open play');
    expect(outcome).toBe('shared');
  });

  it('returns whatever outcome the delivery gives', async () => {
    mocks.deliverPicture.mockResolvedValue('cancelled');
    expect(await sharePictureFor(session, { results: false })).toBe('cancelled');
  });

  it('throws when the picture cannot be drawn', async () => {
    mocks.renderCardBlob.mockRejectedValue(new Error('no canvas'));
    await expect(sharePictureFor(session, { results: false })).rejects.toThrow('no canvas');
    expect(mocks.deliverPicture).not.toHaveBeenCalled();
  });
});
