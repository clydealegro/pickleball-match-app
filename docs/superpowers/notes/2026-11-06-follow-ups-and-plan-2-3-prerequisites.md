# Follow-ups from the Plan 1 final review

Source: the whole-implementation review of Plan 1 (core matchmaking app). Items marked **Fixed** were handled before Plan 1 was closed. The rest are deliberately deferred; each is small and none blocks use.

## Deferred minor items (Plan 1 code)

1. **Roster load failures can be hidden** (`src/ui/App.tsx`). `loadRoster().catch(() => {})` relies on the `persistent` flag to explain failures, which only covers "database could not be opened". If `getAll` fails after a successful open, or a stored record is malformed, saved players look empty with no message. *Fix:* add a `loadError` to the roster store and show the existing notice.
2. **A second tab can overwrite the session.** Two tabs (or the installed app plus a browser tab) each keep their own in-memory session; the last save wins. Nothing listens for the `storage` event. *Fix:* a `storage` listener that reloads the store, or a "session open in another tab" notice. Low priority: the spec assumes one device.
3. **Large undo stacks for big sessions** (`src/store/persistence.ts`). About 32 players over 160 games with 50 undo snapshots is roughly 2.4M characters, rewritten on every tap; 40–50 players will approach the ~5 MB storage limit. The 5-snapshot fallback handles it but each tap then serialises twice. *Fix (later):* lower the snapshot count above a size threshold, or store diffs.
4. **Housekeeping.** No `engines` field (Vite 6 needs Node 18/20+; the README does not say so). `<meta name="theme-color">` is always lime, even in dark mode. Icons are precached twice (`includeAssets` and `globPatterns`). Dev-only `npm audit` advisories (vitest/tinypool, vite-plugin-pwa/workbox-build) need major upgrades; `npm audit --omit=dev` reports 0.

## Fixed during final review

- Auto-update reloading the page with no warning (now an in-app "Reload now" notice).
- Unexpected engine errors failing silently on tap (now a visible message, and logged).
- `markPlayed` running even when ending the session failed.
- Manifest now has a fixed `id`.

## Prerequisites for Plan 2 (photos) and Plan 3 (sync)

- **IndexedDB upgrade path** (`src/store/rosterDb.ts`). `upgrade()` currently always calls `createObjectStore('players')`. When bumping to version 2 it must branch on `oldVersion` (`if (oldVersion < 1) create players; if (oldVersion < 2) create photos / outbox / syncMeta`), otherwise upgrades throw on existing installs.
- **Version mismatch must not look like "storage unavailable".** Every `openDB` failure currently switches to the memory-only roster. After a version bump, a stale tab or a rollback deploy opening with the old version would show an empty roster with the "can't be stored" banner, and anything added would be lost. Handle `VersionError` separately (ask the user to reload, or open without a version) and add a `blocked` handler beside the existing `blocking` one.
- **Widen the storage interface for the outbox.** The spec requires every roster change to be written to the outbox immediately, which needs one transaction across `players` and `outbox`. Add a multi-store transaction method to the backend interface (and to the in-memory fallback) instead of chaining puts; the existing `serial()` queue is the right place to run it.
- **`updatedAt` semantics for sync.** Today it is local time. Decide how it becomes server time (a separate `serverUpdatedAt`, or rely on the outbox to mark unsynced changes).
- **Validate pulled rows** in Plan 3. A malformed roster record currently crashes rendering (`initials(name)`), and "Start over" on the error screen only resets the session, not the roster.
- **Photos.** `Avatar` already accepts `photoUrl`. Add a `usePhotoUrl(rosterId)` hook used by `PlayerChip`, `WaitingList`, `SetupScreen` and `SavedPlayersScreen`; it should own the object-URL lifecycle (revoke on unmount and when the photo version changes). Because the name is always shown next to the avatar, give the `<img>` `alt=""`.
- **Session format.** `rosterId` on a session `Player` is enough to look up photos, so the `Session` shape should not need to change. If it ever does, write a migration in `loadPersisted` rather than discarding data: an automatic update can land mid-session.
