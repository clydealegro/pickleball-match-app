import { browserIo, squareCrop, type PhotoIo } from '../../lib/photo';
import type { PhotoData } from '../../store/rosterDb';

/** The live page shows faces small, so a 96 px picture is plenty, and it keeps the board light to send. */
export const THUMB_SIZE = 96;
const THUMB_QUALITY = 0.7;
/** The database refuses a face longer than this as text. */
export const MAX_THUMB_CHARS = 16384;

/** Binary to base64, in slices so a long picture does not overflow the argument limit. */
function base64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** A small JPEG data URI of a saved player's photo, or null when it cannot be made or would be too big to send. */
export async function thumbFromPhoto(photo: PhotoData, io: PhotoIo = browserIo): Promise<string | null> {
  try {
    const image = await io.decode(new Blob([photo.data], { type: photo.type }));
    try {
      if (!(image.width > 0 && image.height > 0)) return null;
      const small = await io.encode(image, squareCrop(image.width, image.height), THUMB_SIZE, 'image/jpeg', THUMB_QUALITY);
      const uri = `data:image/jpeg;base64,${base64(small.data)}`;
      return uri.length <= MAX_THUMB_CHARS ? uri : null;
    } finally {
      image.release?.();
    }
  } catch {
    // A face that cannot be made is simply left out: the page shows initials.
    return null;
  }
}
