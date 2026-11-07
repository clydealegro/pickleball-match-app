# PIKLMatch: the organizer experience, in phases

Date: 2026-11-07
Status: approved in direction on 7 Nov 2026. Phases 1 and 2 are committed to; 3 to 5 each get their own plan. Nothing here is built.
Builds on: `2026-11-06-pickleball-matchmaking-design.md` (the v1 design). Where this document and that one disagree, this one wins for the items below. Section "Changes to the v1 scope" lists them.

## Why this exists

On 7 Nov 2026 the app was audited end to end from the organizer's seat (the person who stands at the courts with one phone and runs open play). The visual work is done: the live screen, the summary, New session, Saved players and Settings were all redesigned that day. What the audit found next is a set of gaps in how the app helps the organizer **run a session**, **take control when real life breaks the plan**, **remember what happened**, and **let other people see and trust the queue**. This spec folds every finding into phases that can each ship on their own.

## Principles

1. **The organizer is in a hurry, one-handed, often in bright sun.** Any action done during play takes two taps or fewer. Tap targets stay at 44 px or more. Text stays readable outdoors.
2. **Local first.** The live session works with no signal. Anything that needs the network is optional and never blocks play.
3. **Every action is one undo step.** Swaps, pins, skips and substitutions each undo with one tap, like Game finished does today.
4. **One coloured thing per screen.** Lime stays for the main action only. New controls are neutral.
5. **No nagging.** Reminders are visual by default. Sounds and vibration are off or tiny, and never repeat.
6. **Small, reversible changes first.** Session data only gains optional fields, so a session saved by an older build still loads (the validator in `src/store/persistence.ts` checks required fields only).
7. **Words follow VOICE.md.** Plain, short, no em dashes.

## The phases at a glance

| Phase | Name | What the organizer gets | Needs backend? | Size |
|---|---|---|---|---|
| 1 | Run it smoothly | Screen stays on, a toast with the new lineup and Undo, a visible Add player, courts remembered, "why am I waiting", second-tab safety | No | Small |
| 2 | Take control | Swap players, play next, skip a turn, "not here" in one tap | No | Medium |
| 3 | Remember | Session history, attendance, regulars first, suggested groups | No (local only) | Medium |
| 4 | Share and show | A shareable result card, highlights, a board view for a TV, a game-length nudge, a sunlight theme, a little delight | No | Medium |
| 5 | Open it up | Other organizers can sign in, resume a session on another phone, a read-only live link for players, named groups and history that sync | Yes | Large |

**Why this order.** Phases 1 and 2 fix problems the organizer meets every session and need no new infrastructure. Phase 3 needs Phase 2's data to be stable. Phase 4 builds on Phase 3's history (highlights, share card). Phase 5 is the only one that touches Supabase, so it goes last and is split so each piece ships alone.

Phases 1 and 2 are the ones to commit to now. Phases 3 to 5 are agreed in direction; each gets its own plan before building.

## Changes to the v1 scope

The v1 design lists these as out of scope. This spec moves them in:

- **Read-only live view for players** (Phase 4 board view on the same device, Phase 5 live link). The v1 design says "live sync of the session itself so players can follow along on their own phones" is out of scope. It comes in at Phase 5, read-only. Players still never log in.
- **Session history beyond the current device** (Phase 3 local, Phase 5 synced).
- **Manual control of the queue** (Phase 2). The v1 design has no override.

Still out of scope: score entry and leaderboards, skill ratings and skill-balanced teams, shared group accounts, players logging in. See "Considered and not now" for why.

---

## Phase 1: Run it smoothly

Goal: remove the daily annoyances. No engine changes, except one small read-only helper.

### 1.1 Keep the screen awake during a session

**Problem.** The phone locks mid-session (verified: there is no wake lock anywhere in `src/`). Players then ask the organizer whose turn it is while the organizer unlocks the phone.

