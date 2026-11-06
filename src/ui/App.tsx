import { useEffect, useState } from 'react';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { ErrorBoundary } from './ErrorBoundary';
import { LiveScreen } from './LiveScreen';
import { SavedPlayersScreen } from './SavedPlayersScreen';
import { SetupScreen } from './SetupScreen';
import { SummaryScreen } from './SummaryScreen';
import { ThemeToggle } from './ThemeToggle';

export default function App() {
  const session = useSessionStore((s) => s.session);
  const saveFailed = useSessionStore((s) => s.saveFailed);
  const rosterPersistent = useRosterStore((s) => s.persistent);
  const loadRoster = useRosterStore((s) => s.load);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    // A failing roster load is already reflected by the store's `persistent` flag.
    loadRoster().catch(() => {});
  }, [loadRoster]);

  let screen;
  if (!session) {
    // Setup stays mounted (just hidden) so a half-filled form survives a trip to Saved players.
    screen = (
      <>
        <div hidden={managing}>
          <SetupScreen onManage={() => setManaging(true)} />
        </div>
        {managing && <SavedPlayersScreen onBack={() => setManaging(false)} />}
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
