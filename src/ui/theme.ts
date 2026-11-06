export type Theme = 'light' | 'dark';

const KEY = 'pickleball.theme';

export function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage unavailable: fall through to the system preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
}

/** Applies the theme to the page without remembering it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Applies the theme and remembers the user's choice. */
export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* the choice just won't persist */
  }
}
