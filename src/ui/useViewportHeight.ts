import { useEffect } from 'react';

/** The CSS variable that holds the height of the area the page can actually draw in. */
export const APP_HEIGHT_VAR = '--app-height';

/**
 * The height the page can really use, in pixels. On some Android phones `100dvh` counts the space behind the system
 * navigation bar, so a layout sized to it runs past the bottom and cuts off its last button. These are the browser's
 * measurements of what is visible, and the smallest one wins so the page is never taller than the screen shows.
 */
export function visibleHeight(): number {
  const sizes = [window.innerHeight, document.documentElement.clientHeight, window.visualViewport?.height].filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0,
  );
  return sizes.length > 0 ? Math.floor(Math.min(...sizes)) : 0;
}

/** Keeps the height variable up to date as the screen changes: rotating, the keyboard, the system bars. */
export function useViewportHeight(): void {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const h = visibleHeight();
      if (h > 0) root.style.setProperty(APP_HEIGHT_VAR, `${h}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    window.visualViewport?.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      window.visualViewport?.removeEventListener('resize', apply);
      root.style.removeProperty(APP_HEIGHT_VAR);
    };
  }, []);
}
