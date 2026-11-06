import { useState } from 'react';
import { getInitialTheme, setTheme, type Theme } from './theme';

export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme | undefined) ?? getInitialTheme(),
  );
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="btn btn-ghost"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        setTheme(next);
        setThemeState(next);
      }}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
