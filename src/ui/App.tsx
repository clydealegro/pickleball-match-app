import { useEffect, useRef, useState } from 'react';
import { useRosterStore } from '../store/rosterStore';
import { useAuthStore } from '../sync/auth';
import { startSyncCoordinator } from '../sync/coordinator';
import { useUpdateStore } from '../pwa';
import { useHistoryStore } from '../store/historyStore';
import { useSessionStore } from '../store/sessionStore';
import { AccountButton } from './AccountButton';
import { ErrorBoundary } from './ErrorBoundary';
import { SignInBanner } from './SignInBanner';
import { BoardScreen } from './BoardScreen';
import { HomeScreen, type SessionPlan } from './HomeScreen';
import { LiveScreen } from './LiveScreen';
import { PastSessionsScreen } from './PastSessionsScreen';
import { SavedPlayersScreen } from './SavedPlayersScreen';
import { SettingsScreen } from './SettingsScreen';
import { SetupScreen } from './SetupScreen';
import { SummaryScreen, confirmLeave } from './SummaryScreen';
import { applyMotionPref } from './motion';
import { KEEP_AWAKE_KEY, REDUCE_MOTION_KEY, useBoolPref } from './prefs';
import { useSessionConflict } from './useSessionConflict';
import { useScreenHistory } from './useScreenHistory';
import { useWakeLock } from './useWakeLock';

