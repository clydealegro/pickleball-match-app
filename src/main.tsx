import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/app.css';
import './styles/playerSheet.css';
import './styles/editSlot.css';
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

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
