import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverPicture, pictureFileName } from './cardShare';

const png = new Blob(['x'], { type: 'image/png' });

function stubNavigator(extra: Record<string, unknown>) {
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), extra));
}

/** Catches the download link the page clicks. */
function watchDownloads() {
  const clicked: { download: string; href: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href });
  });
  return clicked;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pictureFileName', () => {
  it('turns the session name into a safe file name', () => {
    expect(pictureFileName('Wednesday open play')).toBe('wednesday-open-play.png');
    expect(pictureFileName('  PIKL — Sat 7 Nov!! ')).toBe('pikl-sat-7-nov.png');
    expect(pictureFileName('???')).toBe('session.png');
  });
});

describe('deliverPicture', () => {
  it('shares the picture as a file when the browser can', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    stubNavigator({ share, canShare });
    const clicked = watchDownloads();
    await expect(deliverPicture(png, 'Open play')).resolves.toBe('shared');
    const data = share.mock.calls[0][0] as { files: File[]; title: string };
    expect(data.files).toHaveLength(1);
    expect(data.files[0].name).toBe('open-play.png');
    expect(data.files[0].type).toBe('image/png');
    expect(data.title).toBe('Open play');
    expect(canShare).toHaveBeenCalledWith({ files: data.files });
    expect(clicked).toEqual([]);
  });

  it('treats closing the share sheet as a cancel, not a failure, and saves nothing', async () => {
    stubNavigator({ share: vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError')), canShare: () => true });
    const clicked = watchDownloads();
    await expect(deliverPicture(png, 'Open play')).resolves.toBe('cancelled');
    expect(clicked).toEqual([]);
  });

  it('downloads the picture where files cannot be shared', async () => {
    stubNavigator({ share: vi.fn(), canShare: () => false });
    const clicked = watchDownloads();
    await expect(deliverPicture(png, 'Open play')).resolves.toBe('saved');
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('open-play.png');
    expect(clicked[0].href).toMatch(/^blob:/);
  });

  it('downloads it when the browser has no share at all', async () => {
    stubNavigator({ share: undefined, canShare: undefined });
    const clicked = watchDownloads();
    await expect(deliverPicture(png, 'Open play')).resolves.toBe('saved');
    expect(clicked).toHaveLength(1);
  });

  it('downloads it when sharing fails for any other reason', async () => {
    stubNavigator({ share: vi.fn().mockRejectedValue(new Error('NotAllowedError')), canShare: () => true });
    const clicked = watchDownloads();
    await expect(deliverPicture(png, 'Open play')).resolves.toBe('saved');
    expect(clicked).toHaveLength(1);
  });
});
