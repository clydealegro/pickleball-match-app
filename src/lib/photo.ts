import type { PhotoData } from '../store/rosterDb';

export const PHOTO_SIZE = 256;
export const PHOTO_QUALITY = 0.8;
export const PHOTO_TYPE = 'image/jpeg';

/** Shown to the organizer; the message always says what to do next. */
export class PhotoError extends Error {}

export interface Crop {
  sx: number;
  sy: number;
  side: number;
}

/** The largest square that fits in a width x height picture, centered. */
export function squareCrop(width: number, height: number): Crop {
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

export interface DecodedImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  /** Frees the decoded pixels. */
  release?: () => void;
}

/** The browser-only steps, kept behind an interface so the rest can be tested without a canvas. */
export interface PhotoIo {
  /** Decodes a file into pixels, asking the browser to apply the camera's rotation. Rejects if it is not a readable image. */
  decode(file: Blob): Promise<DecodedImage>;
  /** Draws the cropped square scaled to size x size and encodes it. */
  encode(image: DecodedImage, crop: Crop, size: number, type: string, quality: number): Promise<PhotoData>;
}

function decodeWithImageElement(file: Blob): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () =>
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        source: img,
        release: () => URL.revokeObjectURL(url),
      });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The picture could not be decoded.'));
    };
    img.src = url;
  });
}

export const browserIo: PhotoIo = {
  async decode(file) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { width: bitmap.width, height: bitmap.height, source: bitmap, release: () => bitmap.close() };
    } catch {
      // Older browsers: let an <img> element decode it.
      return decodeWithImageElement(file);
    }
  },
  async encode(image, crop, size, type, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available.');
    // JPEG has no transparency: put a white backdrop under pictures that have it.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image.source, crop.sx, crop.sy, crop.side, crop.side, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) throw new Error('The picture could not be encoded.');
    return { type: blob.type || type, data: await blob.arrayBuffer() };
  },
};

/** Center-crops a picked or captured picture to a square, scales it to 256 px and encodes a small JPEG. */
export async function processPhoto(file: Blob, io: PhotoIo = browserIo): Promise<PhotoData> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new PhotoError('That file is not a picture. Choose a photo instead.');
  }
  let image: DecodedImage;
  try {
    image = await io.decode(file);
  } catch {
    throw new PhotoError("That picture couldn't be read. Try taking it again or choose another one.");
  }
  try {
    if (!(image.width > 0 && image.height > 0)) {
      throw new PhotoError("That picture couldn't be read. Try taking it again or choose another one.");
    }
    return await io.encode(image, squareCrop(image.width, image.height), PHOTO_SIZE, PHOTO_TYPE, PHOTO_QUALITY);
  } catch (error) {
    throw error instanceof PhotoError ? error : new PhotoError("Couldn't prepare that picture. Try again.");
  } finally {
    image.release?.();
  }
}
