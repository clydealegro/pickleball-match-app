# Pickleball Matchmaking App — Design

Date: 2026-11-06

## Purpose

Replace manual paddle stacking at pickleball sessions. An organizer creates a session, sets the number of courts, adds players, and the app decides who plays on which court and who plays next when a game ends. It works on a phone, tablet, or desktop.

## Scope (v1)

**In scope**
- One organizer runs the session from a single device. The live session (courts, queue, timers) lives only on that device.
- Two matchmaking modes: **fairness** (default) and **simple queue** (classic paddle stack).
- Courts, players, a waiting list, an "up next" preview, and undo.
- Late arrivals, breaks, leaving early, adding and removing courts mid-session.
- A saved **player roster**: players added in any session are remembered and can be picked at the next setup instead of retyped.
- **Player photos:** the organizer can take a photo with the device camera (or pick one) for each player; faces show on court cards, "Up next", and the waiting list.
- **Local-first with Supabase sync:** the roster and photos are saved on the device first and work with no signal. When the organizer is signed in (email code, no password), they sync to a Supabase project, so the roster is available on any device and survives clearing browser data. The app is fully usable signed out; the roster is then local only.
- The live session is saved in the browser; installable as a PWA; works offline.
- Responsive UI with a clean, minimalist look; light and dark themes.

**Out of scope for v1 (possible later)**
- Live sync of the session itself so players can follow along on their own phones (v1 uses Supabase only for the roster and photos; the live session stays local).
- Score entry and leaderboards.
- Skill ratings and skill-balanced teams.
- Shared group accounts (several organizers sharing one roster), session history beyond the current device, and players logging in themselves.

## Architecture

React + TypeScript + Vite single-page app, deployed as a static site, with Supabase (Auth, Postgres, Storage) as the online backup for the roster and photos.

Four layers with one-way dependencies (UI → store → engine, and store → sync):

1. **Engine** (`src/engine/`) — pure TypeScript, no React, no browser APIs, and no knowledge of photos. Functions take a session state plus an action and return a new state. Randomness comes from an injected RNG so tests are deterministic.
2. **Store** (`src/store/`) — holds the current session state and a bounded undo stack (persisted to `localStorage`), and the local roster and photos (persisted to IndexedDB). It is the only layer that touches device storage and the app always reads from it, never directly from the network.
3. **Sync** (`src/sync/`) — a background process that pushes local roster/photo changes to Supabase and pulls changes made elsewhere. It talks to Supabase through one small client module so the backend can be mocked in tests.
4. **UI** (`src/ui/`) — screens and components. Reads state from the store and dispatches actions. Contains no matchmaking logic and no network calls.

## Data model

```
Session {
  id, name, mode: 'fairness' | 'queue',
  courts: Court[],
  players: Player[],
  queueOrder: PlayerId[],      // used in queue mode
  history: FinishedGame[],
  gameSeq: number,             // increments each time a game finishes
  createdAt, endedAt?
}

Court {
  id, number,
  status: 'empty' | 'playing',
  closing: boolean,            // remove after current game ends
  game?: { team1: [PlayerId, PlayerId], team2: [PlayerId, PlayerId], startedAt }
}

Player {
  id, name,
  rosterId?: string,           // links to a RosterPlayer, used only to look up the photo
  status: 'active' | 'break' | 'left',
  pendingStatus?: 'break' | 'left',   // applies when their current game ends
  gamesPlayed: number,
  lastFinishedSeq: number,     // gameSeq when they last finished (or joined/returned)
  partnerCounts: Record<PlayerId, number>,
  opponentCounts: Record<PlayerId, number>
}

FinishedGame { team1, team2, courtNumber, startedAt, finishedAt }
```

`startedAt` is a timestamp, so court timers survive refreshes.

### Saved roster (local-first)

The roster is stored on the device in IndexedDB, separate from any session, so it outlives sessions and can hold photos as binary data (too large for `localStorage`). When the organizer is signed in it syncs with Supabase (see "Sync and backend").

```
RosterPlayer {
  id,                    // uuid generated on the device
  name,
  photoVersion: number,  // 0 = no photo; increments each time the photo changes
  lastPlayedAt?,
  updatedAt,             // server time once synced; local edit time until then
  deletedAt?             // soft delete, so deletions can sync to other devices
}
```

IndexedDB stores: `players`, `photos` (player id → JPEG blob), `outbox` (changes not yet pushed), `syncMeta` (last pull cursor, signed-in user).

