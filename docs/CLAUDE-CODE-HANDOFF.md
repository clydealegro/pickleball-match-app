# Audit remediation handoff to Claude Code

Prepared 9 November 2026. Start here; this supersedes older audit progress notes.

## Workspace and authorization

- App root: `/Users/clydealegro/Vibe/pickleball-match-app/pickleball-match-app` (nested inside the outer workspace).
- Repository: `https://github.com/clydealegro/pickleball-match-app`.
- Branch: `claude/pickleball-matchmaking-app-i4baca`.
- HEAD at handoff: `3ff5c1a03259d09f92d973c0f1dd2a96b1966d17`.
- All audit fixes, migrations, tests and these documents are **uncommitted working-tree changes**. They are not on a PR or deployed. Read `git status` and preserve them. A fresh clone will not contain this work.
- `.vercel/` was already untracked before this audit. Do not blindly add it or expose its contents.
- User requested audit fixes in batches and now wants to continue in Claude Code because Supabase access is available there. This handoff itself made no remote changes. Confirm the connected Supabase project/environment before applying anything.

## What changed

1. **Session safety:** `sessionStore.ts` guards start/apply/undo/reset after a foreign storage event. `useSessionConflict.ts` also holds a lifetime Web Lock named `pickleball-session-writer`; competing tabs are read-only until reloaded. Lock acquisition is deferred past the discarded React Strict Mode mount, fixing a race found in browser testing. Browsers without Web Locks only get event-based protection.
2. **Summary durability:** `SummaryScreen.tsx` and the Home shortcut in `App.tsx` require persistent history before considering a summary safely kept. Memory-only history no longer suppresses the leave confirmation.
3. **Deletion:** `dataActions.ts` clears current session and undo snapshots through a new `purge` store action; reports partial local cleanup failures accurately. Settings confirmation describes the expanded scope. Purge intentionally bypasses ordinary session-write blocking.
4. **Auth recovery:** `auth.ts` handles a delayed signed-out initial session after timeout, without overwriting a newer sign-in. Regression tests cover both cases.
5. **Photos:** new local edits and merge-adopted photos receive optional UUID `photoRevision`. Wire column is `photo_revision`; UUID filenames replace local-counter filenames for new revisions. Legacy numeric filenames remain readable by the new app. Pull compares revision identity; the photo URL hook refreshes even if the numeric version did not change. Two-device competing-edit regression now converges.
6. **Attendance:** forward migration serializes guest submissions with a link-row lock before counting the pending guest cap.
7. **Compatibility gate:** new Supabase client sends `x-pikl-sync-version: 2`. Restrictive RLS policies require it for roster writes and photo mutations; security-definer account purge checks it explicitly. This is a compatibility marker, not an auth boundary. Existing owner RLS remains.
8. **Release tooling:** added Playwright dependency/config/test, Docker-based real PostgreSQL concurrency test, and a staging Storage gateway probe. Vitest excludes `tests/release/`; generated browser outputs are gitignored.

## Migration order and rollout impact

Inspect actual migration history in the connected project. Do not assume the attendance base migration is already applied. Apply missing migrations in filename order, first in staging:

1. Existing base: `20261109120000_attendance_links.sql` (and all preceding base migrations).
2. `20261109130000_attendance_guest_lock.sql`.
3. `20261109140000_photo_revision.sql`.
4. `20261109150000_sync_version_gate.sql`.

The new client requires the new column. The gate immediately prevents older installed clients from syncing writes, deleting photos, or purging accounts; older clients can read but do not understand UUID photo filenames. Their UI may only show a generic sync error. Plan a coordinated migration/app rollout and tell organizers to reload. Do not apply the gate to production while leaving the old web build as the only available app.

Do not casually roll back to the old app after UUID photos exist, or remove the gate while incompatible clients can write. Prefer a forward fix; review rollback compatibility before release.

## Evidence actually obtained

Updated 9 November 2026 (Claude Code session). Each line says exactly what was run and where.

### Verified

- **Full suite:** 122 files / 1,539 tests on the audit tree before the rebase. **After rebasing onto origin: 166 files / 2,419 tests passed**, production build passed, Playwright 1/1, real-PostgreSQL concurrency passed, and the storage probe and 14-check flows script passed again on the merged tree. Each of the four commits also typechecks on its own.
- **Production build** (typecheck + Vite + PWA): passed.
- **Playwright runner executed for the first time:** `npm run test:release:browser` passed (1 test) against a fresh Vite server on port 4174 (`reuseExistingServer: false`, `--strictPort`).
- **Real PostgreSQL 17 in Docker:** `npm run test:release:db` passed. 40 requests over independent connections, exactly 20 accepted and 20 rejected. This proves the row lock; it has no negative control showing it fails without `FOR UPDATE`.
- **Local Supabase stack (real Storage API, PostgREST, Kong, GoTrue in Docker, CLI 2.122.0):** started with the four base migrations, then the three new ones applied in filename order with `supabase migration up`. With one disposable user, `npm run test:release:storage` passed and `npm run test:release:flows` passed 14 of 14:
  - current client inserts a player with `photo_revision`;
  - legacy client (same token, no version header) can read, but cannot insert, update, upload, overwrite or delete photos, or purge;
  - two immutable photo revisions coexist and download;
  - two competing current-client edits leave one row with one of the two revisions;
  - current-client purge removes only that account's players.
  The same token is used for both clients, so the header alone flips allow to deny.
