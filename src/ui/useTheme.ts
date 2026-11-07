import { useState } from 'react';
import { getInitialTheme, setTheme, type Theme } from './theme';

/** The current theme, and a function that flips it and remembers the choice. */
export function useTheme(): [Theme, () => void] {
  const [theme, setThemeState] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme | undefined) ?? getInitialTheme(),
  );
  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  }
  return [theme, toggle];
}