- A session `Player` gets an optional `rosterId`. Its name is copied at session start; its photo is looked up from the roster by `rosterId` when rendering. If the roster entry is later renamed, changed, or deleted, game state is unaffected and the UI falls back to initials where needed.
- Roster names are unique case-insensitively among non-deleted entries. Adding a name that already exists selects the existing entry instead of creating a duplicate.
- Every player added during setup or mid-session is added to the roster automatically.
- `lastPlayedAt` is updated when a session ends, and powers the "Same as last session" shortcut (the players of the most recent session).

### Photos

- **Capture:** an "Add photo" action opens the device camera via a file input with `accept="image/*" capture="user"` (front camera, good for selfies; the organizer can switch to the rear camera in the camera UI to photograph someone else). On desktop it opens the file chooser or webcam depending on the browser.
- **Processing (on the device, before saving):** center-crop to a square, resize to 256 × 256, and re-encode as JPEG at about 80% quality (roughly 15–40 KB). A preview with **Retake** and **Use photo** confirms the result. Original full-size images are never stored or uploaded.
- **Where it's available:** the Saved players screen, the Setup add-player row, the live "Add player" card, and tapping a player's avatar anywhere.
- **Display:** circular avatars on court cards, "Up next", the waiting list, and the roster list. Players without a photo (or whose photo is not on this device yet) show their initials on a neutral background.
- **Replace or remove:** capturing a new photo increments `photoVersion`; "Remove photo" sets it back to 0.
- **Deleting a player** removes their photo locally and, once synced, from Supabase Storage.

## Sync and backend (Supabase)

**Principle:** the device is the source of truth while playing. The app never waits on the network; sync runs in the background when the organizer is signed in and online.

**Auth.** Supabase Auth email one-time code (6 digits, no password). The session persists on the device. Signing out stops sync but keeps the local roster. The app works fully while signed out; a small banner offers "Sign in to back up and sync your players".

**Schema.**
- Table `players`: `owner_id uuid default auth.uid()`, `id uuid`, `name text`, `photo_version int default 0`, `last_played_at timestamptz`, `deleted_at timestamptz`, `updated_at timestamptz` (set by a database trigger on every write). Primary key `(owner_id, id)`. Unique index on `(owner_id, lower(name))` where `deleted_at is null`.
- Storage: one **private** bucket `player-photos`; object path `{owner_id}/{player_id}/{photo_version}.jpg`.
- **Row Level Security** on `players` allows select/insert/update only where `owner_id = auth.uid()`; storage policies allow access only to objects whose first path segment equals `auth.uid()`. No delete policy on `players` (deletes are soft; hard purge happens through "Delete all my data").
- The client uses only the project URL and the publishable (anon) key. The service-role key is never in the app or the repository.
- Schema, policies, and bucket are defined in versioned SQL migrations in `supabase/migrations/`.

**Sync algorithm.**
1. Every local roster change (add, rename, photo change, delete, `lastPlayedAt`) is written to IndexedDB and appended to the `outbox` immediately.
2. When signed in and online (and again on reconnect, app focus, and every few minutes while open), sync **pushes** the outbox in order: upsert the `players` row, then upload the new photo file if `photoVersion` changed, then delete the superseded photo file. A failed step stays in the outbox and is retried with backoff.
3. Sync then **pulls** rows with `updated_at` greater than the stored cursor, merges them into IndexedDB, and downloads any photo whose `photo_version` is newer than the local copy (via authenticated download, stored as a local blob so display never needs the network).
4. **Conflicts:** last write wins per player, using the server `updated_at`. A local change still waiting in the outbox is never overwritten by a pulled row; it is pushed afterward. If another device created a player with the same name (unique-index violation), the two are merged: the existing server entry is kept, and the local entry's photo is adopted if the server entry has none.
5. **First sign-in on a device:** the local roster and the account's roster are merged by case-insensitive name (union), then both sides converge via the steps above.

**Sync status** is always visible in the roster screen header as one of: *Signed out*, *Synced*, *Syncing…*, *Offline — N changes waiting*, or *Can't reach server — will retry*.

**Free tier notes.** Free Supabase projects are paused after a period of inactivity (currently about a week), and an organizer must restore the project from the Supabase dashboard; until then sync reports "Can't reach server" and the app keeps working locally with nothing lost. Roster data plus 256 px photos is far below the free database and storage limits for hundreds of players. Current limits are to be re-checked when the project is created.