**Behaviour.**
- While a session is live (not ended), request a screen wake lock with `navigator.wakeLock.request('screen')`.
- Release it when the session ends or the summary shows. Opening Settings or Saved players does not release it, because the session is still live.
- The browser drops the lock when the tab is hidden. Re-request it on `visibilitychange` when the page becomes visible again and a live session exists.
- If the API is missing or the request fails, do nothing and say nothing.
- Settings gets a new card, **During a session**, with a switch "Keep the screen on" (on by default). It stores `pickleball.keepAwake`.

**Edge cases.** Battery saver can refuse the lock: ignore. Two tabs: each requests its own lock, harmless.

**Acceptance.** A live session requests one lock. Ending the session releases it. Going to the background and returning requests it again. With the setting off, no request is made. With no API, nothing throws.

### 1.2 A toast after Game finished

**Problem.** Tapping Game finished instantly starts the next game. Nothing on screen says so apart from names changing, and Undo is a small icon in the corner.

**Behaviour.**
- After Game finished (and after any action that changes a court: Phase 2 swaps, substitutions), show a toast at the bottom, above the Waiting sheet: **"Court 1: Ann and Ben vs Cy and Dee"** with an **Undo** button.
- If no new game could start, it reads **"Court 1 finished. Waiting for 2 more players."**
- It stays 8 seconds, or until the next action. A new toast replaces the old one (two courts finishing close together is normal).
- `role="status"` with polite announcement. The Undo button is a real button.
- One short vibration (`navigator.vibrate(25)`) on Game finished when supported and when "Vibrate on finish" is on (Settings, on by default).
- Tapping the toast body does nothing. It must never cover the Game finished button. The plan checks this at 412 by 850 and at 360 by 640, where the Waiting sheet sits in the page after the court and a fixed toast could otherwise overlap it.

**Acceptance.** Finishing a game shows the new lineup in names, with a working Undo that restores the previous state and closes the toast. Two quick finishes show only the latest. The toast text matches the lineup now on the court.

### 1.3 A visible Add player

**Problem.** On a phone the Add player button sits inside the Waiting sheet, which is collapsed by default (verified in `app.css`: `.waiting-body { display: none }` until open). Late arrivals are common and need two taps just to start.

**Behaviour.**
- A **+** icon button sits in the sheet handle row, outside the toggle button, always visible, labelled "Add player".
- The menu also gets **Add player** at the top.
- The existing `AddPlayerSheet` is unchanged.

**Acceptance.** With the sheet collapsed, one tap on + opens the Add player sheet. Tapping + does not expand or collapse the sheet.

### 1.4 Remember the number of courts

**Problem.** Courts reset to 2 every session (`useState(2)` in `SetupScreen`).

**Behaviour.** Store the last started court count in `pickleball.courts` and use it as the default (clamped to 1 to 12). A blocked storage falls back to 2.

**Acceptance.** Start with 4 courts, end, open New session: the stepper shows 4.

### 1.5 "Why am I waiting?"

**Problem.** Players ask why they are always last. The app knows the answer and does not say it.

**Behaviour.**
- New read-only engine helper `explainWaiting(session, playerId)` returns `{ position, reason }` for a waiting player.
- Reasons, in this order of precedence, in plain words:
  - Pinned (Phase 2): "You are playing next."
  - Fairness mode, fewest games: "Fewest games so far (2)."
  - Fairness mode, tie broken by waiting: "Waiting the longest among players with 2 games."
  - Fairness mode, still tied on games and wait: "Tied with others, so the order is a fixed random pick." (`compareByPriority` ends on the random `tieKey`.)
  - Queue mode: "Next in the order people arrived."
  - Fewer than four waiting: "Waiting for 2 more players."
- Shown as one muted line in the player sheet for a waiting player, under the games count, with the queue position ("3rd in line").

**Acceptance.** The helper's position matches `orderedWaiting`. The reason text for each case above is pinned by a test.

### 1.6 Second-tab safety

**Problem (from the Plan 1 review).** Two tabs, or the installed app plus a browser tab, each keep their own session in memory and the last save wins. Nothing listens for the `storage` event.

