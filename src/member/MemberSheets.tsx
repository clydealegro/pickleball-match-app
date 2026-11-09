import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Sheet } from '../ui/Sheet';
import type { ActionResult } from './useMemberPage';

const BAD_NAME = 'Use 1 to 40 characters.';
// How long the thank you stays before the sheet closes.
const SHOW_MS = 1500;

interface NameSheetProps {
  title: string;
  label: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<ActionResult>;
  onClose: () => void;
}

type Shown = { text: string; ok: boolean } | null;

function NameSheet({ title, label, submitLabel, onSubmit, onClose }: NameSheetProps) {
  const id = useId();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState<Shown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 40) {
      setShown({ text: BAD_NAME, ok: false });
      return;
    }
    setPending(true);
    setShown(null);
    const result = await onSubmit(clean);
    if (result.ok) {
      setShown({ text: result.message, ok: true });
      timer.current = setTimeout(() => closeRef.current(), SHOW_MS);
      return;
    }
    setPending(false);
    // A failure with no words is one the page shows by itself, like a cancelled week.
    if (result.message === '') closeRef.current();
    else setShown({ text: result.message, ok: false });
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form className="member-form" onSubmit={submit} noValidate>
        <label className="label" htmlFor={id}>
          {label}
        </label>
        <input id={id} className="member-input" value={name} maxLength={40} autoComplete="off" disabled={pending} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="member-submit" disabled={pending}>
          {submitLabel}
        </button>
        {shown && (
          <p className="member-message" role={shown.ok ? 'status' : 'alert'}>
            {shown.text}
          </p>
        )}
      </form>
    </Sheet>
  );
}

interface SheetProps {
  onSubmit: (name: string) => Promise<ActionResult>;
  onClose: () => void;
}

export function FriendSheet(props: SheetProps) {
  return <NameSheet title="Bring a friend" label="Friend's name" submitLabel="Add friend" {...props} />;
}

export function JoinSheet(props: SheetProps) {
  return <NameSheet title="Ask to join" label="Your name" submitLabel="Send" {...props} />;
}
