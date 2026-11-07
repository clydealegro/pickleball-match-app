import { useTheme } from './useTheme';

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="btn btn-ghost" aria-label={`Switch to ${next} theme`} onClick={toggle}>
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
