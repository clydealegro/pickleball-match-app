import { useEffect, useState } from 'react';
import { useRosterStore } from '../store/rosterStore';
import { useAuthStore } from '../sync/auth';
import { startSyncCoordinator } from '../sync/coordinator';
import { useUpdateStore } from '../pwa';
import { useSessionStore } from '../store/sessionStore';
import { AccountButton } from './AccountButton';
import { ErrorBoundary } from './ErrorBoundary';
import { SignInBanner } from './SignInBanner';
import { LiveScreen } from './LiveScreen';
import { SavedPlayersScreen } from './SavedPlayersScreen';
import { SettingsScreen } from './SettingsScreen';
import { SetupScreen } from './SetupScreen';
import { SummaryScreen } from './SummaryScreen';

export default function App() {
  const session = useSessionStore((s) => s.session);
  const saveFailed = useSessionStore((s) => s.saveFailed);
  const updateReady = useUpdateStore((s) => s.ready);
  const applyUpdate = useUpdateStore((s) => s.apply);
  const rosterPersistent = useRosterStore((s) => s.persistent);
  const rosterBlocked = useRosterStore((s) => s.blocked);
  const loadRoster = useRosterStore((s) => s.load);
  const initAuth = useAuthStore((s) => s.init);
  const [view, setView] = useState<'setup' | 'saved' | 'settings'>('setup');
  // Saved players can be opened from Setup or from Settings; Back returns to whichever it came from.
  const [savedFrom, setSavedFrom] = useState<'setup' | 'settings'>('setup');
  const openSaved = (from: 'setup' | 'settings') => {
    setSavedFrom(from);
    setView('saved');
  };

  useEffect(() => {
    // A failing roster load is already reflected by the store's `persistent` flag.
    loadRoster().catch(() => {});
  }, [loadRoster]);

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  // Keeps saved players backed up while signed in. It does nothing without a backend or a signed-in organizer.
  useEffect(() => startSyncCoordinator(), []);

  let screen;
  if (!session) {
    // Setup stays mounted (just hidden) so a half-filled form survives a trip to Saved players or Settings.
    screen = (
      <>
        <div hidden={view !== 'setup'}>
          <SignInBanner onSignIn={() => setView('settings')} />
          <SetupScreen onManage={() => openSaved('setup')} />
        </div>
        {view === 'saved' && <SavedPlayersScreen onBack={() => setView(savedFrom)} />}
        {view === 'settings' && <SettingsScreen onBack={() => setView('setup')} onManage={() => openSaved('settings')} />}
      </>
    );
  } else if (view === 'settings') {
    screen = <SettingsScreen onBack={() => setView('setup')} onManage={() => openSaved('settings')} />;
  } else if (view === 'saved') {
    screen = <SavedPlayersScreen onBack={() => setView(savedFrom)} />;
  } else if (session.endedAt) {
    screen = <SummaryScreen session={session} />;
  } else {
    screen = <LiveScreen session={session} onSettings={() => setView('settings')} />;
  }

  // The live screen has its own slim top bar, so the app's title bar is left out to give the court the room.
  const live = !!session && !session.endedAt && view === 'setup';

  return (
    <div className="app">
      {!live && (
        <header className="app-header">
          <span className="app-title">PIKLMatch</span>
          {view !== 'settings' && <AccountButton onClick={() => setView('settings')} />}
        </header>
      )}
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
      {rosterBlocked && (
        <p className="notice" role="status">
          Close other tabs of this app to load your saved players.
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
