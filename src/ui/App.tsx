import { useEffect, useState } from 'react';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
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
    void loadRoster();
  }, [loadRoster]);

  let screen;
  if (!session) {
    screen = managing ? (
      <SavedPlayersScreen onBack={() => setManaging(false)} />
    ) : (
      <SetupScreen onManage={() => setManaging(true)} />
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
        <p className="notice" role="status">
          Not saved — this browser is blocking storage. The session still works, but a refresh will lose it.
        </p>
      )}
      {!rosterPersistent && (
        <p className="notice" role="status">
          Saved players can't be stored in this browser, so names will be forgotten when the app closes.
        </p>
      )}
      <main>{screen}</main>
    </div>
  );
}