**Privacy.**
- Photos are personal data. They are private (bucket policy, no public URLs) and visible only to the signed-in organizer.
- The photo capture preview includes a short reminder to take photos with the player's permission.
- Settings has **Delete all my data**: purges all players and photos from Supabase and from this device after confirmation.
- Deleting a single player marks their row deleted and removes their photo file, as described above.
- Because device storage is the source of truth, a device that is wiped before its first sync loses unsynced changes; the sync status makes pending changes visible.

## Matchmaking engine

### Available pool

Every player with `status === 'active'` who is not currently on a court.

### Fairness mode (default)

When a court becomes empty (game finished, court added, or enough players become available) and the pool has at least 4 players:

1. **Select 4 players** from the pool, sorted by: fewest `gamesPlayed`, then smallest `lastFinishedSeq` (waited longest), then random (injected RNG).
2. **Split into teams.** Of the 3 possible pairings of the 4 players, choose the one with the lowest cost, where
   `cost = 10 × (partner repeats within both teams) + (opponent repeats across the 4 cross-team pairs)`.
   Ties are broken randomly.
3. **Start the game** on that court, recording `startedAt`.

If several courts are empty at once, they are filled one at a time, each removing its 4 players from the pool before the next court is filled.

### Simple queue mode

`queueOrder` is a FIFO list of available players.
- The next 4 in line take an empty court. The first two of the four form team 1 and the last two form team 2.
- When a game finishes, its 4 players go to the back of the queue in the order they were on court (team 1, then team 2).
- Late arrivals and players returning from a break join at the back.
- Games played is still tracked and displayed.

### Game lifecycle

- **Finish game:** record the game in `history`, increment `gameSeq`, update each player's `gamesPlayed`, `lastFinishedSeq`, `partnerCounts`, and `opponentCounts`, apply any `pendingStatus`, free the court (or remove it if `closing`), then refill empty courts.
- **Fewer than 4 available:** the court stays empty and fills automatically as soon as enough players are available.
- **Up next preview:** the engine can compute the next game for an empty or soon-to-finish court without committing it; the UI shows who would play next. The preview is advisory: the actual selection is recomputed when the court frees up.

### Roster changes

