import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import App from './ui/App';
import { applyTheme, getInitialTheme } from './ui/theme';

applyTheme(getInitialTheme());

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
