import { useEffect, useMemo, useRef } from 'react';

interface Options<V extends string> {
  /** The screen the app starts on. It is written to the first history entry. */
  root: V;
  /** Turns whatever a history entry holds (possibly nothing, or something foreign) into a screen that can be shown now. */
  resolve: (view: string | undefined) => V;
  /** Shows a screen. */
  show: (view: V) => void;
}

export interface ScreenHistory<V extends string> {
  /** Shows a screen and adds a history entry for it. */
  push: (view: V) => void;
  /** Shows the previous screen at once and steps the history back, when the entry below is that screen. */
  back: (view: V) => void;
  /** Gives the current entry another screen, keeping its place in the stack. */
  replace: (view: V) => void;
  /** Makes the current entry the first one again, on this screen. */
  resetRoot: (view: V) => void;
}

/** Keeps the browser history in step with the screens, so the phone's Back button steps back one screen. */
export function useScreenHistory<V extends string>(options: Options<V>): ScreenHistory<V> {
  const latest = useRef(options);
  latest.current = options;
  // The place of the current entry in the stack, and which screen each place holds.
  const pk = useRef(0);
  const stack = useRef<string[]>([]);

  useEffect(() => {
    const { root } = latest.current;
    pk.current = 0;
    stack.current = [root];
    history.replaceState({ pk: 0, view: root }, '');

    const onPop = (e: PopStateEvent) => {
      const state: unknown = e.state;
      const entry = state && typeof state === 'object' ? (state as { pk?: unknown; view?: unknown }) : {};
      const at = typeof entry.pk === 'number' && entry.pk >= 0 ? entry.pk : 0;
      const view = latest.current.resolve(typeof entry.view === 'string' ? entry.view : undefined);
      pk.current = at;
      stack.current[at] = view;
      latest.current.show(view);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return useMemo<ScreenHistory<V>>(
    () => ({
      push: (view) => {
        latest.current.show(view);
        pk.current += 1;
        stack.current.length = pk.current;
        stack.current[pk.current] = view;
        history.pushState({ pk: pk.current, view }, '');
      },
      back: (view) => {
        latest.current.show(view);
        if (pk.current > 0 && stack.current[pk.current - 1] === view) {
          pk.current -= 1;
          history.back();
        } else {
          // The entry below is another screen, so add this one rather than step onto the wrong one.
          pk.current += 1;
          stack.current.length = pk.current;
          stack.current[pk.current] = view;
          history.pushState({ pk: pk.current, view }, '');
        }
      },
      replace: (view) => {
        stack.current[pk.current] = view;
        history.replaceState({ pk: pk.current, view }, '');
      },
      resetRoot: (view) => {
        pk.current = 0;
        stack.current = [view];
        history.replaceState({ pk: 0, view }, '');
      },
    }),
    [],
  );
}
