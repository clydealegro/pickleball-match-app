import { useEffect, useState } from 'react';
import { useRosterStore } from '../store/rosterStore';
import { useAuthStore } from '../sync/auth';
import { startSyncCoordinator } from '../sync/coordinator';
import { useUpdateStore } from '../pwa';
import { useHistoryStore } from '../store/historyStore';
import { useSessionStore } from '../store/sessionStore';
import { AccountButton } from './AccountButton';
import { ErrorBoundary } from './ErrorBoundary';
import { SignInBanner } from './SignInBanner';
import { HomeScreen, type SessionPlan } from './HomeScreen';
import { LiveScreen } from './LiveScreen';
import { PastSessionsScreen } from './PastSessionsScreen';
import { SavedPlayersScreen } from './SavedPlayersScreen';
import { SettingsScreen } from './SettingsScreen';
import { SetupScreen } from './SetupScreen';
import { SummaryScreen } from './SummaryScreen';
import { KEEP_AWAKE_KEY, useBoolPref } from './prefs';
import { useSessionConflict } from './useSessionConflict';
import { useWakeLock } from './useWakeLock';

export default function App() {
  const session = useSessionStore((s) => s.session);
  const saveFailed = useSessionStore((s) => s.saveFailed);
  const updateReady = useUpdateStore((s) => s.ready);
  const applyUpdate = useUpdateStore((s) => s.apply);
  const rosterPersistent = useRosterStore((s) => s.persistent);
  const rosterBlocked = useRosterStore((s) => s.blocked);
  const loadRoster = useRosterStore((s) => s.load);
  const loadHistory = useHistoryStore((s) => s.load);
  const initAuth = useAuthStore((s) => s.init);
  const [keepAwake] = useBoolPref(KEEP_AWAKE_KEY, true);
  const sessionConflict = useSessionConflict();
  const [view, setView] = useState<'home' | 'setup' | 'saved' | 'settings' | 'history'>('home');
  // Who's playing is opened from Home, with the slot's plan or none for a one-off session. It stays mounted
  // (hidden) while Saved players or Settings are open on top of it, so a half-filled form survives the trip.
  const [setupOpen, setSetupOpen] = useState(false);
  const [plan, setPlan] = useState<SessionPlan | undefined>(undefined);
  // Saved players can be opened from Setup or from Settings; Settings and Past sessions can be opened from Home
  // or Setup (Past sessions also from Settings). Back returns to whichever it came from.
  const [savedFrom, setSavedFrom] = useState<'setup' | 'settings'>('setup');
  const [settingsFrom, setSettingsFrom] = useState<'home' | 'setup'>('home');
  const [historyFrom, setHistoryFrom] = useState<'home' | 'settings'>('settings');
  const openSaved = (from: 'setup' | 'settings') => {
    setSavedFrom(from);
    setView('saved');
  };
  const openSettings = () => {
    setSettingsFrom(view === 'setup' || (view === 'saved' && savedFrom === 'setup') ? 'setup' : 'home');
    setView('settings');
  };
  const openHistory = (from: 'home' | 'settings') => {
    setHistoryFrom(from);
    setView('history');
  };
  const openSetup = (p: SessionPlan | undefined) => {
    setPlan(p);
    setSetupOpen(true);
    setView('setup');
  };

  // When the session goes away (Start new session), the app lands on Home with a clean Who's playing.
  const [hadSession, setHadSession] = useState(!!session);
  if (hadSession !== !!session) {
    setHadSession(!!session);
    if (!session) {
      setView('home');
      setSetupOpen(false);
      setPlan(undefined);
    }
  }

  useEffect(() => {
    // A failing roster load is already reflected by the store's `persistent` flag.
    loadRoster().catch(() => {});
  }, [loadRoster]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  // The screen stays on for as long as a session is running, however many screens the organizer visits.
  useWakeLock(!!session && !session.endedAt && keepAwake);

  // Keeps saved players backed up while signed in. It does nothing without a backend or a signed-in organizer.
  useEffect(() => startSyncCoordinator(), []);

  const overlay =
    view === 'saved' ? (
      <SavedPlayersScreen onBack={() => setView(savedFrom)} />
    ) : view === 'settings' ? (
      <SettingsScreen onBack={() => setView(settingsFrom)} onManage={() => openSaved('settings')} onHistory={() => openHistory('settings')} />
    ) : view === 'history' ? (
      <PastSessionsScreen onBack={() => setView(historyFrom)} />
    ) : null;

  let screen;
  if (!session) {
    screen = (
      <>
        {setupOpen && (
          <div hidden={view !== 'setup'}>
            <SignInBanner onSignIn={openSettings} />
            <SetupScreen
              plan={plan}
              onBack={() => {
                setSetupOpen(false);
                setPlan(undefined);
                setView('home');
              }}
              onManage={() => openSaved('setup')}
            />
          </div>
        )}
        {view === 'home' && (
          <>
            <SignInBanner onSignIn={openSettings} />
            <HomeScreen onStart={openSetup} onHistory={() => openHistory('home')} />
          </>
        )}
        {overlay}
      </>
    );
  } else if (overlay) {
    screen = overlay;
  } else if (session.endedAt) {
    screen = <SummaryScreen session={session} />;
  } else {
    screen = <LiveScreen session={session} onSettings={openSettings} />;
  }

  // The live screen has its own slim top bar, so the app's title bar is left out to give the court the room.
  const live = !!session && !session.endedAt && !overlay;

  return (
    <div className="app">
      {!live && (
        <header className="app-header">
          <span className="app-title">PIKLMatch</span>
          {view !== 'settings' && view !== 'history' && <AccountButton onClick={openSettings} />}
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
      {sessionConflict && (
        <p className="notice" role="status">
          This session was changed in another window.{' '}
          <button type="button" className="btn btn-small" onClick={() => window.location.reload()}>
            Reload
          </button>
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