- **Late arrival (new player):** `gamesPlayed` starts at the floor of the average `gamesPlayed` of active players (0 if none), and `lastFinishedSeq` is the current `gameSeq`. This prevents a new player from being put on every court in a row to catch up.
- **Break:** if the player is waiting, status becomes `break` immediately and they are skipped. If they are on a court, `pendingStatus = 'break'` and it applies when their game ends.
- **Return from break:** status becomes `active`, treated as a late arrival: `lastFinishedSeq` is the current `gameSeq`, and `gamesPlayed` becomes the larger of their own count and the floor of the average of the other active players (a break never lowers someone's games played). In queue mode they join at the back.
- **Leave:** same as break, with status `left`. A player who has left can be re-added only as a new entry.
- **Names** must be non-empty and unique (case-insensitive) among players who have not left the session, so a player who left can be added again by name.

### Court changes

- **Add court:** gets the next court number and fills immediately if enough players are available.
- **Remove court:** an empty court is removed immediately; a court in play is marked `closing` and removed when its game ends.
- At least one court must remain.

### Undo

The store keeps a bounded stack (50) of previous states. Undo restores the previous state exactly, including a finished game, roster changes, and court changes.

## Screens

Mobile-first. On wide screens the same content uses a two-column layout.

### 1. Setup

- Session name, number of courts (stepper), mode (fairness / simple queue) as option chips.
- Add players by typing names one at a time or pasting a list (one name per line). Each new player can optionally get a photo right away via an avatar button next to the name field.
- **Saved players:** the roster appears as a tappable multi-select list with avatars (checkbox rows with a sticky "Add N" button). Shortcuts: "Select all" and "Same as last session". Newly typed names are saved to the roster automatically.
- **Manage players:** a "Saved players" screen reachable from Setup to rename or delete roster entries and to add, retake, or remove photos. Its header shows the sync status and sign-in state. A Settings area (also reachable here) holds sign in / sign out, theme, and "Delete all my data".
- A single "Start session" button at the bottom. Disabled until there are at least 4 players.

### 2. Live session (main screen)

- **Court cards:** court number, both teams shown with player avatars and names, a running timer, and a primary "Game finished" button. An empty court shows "Waiting for players".
- **Up next:** large and prominent; shows the next 4 players (avatars and names) and which court they'll go to.
- **Waiting list:** one row per player with an avatar and a games-played badge. Tapping a player opens actions: Break / Return / Leave / Change photo.
- **Add player:** a dashed card at the end of the list. Choose from saved players or type a new name, with an optional "Take photo" step so the organizer can photograph a newcomer on the spot.
- **Session controls:** add court, remove court, undo, end session.
- **Layout:** mobile stacks courts, then up next, then waiting list. Desktop puts courts in the main column and up next plus the waiting list in a side column.

### 3. Summary

- Per-player: games played and partners faced.
- Copy-to-clipboard export of the session results.
- "Start new session" returns to Setup.

## Visual design

Reference screens were gathered from Mobbin: Tempo (setup chips and dark pill button), Strava and Bevel (form and list patterns, dashed "add" card), Peloton (multi-select list), Equinox+ and Waymo (queue position), Apple Sports and DAZN (numbered rows), Time2book (minimal web layout with a left accent bar on cards).

- **Palette:** off-white background (`#FAFAF7`), near-black text (`#111111`), neutral grays for borders and secondary text, one accent: **pickleball lime** (`#C8F03C`). The accent is used only for live things (active court bar, "Game finished", "Up next"). It is always a fill behind dark text, never a text color on white.
- **Shape and type:** rounded cards with soft borders, no heavy shadows, one sans-serif typeface. Court numbers, timers, and the "Up next" names are large enough to read from a few feet away.
- **Actions:** one dark pill primary button per screen.
- **Themes:** light by default, with a dark theme toggle (dark background, lime accent unchanged). Respects the system setting on first load.
- **Touch targets:** at least 44px.
- **Accessibility:** text contrast meets WCAG AA in both themes; state is never conveyed by color alone.

## Persistence and offline

- The full session state and undo stack are written to `localStorage` after every action (key includes a schema version).
- The roster, photos, and sync outbox live in IndexedDB (database name and schema version are explicit), so starting or ending a session never touches them. Clearing site data removes the local copy; if the organizer was signed in and synced, signing in again restores everything from Supabase.
- On load, the saved session is restored; if the saved data is corrupt or from an incompatible version, the app starts at Setup and does not crash.
- A service worker caches the app shell so it works with no signal. The app is installable as a PWA.

## Error handling

- Invalid inputs (empty or duplicate names, fewer than 4 players to start, removing the last court) are rejected in the engine with a typed error and shown inline in the UI.
- Engine functions never throw for valid-but-unusual states (e.g. no courts empty, empty pool); they return the state unchanged.
- Storage failures (private mode, quota) are caught; the app keeps working in memory and shows a small "not saved" notice.
- Camera or image failures (permission denied, unsupported file, decode error) show an inline message and leave the player without a photo; they never block adding the player.
- Network and Supabase failures never affect play: sync errors are retried in the background and only change the sync status text.

## Testing

- **Engine unit tests (Vitest):** fewest-games-first selection; waited-longest tie-break; partner and opponent repeat minimization; seeded randomness; fewer than 4 available; multiple empty courts; queue mode ordering; late arrival starting value; break/leave immediate and pending; court add/remove (including `closing`); undo; finishing games updates counts.
- **Property-style check:** over a long simulated session with a fixed roster (e.g. 13 players, 3 courts, 100 games, no breaks or late arrivals), no active player's games played differs from another's by more than 1 whenever all courts are idle between rounds.
- **Store tests:** persistence round trip, corrupt-data fallback, undo stack bound; roster persists across sessions, auto-adds new names, rejects case-insensitive duplicates, and is unaffected by editing or deleting entries during a session.
- **Photo processing tests:** square crop, 256 px output size, JPEG encoding, and graceful failure on a bad file.
- **Sync tests (against a mocked Supabase client):** outbox push order and retry on failure; pull merges and advances the cursor; a pending local change is not overwritten by a pulled row; same-name merge keeps the server entry and adopts a missing photo; soft delete propagates and removes the photo; first sign-in unions local and remote rosters; the app works unchanged while signed out or offline.
- **Database policy tests:** run once against the Supabase project (or a local Supabase instance) to confirm one user cannot read or write another user's rows or photos.
- **UI tests (Testing Library):** create a session, finish a game, mark a break, undo — the main happy path.

## Project structure

```
src/
  engine/     # pure logic + tests
  store/      # session state, undo, roster and photo storage + tests
  sync/       # outbox, push/pull, Supabase client wrapper + tests
  ui/         # screens and components
  styles/     # tokens (colors, spacing, type), themes
supabase/
  migrations/ # tables, trigger, RLS policies, storage bucket and policies
public/       # PWA manifest, icons
docs/superpowers/specs/
```
