import { useEffect, useState } from 'react';

const QUERY = '(min-width: 900px)';

/** True on a wide screen (tablet landscape and up). False where the browser cannot say, such as in tests. */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(() => (typeof window.matchMedia === 'function' ? window.matchMedia(QUERY).matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(QUERY);
    const onChange = () => setWide(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return wide;
}
