import { getRosterPhoto } from '../store/rosterDb';
import type { CardPhotos } from './cardDraw';

/**
 * The saved photos for these players, decoded for the canvas. A player with no photo, or a photo this browser cannot
 * decode, is simply missing from the result, and the card draws their initials instead.
 */
export async function loadCardPhotos(rosterIds: string[]): Promise<CardPhotos> {
  const photos: CardPhotos = new Map();
  if (typeof createImageBitmap !== 'function') return photos;
  await Promise.all(
    [...new Set(rosterIds)].map(async (id) => {
      try {
        const photo = await getRosterPhoto(id);
        if (photo) photos.set(id, await createImageBitmap(new Blob([photo.data], { type: photo.type })));
      } catch {
        /* initials it is */
      }
    }),
  );
  return photos;
}
