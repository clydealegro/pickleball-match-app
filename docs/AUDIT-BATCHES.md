# Audit remediation batches

Current status and continuation steps: [Claude Code handoff](CLAUDE-CODE-HANDOFF.md). The notes below are chronological; later updates supersede earlier pending items.

## Batch 1 — session safety (started)
- Block session start, apply, undo and reset after a foreign storage event.
- Require persistent history before treating a summary as safely kept, including the Home shortcut.
- Add regressions and run the suite/build.
- Follow-up: storage-event protection does not provide atomic exclusion for simultaneous writes; evaluate a single-writer Web Locks design before claiming full multi-tab concurrency safety.

## Batch 2 — deletion (implemented locally)
- Include current session and undo snapshots in deletion, with clear confirmation text.
- Report partial completion accurately and test failures between stores.
- Consider writes in other tabs/devices during account purge.

## Batch 3 — sync and authentication (auth and photo revisions implemented locally; rollout pending)
- Replace device-local photo sequence identity with a globally unique revision; include database, storage policy and old-client migration compatibility.
- Add competing-device photo regression coverage.
- Handle late initial auth results without overriding newer auth events; test timeout recovery.

## Batch 4 — attendance and readiness
- Serialize guest cap enforcement in a forward migration and verify concurrency.
- Update stale handoff status.
- Inventory browser coverage and implement focused end-to-end checks for cross-tab writes and persistence.
- Attendance public and organizer UI is a separate feature delivery scope; derive its implementation batches from the existing attendance specification.

Do not deploy database changes or claim device validation based solely on local unit tests.

Validation update: deletion regression checks cover clearing session snapshots while writes are blocked and failure after roster removal. Auth regression checks cover a late signed-out result and preservation of a newer sign-in. Account deletion is not a global purge barrier: another online/offline device can still republish retained changes; server coordination remains pending.

## Photo revision rollout and limits
- Apply `20261109140000_photo_revision.sql` before deploying the new client. Existing numeric filenames remain readable by the new client.
- Old installed clients do not understand UUID filenames. Mixed-version operation is not supported: refresh installed clients before photo editing resumes. A rollout gate/minimum-client-version mechanism remains needed for unattended production rollout.
- New edits and merges receive immutable UUID photo identities; the two-device competing-edit regression verifies convergence after repeated syncs.
- Replaced revisions are retained to avoid deleting files referenced by concurrent writes. Explicit photo removal, player deletion and account purge remove files. Safe server-side garbage collection remains pending.
- Attendance locking migration passes local migration/behavior/grant tests; genuine multi-connection PostgreSQL testing remains pending.

## Release gate update
- Added `20261109150000_sync_version_gate.sql`: restrictive policies reject old-client roster inserts/updates and photo mutations; the purge RPC is gated too. The new Supabase client sends `x-pikl-sync-version: 2`. This is version negotiation, not authentication.
- Apply all three audit migrations before releasing the client. Old apps can read but cannot sync edits until refreshed. Their older UI may show a generic sync error; notify organizers to reload.
- Confirm on staging that Supabase Storage forwards the version header into `request.headers`; local RLS tests cannot establish gateway behavior.
- Added a lifetime Web Lock for the session writer. Browsers without Web Locks retain storage-event blocking only. Account purge still deliberately bypasses ordinary session editing guards.
- Local PostgreSQL executables are absent. Multi-connection attendance tests, real-browser lock tests and production gateway checks remain release blockers, not completed validation.

Release checks are now set up in [RELEASE-CHECKS.md](RELEASE-CHECKS.md). Real PostgreSQL concurrency and shared-browser writer handoff/persistence checks passed. Browser validation found and fixed a Strict Mode mount race. Staging Storage gateway validation remains pending credentials and migrated staging infrastructure.
