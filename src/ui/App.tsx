import { useEffect, useState } from 'react';
import { useRosterStore } from '../store/rosterStore';
import { useAuthStore } from '../sync/auth';
import { useUpdateStore } from '../pwa';
import { useSessionStore } from '../store/sessionStore';
import { ErrorBoundary } from './ErrorBoundary';
import { LiveScreen } from './LiveScreen';
import { SavedPlayersScreen } from './SavedPlayersScreen';
import { SettingsScreen } from './SettingsScreen';
import { SetupScreen } from './SetupScreen';
import { SummaryScreen } from './SummaryScreen';
import { ThemeToggle } from './ThemeToggle';

export default function App() {
  const session = useSessionStore((s) => s.session);
  const saveFailed = useSessionStore((s) => s.saveFailed);
  const updateReady = useUpdateStore((s) => s.ready);
  const applyUpdate = useUpdateStore((s) => s.apply);
  const rosterPersistent = useRosterStore((s) => s.persistent);
  const loadRoster = useRosterStore((s) => s.load);
  const initAuth = useAuthStore((s) => s.init);
  const [view, setView] = useState<'setup' | 'saved' | 'settings'>('setup');

  useEffect(() => {
    // A failing roster load is already reflected by the store's `persistent` flag.
    loadRoster().catch(() => {});
  }, [loadRoster]);

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  let screen;
  if (!session) {
    // Setup stays mounted (just hidden) so a half-filled form survives a trip to Saved players or Settings.
    screen = (
      <>
        <div hidden={view !== 'setup'}>
          <SetupScreen onManage={() => setView('saved')} onSettings={() => setView('settings')} />
        </div>
        {view === 'saved' && <SavedPlayersScreen onBack={() => setView('setup')} />}
        {view === 'settings' && <SettingsScreen onBack={() => setView('setup')} />}
      </>
    );
  } else if (session.endedAt) {
    screen = <SummaryScreen session={session} />;
  } else {
    screen = <LiveScreen session={session} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Pickleball Matchmaker</span>
        <ThemeToggle />
      </header>
      {updateReady && (
        <p className="notice" role="status">
          A new version is ready.{' '}
          <button type="button" className="btn btn-small" onClick={() => applyUpdate?.()}>
            Reload now
          </button>
        </p>
      )}
      {saveFailed && (
        <p className="notice" role="alert">
          Not saved — this browser is blocking storage. The session still works, but a refresh will lose it.
        </p>
      )}
      {!rosterPersistent && (
        <p className="notice" role="status">
          Saved players can't be stored in this browser, so names will be forgotten when the app closes.
        </p>
      )}
      <main>
        <ErrorBoundary>{screen}</ErrorBoundary>
      </main>
    </div>
  );
}