type View = 'home' | 'setup' | 'saved' | 'settings' | 'history' | 'summary' | 'live' | 'board';

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
  const [reduceMotion] = useBoolPref(REDUCE_MOTION_KEY, false);
  const sessionConflict = useSessionConflict();
  // 'live' is the session's own screen (live court, or the summary once it ended). A running session at load
  // starts there; Home is also reachable over a running session.
  const [view, setView] = useState<View>(session ? 'live' : 'home');
  // Who's playing is opened from Home, with the slot's plan or none for a one-off session. It stays mounted
  // (hidden) while Saved players or Settings are open on top of it, so a half-filled form survives the trip.
  const [setupOpen, setSetupOpen] = useState(false);
  const [plan, setPlan] = useState<SessionPlan | undefined>(undefined);
  // Saved players can be opened from Setup or from Settings; Settings and Past sessions can be opened from Home
  // or Setup (Past sessions also from Settings). Back returns to whichever it came from.
  const [savedFrom, setSavedFrom] = useState<'setup' | 'settings'>('setup');
  const [settingsFrom, setSettingsFrom] = useState<'home' | 'setup' | 'live'>('home');
  const [historyFrom, setHistoryFrom] = useState<'home' | 'settings'>('settings');
  // Past sessions can open one session's summary straight away (from the done card on Home).
  const [historyOpenId, setHistoryOpenId] = useState<string | undefined>(undefined);

  // The browser history follows the screens, so the phone's Back button steps back one screen. Every forward move
  // pushes an entry, and every in-app Back steps the history back too, so the stack and the screen agree.
  // The logo takes the summary's Done route when a session has ended, and the summary registers it here.
  const leaveSummary = useRef<(() => void) | null>(null);
  // The logo goes Home over Who's playing without closing it, so Back finds the half-filled form.
  const keepSetup = useRef(false);

  const screens = useScreenHistory<View>({
    root: session ? 'live' : 'home',
    // A history entry that cannot be shown now (no session, no draft, nothing foreign) falls back to the root screen.
    resolve: (v) => {
      const fallback = session ? 'live' : 'home';
      switch (v) {
        case 'home':
          return session?.endedAt ? 'live' : 'home';
        case 'live':
          return fallback;
        case 'board':
          // The board only shows while a session is running.
          return session && !session.endedAt ? 'board' : fallback;
        case 'setup':
          return !session && setupOpen ? 'setup' : fallback;
        case 'saved':
        case 'settings':
        case 'history':
          return v;
        case 'summary':
          return historyOpenId ? 'summary' : 'history';
        default:
          return fallback;
      }
    },
    show: (v) => {
      setView(v);
      // Landing on Home with no session means Who's playing is gone, like its own Back button does.
      if (v === 'home' && !session && !keepSetup.current) {
        setSetupOpen(false);
        setPlan(undefined);
      }
    },
  });

  const openSaved = (from: 'setup' | 'settings') => {
    setSavedFrom(from);
    screens.push('saved');
  };
  const openSettings = () => {
    if (view === 'setup' || (view === 'saved' && savedFrom === 'setup')) setSettingsFrom('setup');
    else setSettingsFrom(view === 'live' ? 'live' : 'home');
    screens.push('settings');
  };
  const openHistory = (from: 'home' | 'settings', openId?: string) => {
    setHistoryFrom(from);
    setHistoryOpenId(openId);
    screens.push('history');
    // The summary sits above the list, so Back from it lands on the list.
    if (openId) screens.push('summary');
  };
  const openBoard = () => screens.push('board');
  const openSetup = (p: SessionPlan | undefined) => {
    setPlan(p);
    setSetupOpen(true);
    screens.push('setup');
  };

  // The logo is Home. Over an ended session that means leaving it, like Done, so it asks the same question.
  const goHome = () => {
    if (session?.endedAt) {
      if (leaveSummary.current) leaveSummary.current();
      else if (confirmLeave(session, useHistoryStore.getState().entries.some((e) => e.id === session.id), false)) useSessionStore.getState().reset();
      return;
    }
    keepSetup.current = true;
    screens.push('home');
    keepSetup.current = false;
  };

  // When the session goes away (Done on the summary), the app lands on Home with a clean Who's playing.
  const [hadSession, setHadSession] = useState(!!session);
  if (hadSession !== !!session) {
    setHadSession(!!session);
    if (!session) {
      setView('home');
      setSetupOpen(false);
      setPlan(undefined);
    } else if (view === 'setup' || view === 'home') {
      // A session just started: its screen takes over from Who's playing.
      setView('live');
    }
  }

  // A session that ends under the board shows its summary, and the board's history entry becomes the live screen's,
  // so Back or Forward can never land on the board again.
  const ended = !!session?.endedAt;
  useEffect(() => {
    if (!ended || view !== 'board') return;
    setView('live');
    screens.replace('live');
  }, [ended, view, screens]);

  // Done makes the current entry the first one again; a new session takes over the entry Who's playing held.
  // The first run is skipped: the hook already wrote the root marker on load.
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      return;
    }
    if (!hadSession) screens.resetRoot('home');
    else screens.replace('live');
  }, [hadSession, screens]);

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

  // Tells the stylesheet whether the organizer switched motion off.
  useEffect(() => {
    applyMotionPref();
  }, [reduceMotion]);

  // The screen stays on for as long as a session is running, however many screens the organizer visits.
  useWakeLock(!!session && !session.endedAt && keepAwake);

  // Keeps saved players backed up while signed in. It does nothing without a backend or a signed-in organizer.
  useEffect(() => startSyncCoordinator(), []);

  const overlay =
    view === 'saved' ? (
      <SavedPlayersScreen onBack={() => screens.back(savedFrom)} />
    ) : view === 'settings' ? (
      <SettingsScreen onBack={() => screens.back(settingsFrom)} onManage={() => openSaved('settings')} onHistory={() => openHistory('settings')} />
    ) : view === 'history' || view === 'summary' ? (
      <PastSessionsScreen
        openId={view === 'summary' ? historyOpenId : undefined}
        onOpen={(id) => {
          setHistoryOpenId(id);
          screens.push('summary');
        }}
        onCloseSummary={() => screens.back('history')}
        onBack={() => screens.back(historyFrom)}
      />
    ) : null;

  // Home shown over a running session: the Live hero and a way back, nothing that could start another session.
  const homeOverLive = !!session && !session.endedAt && view === 'home';

  let screen;
  if (homeOverLive) {
    screen = (
      <>
        <SignInBanner onSignIn={openSettings} />
        <HomeScreen
          onStart={openSetup}
          onResume={() => screens.back('live')}
          onHistory={() => openHistory('home')}
          onViewSummary={(id) => openHistory('home', id)}
        />
      </>
    );
  } else if (!session) {
    screen = (
      <>
        {setupOpen && (
          <div hidden={view !== 'setup'}>
            <SignInBanner onSignIn={openSettings} />
            <SetupScreen
              plan={plan}
              onBack={() => screens.back('home')}
              onManage={() => openSaved('setup')}
            />
          </div>
        )}
        {view === 'home' && (
          <>
            <SignInBanner onSignIn={openSettings} />
            <HomeScreen onStart={openSetup} onResume={() => {}} onHistory={() => openHistory('home')} onViewSummary={(id) => openHistory('home', id)} />
          </>
        )}
        {overlay}
      </>
    );
  } else if (overlay) {
    screen = overlay;
  } else if (session.endedAt) {
    screen = <SummaryScreen session={session} leaveRef={leaveSummary} />;
  } else if (view === 'board') {
    screen = <BoardScreen session={session} onClose={() => screens.back('live')} />;
  } else {
    screen = <LiveScreen session={session} onHome={() => screens.push('home')} onSettings={openSettings} onShowBoard={openBoard} />;
  }

  // The live screen has its own slim top bar, so the app's title bar is left out to give the court the room.
  // The board covers the whole screen, so the title bar is left out under it too.
  const live = !!session && !session.endedAt && !overlay && (view === 'live' || view === 'board');

  // On Home itself the logo has nowhere to go.
  const atHome = view === 'home' && !session?.endedAt;

  return (
    <div className="app">
      {!live && (
        <header className="app-header">
          <button type="button" className="app-logo-btn" aria-label="Home" aria-current={atHome ? 'page' : undefined} disabled={atHome} onClick={goHome}>
            <img className="app-logo" src={`${import.meta.env.BASE_URL}brand/logo.svg`} alt="" width={36} height={36} />
          </button>
          {view !== 'settings' && view !== 'history' && view !== 'summary' && <AccountButton onClick={openSettings} />}
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