**Behaviour.** Listen for `storage` events on `pickleball.session.v1`. If another tab changed it, show a notice: "This session was changed in another window. Reload to see it." with a **Reload** button. Never reload by itself.

**Acceptance.** A change to the key from another tab raises the notice. Our own writes never do.

### Phase 1 definition of done
Tests for each item, typecheck and build clean, checked in the browser at 360 px, then on the owner's phone: screen stays on for 10 minutes, the toast, the + button. Ralph loop before merge.

---

## Phase 2: Take control

Goal: let the organizer fix real life without breaking the fairness data. This is the highest-value phase.

### The gap, verified in code

On a player who is on court, **Take a break** and **Leave** only set `pendingStatus`, applied when the game ends (`setPlayerStatus` in `src/engine/status.ts`). If someone does not show up or gets hurt, the game runs with three players until it finishes. There is no swap, no skip, no way to choose who plays next.

### Engine

Three new pure functions, each returning a new session, each validated like the existing ones (`EngineError` with a clear message):

1. **`swapPlayers(s, aId, bId, ctx)`**
   - Valid pairs: waiting with a player on court (substitution), or a player on one court with a player on another court (or the same court, moving them to the other team).
   - Swaps their places. The two keep their own `gamesPlayed`, `lastFinishedSeq` and counts.
   - Credit rule (documented, tested): a game credits `gamesPlayed`, partners and opponents to **whoever is on court when it finishes**. A substitute joining mid-game is credited. A player taken off is not.
   - The player taken off returns to the waiting list. In fairness mode they sort by the usual rule (fewest games, then longest wait). They were not credited for the game in progress, so they are owed it and tend to come back soon. In queue mode they go to the **front** of `queueOrder`.
   - Not valid: two waiting players (their order is derived in fairness mode, see `playNext`), a player on break or who left, a court that is empty.
2. **`playNext(s, playerId)`**
   - Adds the player to a new optional `Session.pinned: PlayerId[]`. `orderedWaiting` puts pinned players first, in the order they were pinned.
   - Pins clear when the player is placed on a court, goes on break or leaves.
   - Works in both modes. If more than four are pinned, the first four play.
3. **`skipTurn(s, playerId)`**
   - Moves the player to the back for this turn: sets `lastFinishedSeq = gameSeq` (as if they had just finished) and moves them to the end of `queueOrder`.
   - Removes any pin on them.
   - Does not change `gamesPlayed`, so fairness still owes them a game.
   - In fairness mode a skip only reorders players who have the same number of games, because fewest games always comes first. That is intended: the organizer can pass someone over for one turn, not cheat them out of games. In queue mode it moves them to the back.

**Queue bookkeeping.** `queueOrder` is kept in both modes and must always equal the set of available players (`assertInvariants` checks this). So every swap removes the incoming player from `queueOrder` and adds the outgoing one (at the front in queue mode, anywhere in fairness mode, where the order is derived). `cloneSession` is a JSON round trip, so a new optional field survives every action.

`Session` gains one optional field, `pinned?: PlayerId[]`. The persistence validator already tolerates unknown optional fields, so no version bump is needed.

### UI

- **Player sheet, player on court:** buttons **Swap with…**, **Not here**, **Take a break**, **Leave session**.
  - **Swap with…** opens a picker listing waiting players first, then players on other courts, with names, avatars and games played. One tap swaps and closes.
  - **Not here** is the no-show shortcut: it swaps the player with the next waiting player and puts the absent player on break, as **one** action, one undo step. If nobody is waiting it explains: "No one is waiting to take their place."
- **Player sheet, waiting player:** buttons **Play next**, **Skip this turn**, **Swap onto a court…** (opens a picker of players on court), **Take a break**, **Leave session**. The "why am I waiting" line from 1.5 sits above them.
- A pinned player shows a small "Next" badge in the waiting list and on the peek.
- After any of these actions the Phase 1 toast confirms what changed ("Ben swapped in for Ann on Court 1") with Undo.
- Danger styling stays on Leave only.

