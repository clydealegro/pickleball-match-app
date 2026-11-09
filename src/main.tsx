import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/app.css';
import './styles/playerSheet.css';
import './styles/editSlot.css';
import { chooseRoot, watchJoin } from './chooseRoot';
import { MemberRoot } from './member/MemberRoot';
import { useUpdateStore } from './pwa';
import App from './ui/App';
import { applyTheme, getInitialTheme } from './ui/theme';

applyTheme(getInitialTheme());
// A new version is only offered, never applied by itself: reloading could wipe a half-filled form.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    useUpdateStore.getState().markReady(() => {
      void updateSW(true);
    });
  },
});

// The hash is read once. A join link opens the member page, which never mounts the app or starts sync.
const choice = chooseRoot(location.hash);
watchJoin(choice.kind === 'member' ? choice.code : null, window, () => location.reload());

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{choice.kind === 'member' ? <MemberRoot code={choice.code} /> : <App />}</React.StrictMode>,
);
