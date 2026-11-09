import { Component, type ReactNode } from 'react';
import { getMemberClient } from './client';
import { MemberPage } from './MemberPage';
import { supabaseMemberRemote, type MemberRemote } from './remote';

let made: MemberRemote | null | undefined;

/** The real remote, made once, or null in a build with no backend. */
function defaultRemote(): MemberRemote | null {
  if (made === undefined) {
    const client = getMemberClient();
    made = client ? supabaseMemberRemote(client) : null;
  }
  return made;
}

// Its own small boundary, so the member page needs nothing from the organizer app.
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('The member page failed to draw.', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="member">
        <span className="member-brand">PIKL</span>
        <p className="member-message" role="alert">
          Something went wrong opening this page.
        </p>
        <button type="button" className="member-retry" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}

/** The root for a join link. `remote` is only given by tests and the browser check. */
export function MemberRoot({ code, remote }: { code: string; remote?: MemberRemote | null }) {
  return (
    <Boundary>
      <MemberPage code={code} remote={remote === undefined ? defaultRemote() : remote} />
    </Boundary>
  );
}
