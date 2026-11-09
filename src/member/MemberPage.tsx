import { useCallback, useEffect, useState } from 'react';
import { clock12, whenLine } from './format';
import { LiveBoardView, LivePaused } from './LiveBoardView';
import { MemberAnswer } from './MemberAnswer';
import { MemberCancelled } from './MemberCancelled';
import { MemberPicker } from './MemberPicker';
import type { MemberRemote } from './remote';
import { useLiveBoard } from './useLiveBoard';
import { useMemberPage, type ActionResult } from './useMemberPage';

const localClock = (at: number) => {
  const d = new Date(at);
  return clock12(d.getHours() * 60 + d.getMinutes());
};

/** The page a member opens from the group chat. Picks the screen for what the hook says. */
export function MemberPage({ code, remote }: { code: string; remote: MemberRemote | null }) {
  const page = useMemberPage(code, remote);
  const live = useLiveBoard(code, remote);
  const { phase, view, stale, error, me } = page;
  const { addFriend, askToJoin } = page;
  // The hook gives the words but not whether they were good news, so the successes are noted here.
  const [good, setGood] = useState<string | null>(null);

  const rememberGood = useCallback(
    async (send: (name: string) => Promise<ActionResult>, name: string) => {
      const result = await send(name);
      if (result.ok) setGood(result.message);
      return result;
    },
    [],
  );
  const onAddFriend = useCallback((name: string) => rememberGood(addFriend, name), [rememberGood, addFriend]);
  const onAskToJoin = useCallback((name: string) => rememberGood(askToJoin, name), [rememberGood, askToJoin]);

  const showingLive = (live.phase === 'live' && live.board !== null) || live.phase === 'paused';
  const title = showingLive ? live.board?.title : view?.title;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  // While a live board is up, or the page is still finding out, the list is not what a visitor came for.
  if (showingLive) {
    return (
      <main className="member member-live">
        <header className="member-head">
          <span className="member-brand">PIKL</span>
        </header>
        {live.phase === 'paused' || !live.board ? (
          <LivePaused />
        ) : (
          <LiveBoardView board={live.board} faces={live.showPhotos ? live.faces : {}} ageS={live.ageS} fetchedAt={live.fetchedAt} failed={live.failed} />
        )}
      </main>
    );
  }

  let body;
  if (live.phase === 'checking') {
    body = <p className="member-note">Opening the list</p>;
  } else if (phase === 'unavailable') {
    body = <p className="member-note">This link cannot be opened in this build.</p>;
  } else if (phase === 'loading') {
    body = <p className="member-note">Opening the list</p>;
  } else if (phase === 'notfound') {
    body = <p className="member-note">This link is not working. Ask your organizer for the new one.</p>;
  } else if (phase === 'failed' || !view) {
    body = (
      <div className="member-section">
        <p className="member-message" role="alert">
          Could not open the list. Try again.
        </p>
        {error === 'offline' && <p className="member-note">You seem to be offline.</p>}
        <button type="button" className="member-retry" onClick={page.retry}>
          Retry
        </button>
      </div>
    );
  } else if (view.cancelled) {
    body = <MemberCancelled view={view} />;
  } else if (!me) {
    body = <MemberPicker players={view.players} onPick={page.pick} onAskToJoin={onAskToJoin} />;
  } else {
    body = (
      <MemberAnswer
        view={view}
        me={me}
        busy={page.busy}
        message={page.message ? { text: page.message, ok: page.message === good } : null}
        onAnswer={(status, late) => void page.answer(status, late)}
        onForget={page.forget}
        onAddFriend={onAddFriend}
      />
    );
  }

  return (
    <main className="member">
      <header className="member-head">
        <span className="member-brand">PIKL</span>
        {view && <h1 className="member-title">{view.title}</h1>}
        {view && !view.cancelled && <p className="member-when">{whenLine(view)}</p>}
        {stale && <p className="member-stale">Updated {localClock(stale.at)}</p>}
        {stale?.offline && <p className="member-stale">Offline, showing the last list</p>}
      </header>
      {body}
    </main>
  );
}
