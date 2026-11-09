export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'field';

/**
 * Shares a link with the phone's share menu. Without one, or when it fails, the link is copied. 'field' means even
 * copying failed, so the caller should show the link for the organizer to select. Closing the share menu is not an error.
 */
export async function shareOrCopy(url: string, title: string): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'field';
  }
}
