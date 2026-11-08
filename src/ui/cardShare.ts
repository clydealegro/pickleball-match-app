/** "shared" went through the share sheet, "saved" was downloaded, "cancelled" means the organizer closed the sheet. */
export type PictureOutcome = 'shared' | 'saved' | 'cancelled';

/** "wednesday-open-play.png": letters and digits only, so every phone and computer accepts it. */
export function pictureFileName(sessionName: string): string {
  const slug = sessionName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'session'}.png`;
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Give the browser a moment to start the download before the link is released.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Hands the picture to the share sheet as a file, or downloads it where files cannot be shared. */
export async function deliverPicture(blob: Blob, sessionName: string): Promise<PictureOutcome> {
  const fileName = pictureFileName(sessionName);
  const file = new File([blob], fileName, { type: 'image/png' });
  const data = { files: [file] };
  if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare(data)) {
    try {
      await navigator.share({ ...data, title: sessionName });
      return 'shared';
    } catch (e) {
      // Closing the share sheet is not an error, and it must not also drop a download on the phone.
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  download(blob, fileName);
  return 'saved';
}
