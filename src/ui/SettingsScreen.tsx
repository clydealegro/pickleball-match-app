import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../sync/auth';

interface Props {
  onBack: () => void;
}

export function SettingsScreen({ onBack }: Props) {
  const { status, email, error, busy, sendCode, verifyCode, changeEmail, signOut } = useAuthStore();
  const [emailInput, setEmailInput] = useState('');
  const [code, setCode] = useState('');

  function submitEmail(event: FormEvent) {
    event.preventDefault();
    void sendCode(emailInput);
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    void verifyCode(code);
  }

  return (
    <div className="stack">
      <div className="row-flex spread">
        <h1 className="screen-title">Settings</h1>
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
      </div>

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
              Sign in with your email. There is no password: we email you a 6-digit code. Backing up your saved players
              comes in a later update.
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
              {busy ? 'Sending…' : 'Send me a code'}
            </button>
          </form>
        )}

        {status === 'codeSent' && (
          <form className="stack" onSubmit={submitCode}>
            <p>
              We sent a 6-digit code to <strong style={{ overflowWrap: 'anywhere' }}>{email}</strong>. It can take a minute to arrive.
            </p>
            <label className="label" htmlFor="auth-code">
              6-digit code
            </label>
            <input
              id="auth-code"
              className="field"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              // Keep only the digits, so a code pasted as "123 456" or "123-456" still works.
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setCode('');
                changeEmail();
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        {status === 'signedIn' && (
          <>
            <p>
              Signed in as <strong style={{ overflowWrap: 'anywhere' }}>{email}</strong>.
            </p>
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
    </div>
  );
}
