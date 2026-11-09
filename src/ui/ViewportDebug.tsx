import { useEffect, useState } from 'react';
import { APP_HEIGHT_VAR, visibleHeight } from './useViewportHeight';

/** Reads the screen's real numbers so a cut-off layout can be diagnosed from one screenshot. */
function readings(): [string, string][] {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;height:100dvh;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)';
  document.body.append(probe);
  const box = getComputedStyle(probe);
  const dvh = probe.getBoundingClientRect().height;
  const insets = `${box.paddingTop} / ${box.paddingBottom}`;
  probe.remove();
  const app = document.querySelector('.app')?.getBoundingClientRect();
  const bar = document.querySelector('.sticky-bar')?.getBoundingClientRect();
  return [
    ['innerHeight', String(window.innerHeight)],
    ['clientHeight', String(document.documentElement.clientHeight)],
    ['visualViewport', String(Math.round(window.visualViewport?.height ?? 0))],
    ['100dvh', String(Math.round(dvh))],
    ['used (min)', String(visibleHeight())],
    [APP_HEIGHT_VAR, document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR) || 'unset'],
    ['inset top / bottom', insets],
    ['.app height', String(Math.round(app?.height ?? 0))],
    ['bar bottom', String(Math.round(bar?.bottom ?? 0))],
    ['screen', `${window.screen.width} x ${window.screen.height}`],
    ['dpr', String(window.devicePixelRatio)],
  ];
}

/** A small box with those numbers. It only shows when the address ends in ?debug. */
export function ViewportDebug() {
  const [rows, setRows] = useState<[string, string][]>([]);
  useEffect(() => {
    const update = () => setRows(readings());
    update();
    const timer = setInterval(update, 1000);
    window.addEventListener('resize', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', update);
    };
  }, []);
  return (
    <dl
      aria-label="Screen sizes"
      style={{ position: 'fixed', top: 0, right: 0, zIndex: 9999, margin: 0, padding: '6px 8px', background: 'rgba(0,0,0,.85)', color: '#c8f03c', font: '11px/1.3 monospace' }}
    >
      {rows.map(([k, v]) => (
        <div key={k}>
          {k}: {v}
        </div>
      ))}
    </dl>
  );
}

export const debugRequested = () => new URLSearchParams(window.location.search).has('debug');
