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

## Found while executing Plan 2 (photos), deferred on purpose

Source: the code-quality review of Plan 2 Task 3, with the failures reproduced in a throwaway copy.

- **Writes from two tabs can interleave (needs a decision before Plan 3).** `serial()` is module-level, so it only orders calls inside one tab, and a read-modify-write reads in one transaction and writes in another. Two tabs of the app (or the installed app plus a browser tab) can therefore overwrite each other: a `markRosterPlayed` in tab B can write back a stale row and undo the `photoVersion` bump from tab A's `setRosterPhoto`, leaving photo bytes with `photoVersion` 0. Two tabs setting a photo at once both write version 1, so one version number can name different bytes. The clean fix is a backend `update(id, fn)` that reads, transforms and writes in one readwrite transaction. It also covers rename and `markRosterPlayed`. Plan 3 names remote files by `photoVersion`, so do not assume a version is unique per byte content until this is fixed. The spec assumes one device, so this is low priority until sync lands.
- **A database with no `photos` store makes photo calls throw.** If the database was upgraded by a build that dropped or renamed `photos` (the `VersionError` fallback opens it as it is), `getRosterPhoto`, `setRosterPhoto` and `deleteRosterPlayer` throw `NotFoundError`, and `rosterStore.remove` does not catch it. Today this cannot happen, because newer schemas are meant to only add to older ones. Keep that rule, or guard with `database.objectStoreNames.contains('photos')` in the IndexedDB backend.
- **A stale pre-photos tab that deletes a player leaves their photo behind.** It soft-deletes the row without removing the photo. Harmless, never cleaned up. A "delete all my data" purge in Plan 3 would catch it.
- **`getRosterPhoto` is not serialized.** A UI can briefly show the old photo next to the new `photoVersion`. Cosmetic.

Source: the code-quality review of Plan 2 Task 5 (`src/lib/photo.ts`), approved with no change required.

- **Browser floor for photos.** Saving a photo calls `Blob.arrayBuffer()`, which iOS before 14 and other very old engines lack. There the save fails with the generic "Couldn't prepare that picture. Try again.", which cannot succeed on retry. Either state the floor (iOS 14 or newer) or swap in `new Response(blob).arrayBuffer()`, a one-line change.
- **EXIF rotation is requested, not verified.** `browserIo.decode` asks the browser to apply the camera's rotation (`imageOrientation: 'from-image'`). If an engine ignores it, the crop lands on the wrong region without an error. Task 10 checks it on real phones.
- **Diagnostics.** `PhotoError` has no `name`, and both `catch` blocks drop the underlying error, so a failure on a phone with no devtools shows only the friendly message. Passing `{ cause: error }` and setting `name` would help while testing on a phone.
- **Small test gaps.** No test pins that an empty-type file is accepted (a deliberate choice, since some pickers give no MIME type). Failure tests use `toThrow(PhotoError)`, which the generic wrapped error also satisfies, so assert the message too.

Source: the code-quality review of Plan 2 Task 6 (`usePhotoUrl`, `PlayerAvatar`). Approved after the stale-photo fix.

- **One photo load and one object URL per avatar.** The same player shown in several places is read and decoded several times, and each screen mount shows initials first and then the photo. Fine for a few dozen small photos. If it ever feels slow, add a module-level cache in `usePhotoUrl` keyed by `id:version` and reference-counted, with the URL revoked at zero. The hook's signature would not change.
- **Undecodable bytes show a broken image icon.** Photo bytes are validated and resized on the way in, so this should not happen. An `onError` on the `<img>` in `Avatar` that falls back to initials would cover it.

Source: the code-quality review of Plan 2 Task 7 (`PhotoPanel`, `PhotoSheet`). Fixed in Task 7: late results after the sheet closes, the `onDone` call after unmount, the stale error after Retake, the duplicate "Close" name, and the missing save-failure tests. Left for a later pass:

