import { joinChanged, parseJoinHash } from './member/route';

export type RootChoice = { kind: 'member'; code: string } | { kind: 'app' };

/** The member page for a join hash like "#/j/abc123", the organizer app for anything else. */
export function chooseRoot(hash: string): RootChoice {
  const code = parseJoinHash(hash);
  return code ? { kind: 'member', code } : { kind: 'app' };
}

/** Reloads the page when the join code in the address changes, so a pasted link in an open tab works. */
export function watchJoin(
  code: string | null,
  win: { location: { hash: string }; addEventListener: (type: 'hashchange', fn: () => void) => void },
  reload: () => void,
): void {
  win.addEventListener('hashchange', () => {
    if (joinChanged(code, win.location.hash)) reload();
  });
}