### Edge cases to decide in the plan, with my default
- Swapping on a court where the timer has run for a while: the timer is untouched (it is the court's game).
- Swapping the last two on a team from different courts: allowed, each court keeps four players.
- Pin vs a late arrival: the pinned player still goes first.
- Undo restores `pinned` as well (it is part of the session snapshot).

### Acceptance
- Substituting leaves both courts with four players and the right people credited at finish (test with a full game).
- Fairness numbers after a swap match the credit rule above, with a test for each case.
- Not here with an empty waiting list fails with the clear message and changes nothing.
- Every action is one undo step.
- A property test: random sequences of finish, swap, play next, skip, break, add keep the existing invariants (the repo already has `invariants.ts` and a fuzz test to extend). `assertInvariants` gains one rule: every pinned player is waiting, and appears once.

### Phase 2 definition of done
Engine tests first (they are the risk), then UI tests, the fuzz test extended, browser check, phone check at the courts with a real swap. Ralph loop plus mutation checks on the credit rule, as was done for the sync engine.

---

## Phase 3: Remember

Goal: the app knows its regulars and what happened. Local only in this phase.

### 3.1 Session history

- New IndexedDB store `sessions` (database version 4, additive). On End session, save a compact record: id, name, start and end time, per-player games, games list (teams by roster id and name, court, length), and which players were present. Keep the last 100 sessions; older ones are dropped.
- The upgrade must branch on `oldVersion` like the version 3 upgrade, and an old tab opening the new database must not look like "storage unavailable" (the follow-ups note already documents this trap).
- **Past sessions** screen, reached from Settings and from the summary. A list (date, name, games, time). Tapping one opens the same summary screen, read-only, with Share.
- The summary's **Start new session** warning ("you have not shared it yet") stops mattering once history exists: the session is saved. Keep the warning only if saving failed.

### 3.2 Attendance on saved players

- Derived from history, no new roster fields: sessions attended, total games, last played.
- Saved players shows a muted second line under the name ("12 sessions, last Sat") and a sort control: A to Z, Recently played, Most sessions.
- The second line only shows when there is history, and long text is cut off with an ellipsis so every row keeps the same height, as the icon-button rows do today.

### 3.3 Regulars first, suggested groups

- New session: sort the chips **recently played first** by default (a Settings switch brings back A to Z).
- Suggested shortcuts, computed from history with no stored groups: **Same as last time** (exists) and, when there is enough history, **Tuesday regulars (14)**: players who attended at least half of the last six sessions that started on that weekday. At most two suggestions show.
- Real named groups are Phase 5 (they must sync).

### Acceptance
End a session and it appears in Past sessions with correct numbers (the same numbers as the summary). Attendance counts match history. Upgrading from database version 3 keeps every saved player and photo (reuse the Task 6 browser upgrade check from the 3B1 plan). The suggestions are deterministic and tested with fixed dates.

### Open point
History is local to the device in this phase, so clearing browser data loses it. Syncing it is in Phase 5.

---

## Phase 4: Share and show

Goal: make the end of the session a moment, and let people see the queue without a login.

### 4.1 Highlights

New pure helper `highlights(session)`: most games, longest game, shortest game, most different partners, total playing time. Shown as three short lines on the summary under the stat tiles. Never shown for fewer than three games. Ties are named together ("Ann and Ben, 6 games").

### 4.2 A shareable result card

- Render a 1080 by 1350 PNG on a canvas: session name, date, games and time, the highlights, and a grid of avatars with games (photos when present, initials otherwise). Light and dark variants follow the theme.
- **Share results** gets a second option, **Share as picture**, using the Web Share API with a file; where files cannot be shared it downloads the PNG.
- No network is used. The existing text share stays.

### 4.3 Board view

- A **Show board** item in the menu opens a full-screen view built for a TV or a phone on a stand: every court with both teams in large type and its clock, then "Up next" with names and photos, then who is waiting. It updates live from the same session on the same device, so it works by casting the browser tab or mirroring the screen. No sync needed.
- Exit with a clear **Close** control. The wake lock (1.1) stays on.
- Phase 5 adds the same view for a second device.

### 4.4 Game-length nudge

- Settings, **During a session**: "Game length reminder", Off (default), 10, 12, 15 or 20 minutes.
- When a court's game passes the limit, its tab and clock turn amber (a visual change only) and, once, vibrate briefly if allowed. No repeating, no sound.

### 4.5 A sunlight theme

- **Appearance** becomes Auto, Dark, Light and **Sunlight**. Auto follows the system (today the system is only read until the first toggle, then the choice is stored forever, verified in `theme.ts`).
- Sunlight is a light theme with maximum contrast: white background, black text, 2 px borders, no grey text below the AA ratio. It is checked outdoors by the owner, which is the real test.

### 4.6 Small delights

- Haptic on Game finished (1.2) and on swap.
- A short, human line in the summary header based on the numbers ("12 games, 3 hours, everyone got at least 3").
- No confetti, no sounds, nothing that slows the organizer down.

### Acceptance
Highlights are tested with fixed sessions including ties and the under-three-games case. The canvas card is tested for dimensions and for the text it draws (through a canvas stub). The board view renders the same data as the live screen. Reminders fire once per game. Sunlight meets WCAG AA contrast for every text and control colour, with the ratios computed by a script and listed in the plan.

---

## Phase 5: Open it up

Goal: let anyone run it, survive a dead phone, and let players follow along. This is the only phase that touches Supabase. Each item ships alone.

### 5.1 Sign-in for other organizers (custom SMTP)

**Problem.** Supabase's built-in email service only sends to members of the RobotBeard organization (see HANDOFF). Nobody else can sign in.

**Work.** The provider is **Resend** (decided 7 Nov 2026). Choose the sending address and domain (still open, decided when Phase 5 starts), add the DNS record Resend asks for, set Supabase's SMTP settings, send a test to an outside address, keep the Site URL, and write the steps into `docs/DEPLOY.md`. No code change expected.

### 5.2 Resume on another phone

- A new table `live_sessions` (one row per user: `user_id` primary key, `data jsonb`, `updated_at`), with row security so only the owner reads and writes it.
- While signed in and online, push the session snapshot after changes (debounced, like roster sync). It is a backup only: the device stays the source of truth while playing.
- On sign-in on a device with no live session, if a snapshot is newer than 12 hours, offer **Resume the session from <device or time>**. Resuming loads the snapshot locally and from then on this device is the organizer.
- If both devices have a live session, ask which to keep and never merge.
- The snapshot is deleted when the session ends and when the user deletes their data (extend `delete_my_players` or add a sibling function).

### 5.3 Read-only live link

- **Share live link** creates a random code (at least 10 characters) stored with the snapshot. Anyone with the link opens a read-only page: courts with teams and clocks, who is next, who is waiting, and a **find my name** shortcut that scrolls to and highlights one name. It polls every 5 seconds (realtime later if it is worth it).
- Privacy by default (decided 7 Nov 2026): **first names with photos**. Last names stay private. Anyone with the link can see those faces, so the share dialog has a switch to hide photos, and another to show full names. The link stops working 6 hours after the session ends, and the organizer can turn it off at any time.
- **Cost of showing photos:** the photo bucket is private (authenticated download only, per the HANDOFF). A viewer with no sign-in needs short-lived signed photo links created on the server (an edge function, or a function plus storage policy), only for the players in that session. This is part of 5.3's size, and the plan must cover it and its tests.
- The page is served by the same app (route `#/live/<code>`), needs no sign-in, and reads through a `security definer` function that returns only that session's public view. No table is readable by the public.
- This also covers the **organizer who wants to play**: a second phone can display the queue while the organizer is on court. Letting a second person press Finish (co-organizer control) is a later step because it needs conflict handling.

### 5.4 Named groups that sync

- Roster players gain `groups text[]` (name tags like "Tuesday crew"). This touches the roster row format in `src/sync/rows.ts`, the remote layer, the pull validation, the fake server and its tests, plus one additive migration. It follows the 3B2 and 3B3 pattern and replay method.
- UI: Saved players can tag players; New session shows group chips next to the suggested ones from 3.3.

### 5.5 History that syncs

- A `sessions` table mirroring the compact record from 3.1, pushed after a session ends, pulled on sign-in. Follows the same outbox pattern as the roster (a new store, or reuse the outbox with a kind).

### Acceptance
- 5.1: a sign-in link reaches an address outside the organization.
- 5.2: start on device A, kill it, resume on device B with the same teams and clocks; deleting data removes the snapshot.
- 5.3: an incognito window opens the link with no sign-in and sees first names and photos, and no last names; the link dies after the session or when turned off; reading with a wrong code returns nothing.
- 5.4 and 5.5: tested against the real database rules and the real client library, the way 3B3 did, and run once on the real project with the owner's roster.

---

## Cross-cutting rules

**Settings additions, in one place.** Appearance (Auto, Dark, Light, Sunlight); Matchmaking (exists); **During a session**: Keep the screen on, Vibrate on finish, Game length reminder. Each stores a `pickleball.*` key in `localStorage` with a safe fallback when storage is blocked, like `pickleball.mode` does.

**Undo.** Every new engine action goes through the session store's `apply`, so each is one snapshot and one Undo.

**Accessibility.** Toasts and status text use `role="status"`. Pickers are real lists of buttons with names. The board view and the share card are not the only way to read the data. Focus returns to the control that opened a sheet.

**Performance.** The session snapshot and history stay small (compact records). The share card renders only on demand.

**Privacy.** Live links expose first names and photos, and never last names, unless the organizer chooses otherwise. Nothing public is readable except through the one function.

**Testing method (unchanged).** Tests first, a fresh-clone replay for any plan with code blocks, mutation checks on the engine rules (credit, pin clearing, queue front), the Ralph loop before each merge, and the owner's phone check before a phase is called done.

## Considered and not now

| Idea | Why not now |
|---|---|
| Score entry, winners-stay and king-of-the-court formats | Needs results per game and a new format in the engine. Revisit after Phase 2 shows how much the organizer overrides by hand. |
| Skill levels and level-matched teams | Out of scope in v1. A light optional tag could come after groups (5.4). |
| Fixed partners and "avoid" pairs | Rare in open play and complex in the split rule. Manual swap (Phase 2) covers it. |
| Co-organizer control from a second phone | Needs conflict handling. Read-only (5.3) comes first. |
| Sounds and announcements by voice | Easy to annoy a whole court. Visual first. |

## Decisions

Settled with the owner on 7 Nov 2026:

1. **Email for sign-in (5.1): Resend.** The sending address and domain are not chosen yet. They are decided when Phase 5 starts, and Phase 5 does not block on them before then.
2. **Live link privacy (5.3): first names with photos.** Last names stay private. The organizer can hide photos or show full names per session.
3. **History (Phase 3): local only first.** Clearing browser data or losing the phone loses it until 5.5 syncs it. Accepted.
4. **Scope now: Phases 1 and 2.** Phases 3 to 5 are agreed in direction and get their own plans when the earlier phases ship.

Still open: the sending address and domain for 5.1.

## Suggested build order inside the first two phases

1. 1.1 wake lock, 1.4 courts remembered (tiny, ship together).
2. 1.2 toast, 1.3 visible Add player.
3. 1.5 why waiting, 1.6 second-tab notice.
4. Phase 2 engine (`swapPlayers`, `playNext`, `skipTurn`) with tests and fuzz.
5. Phase 2 UI (pickers, Not here) and the toast wiring.

Each step is one commit, merged to production after the owner's check.