- **The Sheet focus trap counts hidden inputs.** `Sheet`'s focusable selector includes `input:not([disabled])`, so the `hidden` file inputs in the photo panel count. When every button is disabled (busy), Tab from the X button can leave the dialog. Fix in `Sheet`: exclude `[hidden]` and `[tabindex="-1"]` from the selector.
- **No focus management after a state change.** When the preview appears, the focused button is gone and focus falls to the page. Focus the **Use photo** button when the preview mounts, and consider `aria-live="polite"` on the "Preparing" text.
- **`processPhoto` has no timeout.** If it never settles, the panel stays on "Preparing" with its buttons disabled. The X, Escape and backdrop still close the sheet, so the user is not trapped. An optional race with a roughly 20 second timeout would end it sooner.
- **Remove photo has no confirmation.** One tap, permanent. This follows the plan.
- **A failed save or remove skips the roster `refresh()`**, so the list can stay stale until the next load.
- **Not verified on a device:** the iOS and Android behaviour of `input.click()` on a hidden `capture` input, and `capture="user"` in an installed iOS PWA. Task 10 covers it.

Source: the code-quality review of Plan 2 Task 8 (photos on every screen). Fixed in Task 8: "Add with photo" for a name already in the session replaced that player's photo before failing, and closing the photo step gave no sign that the newcomer was saved. Left for a later pass:

- **Focus is lost when a sheet body swaps.** `PlayerSheet` and `AddPlayerSheet` swap their content inside the same `Sheet`, so the focus-on-mount effect does not run again and the button that was tapped is gone. Focus falls to the page, and nothing announces the new content. Fix: focus the first button (or a `tabIndex={-1}` heading) when the panel mounts, and give the `PlayerSheet` photo view the title `Photo for {name}`. Task 10's phone check is the place to judge whether it matters.
- **The Saved players avatar is an icon-only button** with no visible cue that it can be tapped. Setup uses a text button, so the two screens differ. It follows the spec's "tapping an avatar".
- **No way back to the name form** from the Add player photo step (to fix a typo). Closing and re-adding is the path.
- **"Add with photo" has no busy state** while the roster save is pending, so a quick tap on "Add to session" in that window can put the player in the session and then show the photo step.
- **Test gaps, all low risk:** Remove photo from the player sheet, the on-break row avatar, and Saved players inside the Add sheet showing a photo.

Source: the final whole-branch review of Plan 2 (Tasks 3 to 9, `d6064f1..82e0275`). No critical or important findings; ready to merge to production after the phone check in Task 10. Minor items, for later:

- **A blocked upgrade hangs roster calls with no message.** If another tab of the app never closes its connection (frozen or unresponsive), the `blocked` handler only warns in the console, the open stays pending, and every roster call waits. It resolves as soon as the old connection closes, and every build shipped so far closes in `blocking`, so the trigger is narrow. Follow-up: a roster-ready timeout of about 5 seconds that shows "Close other tabs of this app to load saved players".
- **The v1 to v2 upgrade test does not hold a connection open.** It proves the `oldVersion < 2` branch but not `blocking`, `blocked` or the reopen. A stronger test opens v1 with an `onversionchange` that closes, calls `listRoster`, then checks the old handle can reopen.
- **Error text from `PhotoPanel` can be raw.** Save and remove show `e.message`. If the connection closed mid-operation, a user could see "Failed to execute 'transaction' on 'IDBDatabase'". Use fixed friendly text for anything but the known "That player no longer exists." message, and log the detail.
- **The Add player duplicate pre-check compares names only.** A roster rename in another tab while that player is in the session could slip past it. The candidates list already checks `rosterId`; the pre-check could too.
- **Plan 3: `photoVersion` resets to 0 on remove.** Remove then add gives version 1 again, so another device that cached version 1 would think its copy is current and keep the old picture. Before sync, add a monotonic field (for example `photoSeq`) or stop using 0 as the only "no photo" signal. This is a spec change.
- **Storage eviction.** Safari browser tabs can evict IndexedDB after about 7 days of disuse, and photos add more to lose. The app does not call `navigator.storage.persist()`. Worth a small follow-up, and Plan 3's sync is the real fix.
- **Style nits.** The Retake button's `onClick` in `PhotoPanel.tsx` is oddly indented. `SummaryScreen` still uses a plain `Avatar` (initials only), which the spec's display list does not cover.