- **CORS preflight for `x-pikl-sync-version`:** `OPTIONS` with the header requested returned 200 and allowed it on PostgREST, Storage, Auth and the purge RPC, on both the local stack and the **hosted** `pikl` gateway. Preflights carry no credentials and change nothing.
- **Gate migration is re-runnable:** applied twice in a row on the local stack without error (it uses `create or replace` and `drop policy if exists`).
- **Independent whole-diff review** (read-only subagent): no blockers. Fixed from it: photo re-download loop (#3, confirmed, regression test fails without the fix and passes with it) and weak gate tests (#2). Resolved by evidence: CORS (#1, hosted preflight above). Migration re-runnable (#4, done).
- **Production schema (read-only):** `pikl` matches the base migrations (policies on players, attendance tables and `storage.objects`); it has no `photo_revision` column and no `current_sync_client` function yet.

### Not verified

- **No hosted non-production Supabase exists.** The only active project, `pikl` (`jukjgwabutqetiwjnube`), is **production**: 1 user, 33 players, 32 stored photos, edited on the morning of 9 Nov. Branching needs the Pro plan (the attempt was refused, nothing was created or charged). So nothing was applied to any hosted database. The gateway checks above ran on the local stack, which runs Supabase's own services but not the hosted edge. Whether the hosted Storage service forwards the header into `request.headers` is still unproven. The preflight shows the edge accepts the header, not that Storage hands it to Postgres.
- Real phone / installed PWA update, magic-link in the installed app, Safari lifecycle.
- Browser test of photo upload through the real UI against a real backend.

### Branch state

- The branch was 40 commits behind origin (attendance organizer and member-page work, already on production). It has been **rebased locally onto `origin/claude/pickleball-matchmaking-app-i4baca`**: 4 audit commits on top, 0 behind. One conflict pair (`dataActions.ts` and its test) was resolved by keeping both sides: origin's attendance-cache clear and the audit's injectable history clear. Other overlaps auto-merged and are covered by the green merged-tree run above. **Nothing is pushed.**
- Local recovery points: branch `backup/audit-pre-rebase` (the four commits before the rebase) and tag `audit-worktree-snapshot` (the working tree before they were committed). Delete both once the release is done.
- Origin adds no migrations, and the organizer app shares the single authenticated client in `src/sync/client.ts`, so the version header covers the attendance work too.
- The local migration filenames (`20261106120000_...`) differ from the versions recorded on production (`20261106143416_...`). Do not use `supabase db push` against production; apply by name in order and record the result.

### Dependency advisories (9: 2 low, 5 moderate, 2 critical)

All are build or test tooling. `npm audit --omit=dev` reports 0, so nothing ships in the app bundle. Playwright appears in none of the paths, so it did not introduce them.

| Chain | Severity | Fix |
|---|---|---|
| `vitest` 3.2.7 -> `tinypool` (prototype pollution to RCE gadget), `@vitest/mocker` | 2 critical, 1 moderate | Only via `vitest@5.1.0` (breaking major). Needs attacker-controlled worker options in the test runner. Separate PR. |
| `vite-plugin-pwa` -> `workbox-build` -> `@rollup/plugin-node-resolve`, `deepmerge`, `glob`, `minimatch` | 2 low, 3 moderate, plus the plugin itself | Non-breaking `npm audit fix` is available. Not applied here, to keep build tooling unchanged in this release. Separate PR. |

## Remaining limits and follow-ups (do not mark everything complete)

- Account deletion is not a global barrier: another tab/device with retained pending edits can republish data. Purge bypasses the session writer lock; coordinated cross-device deletion remains unresolved.
- Replaced immutable photo files are retained to avoid deleting a revision a concurrent writer might reference. Explicit photo removal/player deletion/account purge still deletes files. Safe server-side garbage collection is not built. Concurrent remove-versus-edit behavior needs separate review.
- Web Locks cover cooperating updated clients, not older apps that ignore the lock, and not browsers lacking the API. The observed browser case does not establish every simultaneous-load/background/resume edge case.
- The notice currently says the session changed in another window even when the reason is simply another tab holding the lock; copy refinement remains possible.
- Real-phone/PWA update, installed-app magic-link behavior and Safari-specific lifecycle coverage are not complete.
- Attendance public page and organizer UI remain an unfinished feature separate from these audit fixes.
- No fresh independent whole-diff review has been done after all batches; earlier chat summaries were progress reports, not release approval.

See `docs/RELEASE-CHECKS.md` for commands and `docs/AUDIT-BATCHES.md` for scope. Older `docs/superpowers/HANDOFF.md` and `docs/DEPLOY.md` contain historical statements that must be checked against current infrastructure.
