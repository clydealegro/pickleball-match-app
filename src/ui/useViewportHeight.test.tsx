import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_HEIGHT_VAR, useViewportHeight, visibleHeight } from './useViewportHeight';

function Probe() {
  useViewportHeight();
  return null;
}

const setSizes = (inner: number, client: number, visual?: number) => {
  Object.defineProperty(window, 'innerHeight', { value: inner, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: client, configurable: true });
  Object.defineProperty(window, 'visualViewport', { value: visual === undefined ? undefined : { height: visual, addEventListener() {}, removeEventListener() {} }, configurable: true });
};
const cssVar = () => document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR);

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty(APP_HEIGHT_VAR);
});

describe('visibleHeight', () => {
  it('is the smallest of the measurements, so the page is never taller than the screen shows', () => {
    setSizes(780, 760, 712);
    expect(visibleHeight()).toBe(712);
    setSizes(700, 760, 712);
    expect(visibleHeight()).toBe(700);
  });

  it('works without a visual viewport and rounds down to whole pixels', () => {
    setSizes(700.8, 720, undefined);
    expect(visibleHeight()).toBe(700);
  });

  it('skips measurements that are zero or missing', () => {
    setSizes(0, 650, undefined);
    expect(visibleHeight()).toBe(650);
  });
});

describe('useViewportHeight', () => {
  it('sets the height variable on load and updates it when the screen changes', () => {
    setSizes(712, 712, 712);
    render(<Probe />);
    expect(cssVar()).toBe('712px');
    setSizes(500, 500, 500);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(cssVar()).toBe('500px');
  });

  it('removes the variable when it goes away, so the stylesheet falls back to 100dvh', () => {
    setSizes(712, 712, 712);
    const { unmount } = render(<Probe />);
    unmount();
    expect(cssVar()).toBe('');
  });
});
