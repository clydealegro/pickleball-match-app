import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadFile } from './download';

const created: Blob[] = [];
let clicked: { download: string; href: string }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  created.length = 0;
  clicked = [];
  URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
    created.push(blob as Blob);
    return 'blob:test/1';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('downloadFile', () => {
  it('clicks a temporary link that downloads the file under its name', () => {
    downloadFile('play.ics', 'BEGIN:VCALENDAR');
    expect(clicked).toEqual([{ download: 'play.ics', href: 'blob:test/1' }]);
  });

  it('puts the text in a calendar blob', () => {
    downloadFile('play.ics', 'BEGIN:VCALENDAR');
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('text/calendar;charset=utf-8');
    expect(created[0].size).toBe('BEGIN:VCALENDAR'.length);
  });

  it('removes the link from the page, and frees the object url a moment later', () => {
    downloadFile('play.ics', 'x');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
  });
});
