import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../sync/auth';
import { clearThisDevice, deleteAllMyData, type DataResult } from '../sync/dataActions';
import { useSyncStore } from '../sync/syncStore';
import { RatingsSection } from './RatingsSection';
import { SyncStatusLine } from './SyncStatusLine';
import { useDefaultMode } from './matchmaking';
import { AUTO_START_KEY, KEEP_AWAKE_KEY, PLAY_TO_CHOICES, REDUCE_MOTION_KEY, REGULARS_FIRST_KEY, useBoolPref, usePlayTo, VIBRATE_KEY } from './prefs';
import { useTheme } from './useTheme';

interface Props {
  onBack: () => void;
  onManage: () => void;
  onHistory: () => void;
}

export function SettingsScreen({ onBack, onManage, onHistory }: Props) {
  const [regularsFirst, setRegularsFirst] = useBoolPref(REGULARS_FIRST_KEY, true);
  const { status, email, error, busy, sendLink, changeEmail, signOut } = useAuthStore();
  const [emailInput, setEmailInput] = useState('');
  const syncStatus = useSyncStore((s) => s.status);
  const [theme, toggleTheme] = useTheme();
  const [mode, setMode] = useDefaultMode();
  const [keepAwake, setKeepAwake] = useBoolPref(KEEP_AWAKE_KEY, true);
  const [vibrate, setVibrate] = useBoolPref(VIBRATE_KEY, true);
  const [reduceMotion, setReduceMotion] = useBoolPref(REDUCE_MOTION_KEY, false);
  const [autoStart, setAutoStart] = useBoolPref(AUTO_START_KEY, false);
  const [playTo, setPlayTo] = usePlayTo();
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<{ result: DataResult; done: string } | null>(null);

  /** Asks first, then runs one of the data actions and says how it went. */
  async function runDataAction(question: string, action: () => Promise<DataResult>, done: string) {
    if (working || !window.confirm(question)) return;
    setWorking(true);
    setOutcome(null);
    try {
      setOutcome({ result: await action(), done });
    } finally {
      setWorking(false);
    }
  }

  function submitEmail(event: FormEvent) {
    event.preventDefault();
    void sendLink(emailInput);
  }

  return (
    <div className="stack">
      <div className="row-flex spread">
        <h1 className="screen-title">Settings</h1>
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
      </div>

      <section className="card stack" aria-labelledby="look-title">
        <h2 id="look-title" className="section-title">
          Appearance
        </h2>
        <div className="options" role="radiogroup" aria-label="Theme">
          {(['dark', 'light'] as const).map((t) => (
            <label key={t} className="option">
              <input type="radio" name="theme" checked={theme === t} onChange={() => theme !== t && toggleTheme()} />
              <span>{t === 'dark' ? 'Dark' : 'Light'}</span>
            </label>
          ))}
        </div>
        <label className="switch-row">
          <span>Reduce motion</span>
          <input type="checkbox" role="switch" checked={reduceMotion} onChange={(e) => setReduceMotion(e.target.checked)} />
        </label>
      </section>

      <section className="card stack" aria-labelledby="mode-title">
        <h2 id="mode-title" className="section-title">
          Matchmaking
        </h2>
        <div className="options" role="radiogroup" aria-label="Matchmaking">
          <label className="option">
            <input type="radio" name="mode" checked={mode === 'fairness'} onChange={() => setMode('fairness')} />
            <span>Fairness (recommended)</span>
          </label>
          <label className="option">
            <input type="radio" name="mode" checked={mode === 'queue'} onChange={() => setMode('queue')} />
            <span>Simple queue</span>
          </label>
        </div>
        <p className="muted">Applies to new sessions. Fairness gives the players with the fewest games the next court. Simple queue goes in the order people arrive.</p>
      </section>

      <section className="card stack" aria-labelledby="during-title">
        <h2 id="during-title" className="section-title">
          During a session
        </h2>
        <label className="switch-row">
          <span>Keep the screen on</span>
          <input type="checkbox" role="switch" checked={keepAwake} onChange={(e) => setKeepAwake(e.target.checked)} />
        </label>
        <label className="switch-row">
          <span>Buzz when a game finishes</span>
          <input type="checkbox" role="switch" checked={vibrate} onChange={(e) => setVibrate(e.target.checked)} />
        </label>
        <p className="muted">The buzz only works on phones and browsers that allow it.</p>
        <label className="switch-row">
          <span>Start the next game by itself</span>
          <input type="checkbox" role="switch" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
        </label>
        <p className="muted">Off: you press Start for each game, so players have time to reach the court. On: a game starts the moment the last one finishes. It applies to new sessions.</p>
        <p className="label" id="play-to-label">
          Play to
        </p>
        <div className="options" role="radiogroup" aria-labelledby="play-to-label">
          {PLAY_TO_CHOICES.map((n) => (
            <label key={n} className="option">
              <input type="radio" name="play-to" checked={playTo === n} onChange={() => setPlayTo(n)} />
              <span>{n}</span>
            </label>
          ))}
        </div>
        <p className="muted">Where the winning score starts when you record a result.</p>
      </section>

      <section className="card stack" aria-labelledby="players-title">
        <h2 id="players-title" className="section-title">
          Players
        </h2>
        <button type="button" className="btn" onClick={onManage}>
          Manage players
        </button>
        <p className="muted">Rename or remove saved players, and add their photos.</p>
        <button type="button" className="btn" onClick={onHistory}>
          Past sessions
        </button>
        <p className="muted">Look back at sessions you have ended. They stay on this phone.</p>
        <label className="switch-row">
          <span>Show regulars first</span>
          <input type="checkbox" role="switch" checked={regularsFirst} onChange={(e) => setRegularsFirst(e.target.checked)} />
        </label>
        <p className="muted">When you set up a session, the people who come most often are listed first.</p>
      </section>

      <RatingsSection />

      <section className="card stack" aria-labelledby="account-title">
        <h2 id="account-title" className="section-title">
          Account
        </h2>

        {status === 'unconfigured' && (
          <p className="muted">Sign-in is not set up in this version of the app. Your saved players stay on this device.</p>
        )}

        {status === 'loading' && (
          <p className="muted" role="status">
            Checking sign-in…
          </p>
        )}

        {status === 'unknown' && (
          <p className="muted" role="status">
            Can't check sign-in without a connection. Your saved players are safe on this device.
          </p>
        )}

        {/* noValidate on the email form: our own message for a bad address, instead of each browser's tooltip. */}
        {status === 'signedOut' && (
          <form className="stack" noValidate onSubmit={submitEmail}>
            <p className="muted">
              Sign in with your email. There is no password: we email you a link. Once you are signed in, your saved
              players and their photos are backed up online and shared between your devices.
            </p>
            <label className="label" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              className="field"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !emailInput.trim()}>
              {busy ? 'Sending…' : 'Send me a link'}
            </button>
          </form>
        )}

        {status === 'linkSent' && (
          <div className="stack">
            <p>
              We sent a sign-in link to <strong style={{ overflowWrap: 'anywhere' }}>{email}</strong>. It can take a minute to
              arrive. Open it on this device. It works once.
            </p>
            <button type="button" className="btn" disabled={busy} onClick={() => void sendLink(email ?? '')}>
              {busy ? 'Sending…' : 'Send the link again'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={changeEmail}>
              Use a different email
            </button>
          </div>
        )}

        {status === 'signedIn' && (
          <>
            <p>
              Signed in as <strong style={{ overflowWrap: 'anywhere' }}>{email}</strong>.
            </p>
            <SyncStatusLine />
            {syncStatus === 'otherAccount' && (
              <p className="error" role="alert">
                This device holds saved players from a different account, so nothing is synced. Clear the saved players on this
                device below to start syncing this account, or sign out.
              </p>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      {status !== 'loading' && (
        <section className="card stack" aria-labelledby="data-title">
          <h2 id="data-title" className="section-title">
            Your data
          </h2>
          <button
            type="button"
            className="btn"
            disabled={working}
            onClick={() =>
              void runDataAction(
                'Clear the saved players and photos on this device? Anything backed up to an account stays there.',
                clearThisDevice,
                'Cleared. This device has no saved players now.',
              )
            }
          >
            Clear saved players on this device
          </button>
          <p className="muted">
            Removes them from this device only.{' '}
            {status === 'signedIn'
              ? 'They come back from your account the next time this device syncs.'
              : 'If you backed them up, they are still in your account.'}
          </p>
          {status === 'signedIn' && (
            <>
              <button
                type="button"
                className="btn btn-danger"
                disabled={working}
                onClick={() =>
                  void runDataAction(
                    'Delete all your saved players and photos from your account and from this device? This cannot be undone.',
                    deleteAllMyData,
                    'Deleted. Your account and this device have no saved players now.',
                  )
                }
              >
                Delete all my data
              </button>
              <p className="muted">Deletes every saved player and photo from your account and from this device. This cannot be undone.</p>
            </>
          )}
          {working && (
            <p className="muted" role="status">
              Working…
            </p>
          )}
          {outcome &&
            (outcome.result.ok ? (
              <p role="status">{outcome.done}</p>
            ) : (
              <p className="error" role="alert">
                {outcome.result.message}
              </p>
            ))}
        </section>
      )}
    </div>
  );
}
