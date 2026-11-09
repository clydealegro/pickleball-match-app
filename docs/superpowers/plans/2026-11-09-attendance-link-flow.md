# Attendance link, Plan 4 of 4: the session flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The answers members give on the attendance link are used when the organizer starts a session, and the organizer can act on what members send. Who's playing opens pre-filled, late players start on a break, new names and friends can be reviewed, and the list and a nudge to the maybes can be copied for the group chat.

**Architecture:** A small engine change lets a session start with a player on a break. The attendance data gains the guest states, the play-tonight list and who is late. Pure helpers decide the prefill, the copy text and name matches. The attendance card gets a review sheet and two copy buttons, and Who's playing reads a prefill that Home attaches to the session plan under strict guards. Two cleanups ride first: the slot card no longer clips on a short phone, and the Settings preview switch is gone.

**Tech Stack:** React, TypeScript, Vite, Zustand, Supabase client, Vitest, PGlite (in-memory Postgres for the tests). No new dependencies, and no database change.

Design, audit and the four plans: `docs/superpowers/specs/2026-11-09-attendance-link.md`. Pictures: `docs/superpowers/sketches/attendance-v2.png` (screens 3, 4 and 7). Earlier plans: `2026-11-09-attendance-link-database.md`, `2026-11-09-attendance-link-organizer.md`, `2026-11-09-attendance-link-member.md`.

**Where this fits.** Plan 4 of 4. After it the whole attendance idea works end to end: the organizer pins one link in the group chat, members answer on it, the organizer sees the counts, reviews new names, copies the list or nudges the maybes, and starts the session with the right people already ticked.

**Before you start.** Work from a clean checkout of production (`origin/claude/pickleball-matchmaking-app-i4baca`, commit `2198ad9` or later). Baseline: 2210 tests across 155 files, `npx tsc --noEmit` clean. After this plan: 2383 tests across 163 files. Node modules are already installed. Stage files by name, never `git add -A`. Do not touch `src/ui/EditSlotSheet*`, `src/ui/PlayerSheet*`, `src/styles/editSlot.css` or `src/styles/playerSheet.css`.

**Decisions this plan carries out (do not revisit).**
- A late player starts on a break at creation (`onBreak`), not in the queue. They come back with the existing "Return to play" in the live screen. No new live control.
- The prefill applies only when the summary belongs to the signed-in organizer, is for the same slot, is not cancelled, and its play date is today's date on the device. Otherwise Who's playing opens exactly as before.
- Who's playing shows "Said In", "Maybe" (unticked), "Friends" (session-only, never saved to the roster) and "Everyone else". Friends whose name matches a ticked player, or an earlier friend, are skipped at Start because the engine would refuse a duplicate. The Start count includes ticked friends.
- Review: a new member can be added to the roster or dismissed; a friend can play tonight, be added to the roster, or be dismissed. An exact name match says "Already saved as ..." and the button reads "Mark as done"; a likely match (same first word) says "Could be ..." and still adds. A person added to the roster is not auto-ticked for tonight.
- Copy buttons use the clipboard only (no share sheet). A refused clipboard shows a text box with the text selected. "Nudge the maybes" shows only when someone is a maybe. Out answers are never in the copied text.
- The Copy list format is a default chosen by me: the title and date, then `In (n): names` with "(late)" after a late name, `Maybe (n): names` and `Friends (n): names` when above zero.
- The Settings preview switch is removed: every signed-in organizer sees the card.

## File structure

| File | Job |
|---|---|
| `src/styles/app.css`, `src/ui/homeShortCss.test.ts` | Home keeps the slot card's height and scrolls on a short phone |
| `src/ui/AttendanceCard.tsx`, `useAttendance.ts`, `SettingsScreen.tsx`, `prefs.ts` | The preview switch removed; the card gets the review button and copy buttons |
| `src/engine/types.ts`, `src/engine/session.ts` | `onBreak` on a new player |
| `src/sync/attendance/remote.ts`, `fakeRemote.ts`, `store.ts`, `types.ts`, `links.ts` | Guest states, the play-tonight list, the late flag |
| `src/sync/attendance/prefill.ts`, `copy.ts`, `nameMatch.ts` | Pure helpers |
| `src/ui/AttendanceSheets.tsx` | The review sheet |
| `src/ui/HomeScreen.tsx`, `src/ui/SetupScreen.tsx` | Build the prefill, show it, start the session |

---

### Task 1: Keep the slot card as tall as its content on a short phone

With the attendance card under it, the Home slot card used to shrink to whatever room was left and cut off its "Add a venue" and "Add courts" chips on a short phone. It now keeps the height its content needs, and Home scrolls inside itself when the screen is too short, with the Start button pinned at the bottom.

**Files:**
- Modify: `src/styles/app.css`
- Create: `src/ui/homeShortCss.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/homeShortCss.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import css from '../styles/app.css?raw';

/** The declarations of the first rule whose selector is exactly this one. */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

// On a short phone the slot card used to shrink to whatever room was left and cut off its chips ("Add a venue", "Add courts")
// as soon as the attendance card sat below it. It now keeps the height its content needs, and Home scrolls when that does not fit.
describe('Home on a short phone', () => {
  it('keeps the slot card as tall as its content, so its chips are never cut off', () => {
    const hero = rule('.home-hero');
    expect(hero).toMatch(/min-height:\s*min-content/);
    expect(hero).not.toMatch(/min-height:\s*0\b/);
  });

  it('scrolls inside itself when the screen is too short, so the Start button stays reachable', () => {
    const home = rule('.home');
    expect(home).toMatch(/overflow-y:\s*auto/);
    expect(rule('.sticky-bar')).toMatch(/position:\s*sticky/);
  });

  it('still lets the slot card grow into spare room on a tall phone', () => {
    expect(rule('.home-hero')).toMatch(/flex:\s*1\b/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/homeShortCss.test.ts`

Expected: it fails. Test Files `1 failed (1)`, Tests `2 failed | 1 passed (3)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
index 56badd6..2e90575 100644
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1832,6 +1832,9 @@ caption {
   display: flex;
   flex-direction: column;
   gap: 12px;
+  /* On a short phone the slot card keeps its own height, so Home scrolls instead of cutting it off. */
+  overflow-y: auto;
+  overscroll-behavior: contain;
 }
 
 .home-chips {
@@ -1866,7 +1869,7 @@ caption {
 .home-hero {
   position: relative;
   flex: 1;
-  min-height: 0;
+  min-height: min-content;
   overflow: hidden;
   display: flex;
   flex-direction: column;
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/homeShortCss.test.ts`

Expected: it passes. Test Files `1 passed (1)`, Tests `3 passed (3)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2213 tests across 156 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/homeShortCss.test.ts src/styles/app.css
git commit -m "Keep the slot card as tall as its content on a short phone"
```

---

### Task 2: Show the attendance card to every signed-in organizer

The member page is live, so the Settings preview switch is gone: the card, its refresh hook and Settings no longer read it, and the tests that set it are updated. A test checks the switch and its key are gone.

**Files:**
- Modify: `src/ui/AttendanceCard.tsx`
- Modify: `src/ui/SettingsScreen.tsx`
- Modify: `src/ui/prefs.ts`
- Modify: `src/ui/useAttendance.ts`
- Modify: `src/ui/AttendanceCard.test.tsx`
- Modify: `src/ui/attendanceApp.test.tsx`
- Modify: `src/ui/attendanceHome.test.tsx`
- Modify: `src/ui/attendancePreview.test.tsx`
- Create: `src/ui/attendanceSwitchGone.test.tsx`
- Modify: `src/ui/useAttendance.test.tsx`

- [ ] **Step 1: Write the failing tests**

Apply this patch to `src/ui/AttendanceCard.test.tsx`:

```diff
diff --git a/src/ui/AttendanceCard.test.tsx b/src/ui/AttendanceCard.test.tsx
index 331c2e4..a60f642 100644
--- a/src/ui/AttendanceCard.test.tsx
+++ b/src/ui/AttendanceCard.test.tsx
@@ -13,7 +13,6 @@ import { useAuthStore } from '../sync/auth';
 import { USER_A, createDb, run } from '../sync/db/harness';
 import { useSyncStore } from '../sync/syncStore';
 import { AttendanceCard } from './AttendanceCard';
-import { ATTENDANCE_PREVIEW_KEY, setBoolPref } from './prefs';
 
 // Monday 9 Nov 2026, 4:20 pm. Date is faked and timers stay real.
 const NOW = new Date(2026, 10, 9, 16, 20).getTime();
@@ -79,7 +78,6 @@ const stubShare = (share: unknown, writeText?: unknown) => {
 
 beforeEach(() => {
   resetEverything();
-  setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
   vi.useFakeTimers({ toFake: ['Date'] });
   vi.setSystemTime(NOW);
   // The display tests have no server: a refresh on mount changes nothing.
@@ -95,14 +93,6 @@ afterEach(() => {
 });
 
 describe('which states show', () => {
-  it('shows nothing while the preview is off, whatever else is true', () => {
-    localStorage.clear();
-    signIn();
-    seed();
-    const { container } = setup();
-    expect(container).toBeEmptyDOMElement();
-  });
-
   it.each(['unconfigured', 'loading'] as const)('shows nothing while sign-in is %s', (status) => {
     useAuthStore.setState({ status });
     seed();
```

Apply this patch to `src/ui/attendanceApp.test.tsx`:

```diff
diff --git a/src/ui/attendanceApp.test.tsx b/src/ui/attendanceApp.test.tsx
index 9a08c41..20af3da 100644
--- a/src/ui/attendanceApp.test.tsx
+++ b/src/ui/attendanceApp.test.tsx
@@ -44,16 +44,9 @@ describe('App and the attendance link', () => {
   });
 
   it('sends the card\'s Sign in to Settings', async () => {
-    localStorage.setItem('pikl.attendancePreview', 'true');
     const user = userEvent.setup();
     await startApp();
     await user.click(await screen.findByRole('button', { name: 'Sign in' }));
     expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
   });
-
-  it('shows no card on Home while the preview is off', async () => {
-    await startApp();
-    await screen.findByRole('radiogroup', { name: 'Sessions' });
-    expect(screen.queryByRole('heading', { name: 'Attendance link' })).not.toBeInTheDocument();
-  });
 });
```

Apply this patch to `src/ui/attendanceHome.test.tsx`:

```diff
diff --git a/src/ui/attendanceHome.test.tsx b/src/ui/attendanceHome.test.tsx
index f377af3..8f5a3ff 100644
--- a/src/ui/attendanceHome.test.tsx
+++ b/src/ui/attendanceHome.test.tsx
@@ -12,7 +12,6 @@ import type { Summary } from '../sync/attendance/types';
 import { useAuthStore } from '../sync/auth';
 import { useSyncStore } from '../sync/syncStore';
 import { HomeScreen } from './HomeScreen';
-import { ATTENDANCE_PREVIEW_KEY, setBoolPref } from './prefs';
 
 // Saturday 7 Nov 2026, noon: the Saturday slot is selected.
 const NOW = new Date(2026, 10, 7, 12).getTime();
@@ -50,7 +49,6 @@ beforeEach(() => {
   useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
   useRosterStore.setState({ players: [], loaded: true });
   useAttendanceStore.getState().clear();
-  setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
   setAttendanceDeps({ server: () => null, now: () => Date.now(), timezone: () => 'Asia/Manila' });
   seedLinks();
   vi.useFakeTimers({ toFake: ['Date'] });
@@ -121,13 +119,6 @@ describe('the attendance card on Home', () => {
     expect(card()).not.toBeInTheDocument();
   });
 
-  it('does not show when the preview is off, so Home is as it was', () => {
-    localStorage.clear();
-    setup();
-    expect(card()).not.toBeInTheDocument();
-    expect(document.querySelector('.attendance')).toBeNull();
-  });
-
   it('calls onSignIn from the sign-in prompt', async () => {
     useAuthStore.setState({ status: 'signedOut', userId: null });
     const onSignIn = vi.fn();
```

Apply this patch to `src/ui/attendancePreview.test.tsx`:

```diff
diff --git a/src/ui/attendancePreview.test.tsx b/src/ui/attendancePreview.test.tsx
deleted file mode 100644
index 5b15aac..0000000
--- a/src/ui/attendancePreview.test.tsx
+++ /dev/null
@@ -1,42 +0,0 @@
-import { cleanup, render, screen } from '@testing-library/react';
-import userEvent from '@testing-library/user-event';
-import { afterEach, beforeEach, describe, expect, it } from 'vitest';
-import { useAuthStore } from '../sync/auth';
-import { SettingsScreen } from './SettingsScreen';
-import { ATTENDANCE_PREVIEW_KEY, getBoolPref } from './prefs';
-
-beforeEach(() => {
-  localStorage.clear();
-  useAuthStore.setState({ status: 'unconfigured', email: null, userId: null, error: null, busy: false });
-});
-afterEach(() => cleanup());
-
-const row = () => screen.getByRole('switch', { name: 'Attendance link (preview)' });
-const renderSettings = () => render(<SettingsScreen onBack={() => {}} onManage={() => {}} onHistory={() => {}} />);
-
-describe('the attendance preview switch', () => {
-  it('uses the pref key pikl.attendancePreview', () => {
-    expect(ATTENDANCE_PREVIEW_KEY).toBe('pikl.attendancePreview');
-  });
-
-  it('has a Settings row that starts off, with its help line', () => {
-    renderSettings();
-    expect(row()).not.toBeChecked();
-    expect(screen.getByText('Shows an attendance card on Home. Members cannot open the link yet.')).toBeInTheDocument();
-    expect(getBoolPref(ATTENDANCE_PREVIEW_KEY, false)).toBe(false);
-  });
-
-  it('turns on and off and keeps the choice', async () => {
-    const user = userEvent.setup();
-    renderSettings();
-    await user.click(row());
-    expect(row()).toBeChecked();
-    expect(localStorage.getItem('pikl.attendancePreview')).toBe('true');
-    cleanup();
-    renderSettings();
-    expect(row()).toBeChecked();
-    await user.click(row());
-    expect(row()).not.toBeChecked();
-    expect(localStorage.getItem('pikl.attendancePreview')).toBe('false');
-  });
-});
```

Create `src/ui/attendanceSwitchGone.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../sync/auth';
import * as prefs from './prefs';
import { SettingsScreen } from './SettingsScreen';

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ status: 'unconfigured', email: null, userId: null, error: null, busy: false });
});
afterEach(() => cleanup());

// The attendance card used to sit behind a Settings switch while members could not open the link yet. The member page is
// live, so every signed-in organizer sees the card and the switch is gone.
describe('the attendance preview switch', () => {
  it('is gone from Settings', () => {
    render(<SettingsScreen onBack={() => {}} onManage={() => {}} onHistory={() => {}} />);
    expect(screen.queryByRole('switch', { name: 'Attendance link (preview)' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Members cannot open the link yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
  });

  it('is gone from the preferences', () => {
    expect('ATTENDANCE_PREVIEW_KEY' in prefs).toBe(false);
  });
});
```

Apply this patch to `src/ui/useAttendance.test.tsx`:

```diff
diff --git a/src/ui/useAttendance.test.tsx b/src/ui/useAttendance.test.tsx
index b50a7ed..07820f0 100644
--- a/src/ui/useAttendance.test.tsx
+++ b/src/ui/useAttendance.test.tsx
@@ -2,7 +2,6 @@ import { act, cleanup, renderHook } from '@testing-library/react';
 import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
 import { useAttendanceStore } from '../sync/attendance/store';
 import { useAuthStore } from '../sync/auth';
-import { ATTENDANCE_PREVIEW_KEY, setBoolPref } from './prefs';
 import { useAttendance } from './useAttendance';
 
 const original = useAttendanceStore.getState().refresh;
@@ -32,17 +31,7 @@ afterEach(() => {
 });
 
 describe('useAttendance', () => {
-  it('does nothing while the preview is off', () => {
-    signIn();
-    const { result } = renderHook(() => useAttendance('tue'));
-    vi.advanceTimersByTime(180_000);
-    setVisible('visible');
-    expect(refresh).not.toHaveBeenCalled();
-    expect(result.current.active).toBe(false);
-  });
-
   it('does nothing when nobody is signed in', () => {
-    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
     for (const status of ['signedOut', 'unknown', 'loading', 'unconfigured', 'linkSent'] as const) {
       useAuthStore.setState({ status, userId: null });
       const { result, unmount } = renderHook(() => useAttendance('tue'));
@@ -54,14 +43,12 @@ describe('useAttendance', () => {
   });
 
   it('needs a user id as well as the signed-in status', () => {
-    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
     useAuthStore.setState({ status: 'signedIn', userId: null });
     renderHook(() => useAttendance('tue'));
     expect(refresh).not.toHaveBeenCalled();
   });
 
   it('refreshes on mount, then every 60 seconds', () => {
-    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
     signIn();
     const { result } = renderHook(() => useAttendance('tue'));
     expect(result.current.active).toBe(true);
@@ -76,7 +63,6 @@ describe('useAttendance', () => {
   });
 
   it('skips the timer while the page is hidden and refreshes when it shows again', () => {
-    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
     signIn();
     renderHook(() => useAttendance('tue'));
     refresh.mockClear();
@@ -90,17 +76,14 @@ describe('useAttendance', () => {
     expect(refresh).toHaveBeenLastCalledWith('tue');
   });
 
-  it('refreshes at once when the preview is switched on or the organizer signs in', () => {
+  it('refreshes at once when the organizer signs in', () => {
     renderHook(() => useAttendance('tue'));
     expect(refresh).not.toHaveBeenCalled();
     act(() => signIn());
-    expect(refresh).not.toHaveBeenCalled();
-    act(() => setBoolPref(ATTENDANCE_PREVIEW_KEY, true));
     expect(refresh).toHaveBeenCalledTimes(1);
   });
 
   it('follows the slot it is given', () => {
-    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
     signIn();
     const { rerender } = renderHook(({ id }) => useAttendance(id), { initialProps: { id: 'tue' } });
     rerender({ id: 'thu' });
@@ -112,7 +95,6 @@ describe('useAttendance', () => {
   });
 
   it('stops its timer and listener when it goes away', () => {
-    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
     signIn();
     const add = vi.spyOn(document, 'addEventListener');
     const remove = vi.spyOn(document, 'removeEventListener');
@@ -128,7 +110,6 @@ describe('useAttendance', () => {
   });
 
   it('stops when the organizer signs out', () => {
-    setBoolPref(ATTENDANCE_PREVIEW_KEY, true);
     signIn();
     renderHook(() => useAttendance('tue'));
     refresh.mockClear();
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/AttendanceCard.test.tsx src/ui/attendanceApp.test.tsx src/ui/attendanceHome.test.tsx src/ui/attendancePreview.test.tsx src/ui/attendanceSwitchGone.test.tsx src/ui/useAttendance.test.tsx`

Expected: it fails. Test Files `5 failed (5)`, Tests `80 failed | 13 passed (93)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/ui/AttendanceCard.tsx`:

```diff
diff --git a/src/ui/AttendanceCard.tsx b/src/ui/AttendanceCard.tsx
index 209ca9d..b0362a7 100644
--- a/src/ui/AttendanceCard.tsx
+++ b/src/ui/AttendanceCard.tsx
@@ -6,7 +6,6 @@ import { useAttendanceStore, type AttendanceResult } from '../sync/attendance/st
 import type { AttendanceStatus } from '../sync/attendance/types';
 import { useAuthStore } from '../sync/auth';
 import { CancelSheet, ResetSheet } from './AttendanceSheets';
-import { ATTENDANCE_PREVIEW_KEY, useBoolPref } from './prefs';
 import { useAttendance } from './useAttendance';
 
 interface Props {
@@ -49,7 +48,6 @@ function Shell({ weekday, children }: { weekday?: string; children: ReactNode })
 
 /** The organizer's attendance link for one saved slot, under the hero on Home. */
 export function AttendanceCard({ slot, onSignIn }: Props) {
-  const [preview] = useBoolPref(ATTENDANCE_PREVIEW_KEY, false);
   const status = useAuthStore((s) => s.status);
   const userId = useAuthStore((s) => s.userId);
   useAttendance(slot.id);
@@ -75,7 +73,7 @@ export function AttendanceCard({ slot, onSignIn }: Props) {
     if (shared === 'field') fieldRef.current?.select();
   }, [shared]);
 
-  if (!preview || status === 'unconfigured' || status === 'loading') return null;
+  if (status === 'unconfigured' || status === 'loading') return null;
 
   if (status === 'signedOut' || status === 'linkSent') {
     return (
```

Apply this patch to `src/ui/SettingsScreen.tsx`:

```diff
diff --git a/src/ui/SettingsScreen.tsx b/src/ui/SettingsScreen.tsx
index d753fd2..95a0171 100644
--- a/src/ui/SettingsScreen.tsx
+++ b/src/ui/SettingsScreen.tsx
@@ -5,7 +5,7 @@ import { useSyncStore } from '../sync/syncStore';
 import { RatingsSection } from './RatingsSection';
 import { SyncStatusLine } from './SyncStatusLine';
 import { useDefaultMode } from './matchmaking';
-import { ATTENDANCE_PREVIEW_KEY, AUTO_START_KEY, KEEP_AWAKE_KEY, PLAY_TO_CHOICES, REDUCE_MOTION_KEY, REGULARS_FIRST_KEY, useBoolPref, usePlayTo, VIBRATE_KEY } from './prefs';
+import { AUTO_START_KEY, KEEP_AWAKE_KEY, PLAY_TO_CHOICES, REDUCE_MOTION_KEY, REGULARS_FIRST_KEY, useBoolPref, usePlayTo, VIBRATE_KEY } from './prefs';
 import { useTheme } from './useTheme';
 
 interface Props {
@@ -26,7 +26,6 @@ export function SettingsScreen({ onBack, onManage, onHistory }: Props) {
   const [reduceMotion, setReduceMotion] = useBoolPref(REDUCE_MOTION_KEY, false);
   const [autoStart, setAutoStart] = useBoolPref(AUTO_START_KEY, false);
   const [playTo, setPlayTo] = usePlayTo();
-  const [attendancePreview, setAttendancePreview] = useBoolPref(ATTENDANCE_PREVIEW_KEY, false);
   const [working, setWorking] = useState(false);
   const [outcome, setOutcome] = useState<{ result: DataResult; done: string } | null>(null);
 
@@ -144,17 +143,6 @@ export function SettingsScreen({ onBack, onManage, onHistory }: Props) {
 
       <RatingsSection />
 
-      <section className="card stack" aria-labelledby="attendance-title">
-        <h2 id="attendance-title" className="section-title">
-          Attendance
-        </h2>
-        <label className="switch-row">
-          <span>Attendance link (preview)</span>
-          <input type="checkbox" role="switch" checked={attendancePreview} onChange={(e) => setAttendancePreview(e.target.checked)} />
-        </label>
-        <p className="muted">Shows an attendance card on Home. Members cannot open the link yet.</p>
-      </section>
-
       <section className="card stack" aria-labelledby="account-title">
         <h2 id="account-title" className="section-title">
           Account
```

Apply this patch to `src/ui/prefs.ts`:

```diff
diff --git a/src/ui/prefs.ts b/src/ui/prefs.ts
index df7cba7..8067433 100644
--- a/src/ui/prefs.ts
+++ b/src/ui/prefs.ts
@@ -8,8 +8,6 @@ export const AUTO_START_KEY = 'pickleball.autoStart';
 export const PLAY_TO_KEY = 'pickleball.playTo';
 export const REGULARS_FIRST_KEY = 'pickleball.regularsFirst';
 export const REDUCE_MOTION_KEY = 'pickleball.reduceMotion';
-/** Shows the attendance card on Home while members cannot open the link yet. Off until the member page exists. */
-export const ATTENDANCE_PREVIEW_KEY = 'pikl.attendancePreview';
 
 /** The scores a game can be played to. */
 export const PLAY_TO_CHOICES = [11, 15, 21] as const;
```

Apply this patch to `src/ui/useAttendance.ts`:

```diff
diff --git a/src/ui/useAttendance.ts b/src/ui/useAttendance.ts
index bbb3142..4c83c56 100644
--- a/src/ui/useAttendance.ts
+++ b/src/ui/useAttendance.ts
@@ -1,18 +1,16 @@
 import { useEffect } from 'react';
 import { useAttendanceStore } from '../sync/attendance/store';
 import { useAuthStore } from '../sync/auth';
-import { ATTENDANCE_PREVIEW_KEY, useBoolPref } from './prefs';
 
 const REFRESH_MS = 60_000;
 
 /**
  * Keeps one slot's attendance answers fresh: when the card appears, every minute while the page is visible, and
- * when the page comes back to the front. Only while the preview is on and the organizer is signed in.
+ * when the page comes back to the front. Only while the organizer is signed in.
  */
 export function useAttendance(slotId: string): { active: boolean } {
-  const [preview] = useBoolPref(ATTENDANCE_PREVIEW_KEY, false);
   const signedIn = useAuthStore((s) => s.status === 'signedIn' && s.userId !== null);
-  const active = preview && signedIn;
+  const active = signedIn;
 
   useEffect(() => {
     if (!active) return;
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/AttendanceCard.test.tsx src/ui/attendanceApp.test.tsx src/ui/attendanceHome.test.tsx src/ui/attendancePreview.test.tsx src/ui/attendanceSwitchGone.test.tsx src/ui/useAttendance.test.tsx`

Expected: it passes. Test Files `5 passed (5)`, Tests `93 passed (93)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2208 tests across 156 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/AttendanceCard.test.tsx src/ui/attendanceApp.test.tsx src/ui/attendanceHome.test.tsx src/ui/attendancePreview.test.tsx src/ui/attendanceSwitchGone.test.tsx src/ui/useAttendance.test.tsx src/ui/AttendanceCard.tsx src/ui/SettingsScreen.tsx src/ui/prefs.ts src/ui/useAttendance.ts
git commit -m "Show the attendance card to every signed-in organizer"
```

---

### Task 3: Let a session start with a player on a break

A player can be created on a break: `onBreak` on a new player. They are not put in the queue, so the queue never places them on a court, and they come back with the existing "Return to play". Duplicate names are still refused, and a saved session keeps the break.

**Files:**
- Modify: `src/engine/session.ts`
- Modify: `src/engine/types.ts`
- Modify: `src/engine/session.test.ts`
- Modify: `src/store/persistence.test.ts`

- [ ] **Step 1: Write the failing tests**

Apply this patch to `src/engine/session.test.ts`:

```diff
diff --git a/src/engine/session.test.ts b/src/engine/session.test.ts
index ceba0d7..d0e83e0 100644
--- a/src/engine/session.test.ts
+++ b/src/engine/session.test.ts
@@ -1,5 +1,9 @@
 import { describe, expect, it } from 'vitest';
 import { addPlayer, createSession, endSession } from './session';
+import { lineupIds } from './lineup';
+import { setPlayerStatus } from './status';
+import { assertInvariants } from './invariants';
+import type { Mode } from './types';
 import { expectEngineError, idOf, makeCtx, mkPlayer, mkSession, newTestSession } from './testing';
 import { onCourtIds } from './pool';
 
@@ -160,3 +164,81 @@ describe('private ratings', () => {
     expect('rating' in s.players[0]).toBe(false);
   });
 });
+
+describe('a player who starts on a break', () => {
+  const start = (names: string[], late: string[], mode: Mode, courts = 2) =>
+    createSession(
+      { name: 'T', mode, courtCount: courts, players: names.map((name) => ({ name, ...(late.includes(name) ? { onBreak: true } : {}) })) },
+      makeCtx(),
+    );
+  const placed = (s: ReturnType<typeof start>) => [
+    ...s.queueOrder,
+    ...s.courts.flatMap((c) => [...(c.game ? [...c.game.team1, ...c.game.team2] : []), ...lineupIds(c)]),
+  ];
+
+  it('is on a break, not in the queue, with the games count a late arrival gets', () => {
+    const s = start(['A', 'B', 'C', 'D', 'Late'], ['Late'], 'fairness');
+    const late = s.players.find((p) => p.name === 'Late')!;
+    expect(late.status).toBe('break');
+    expect(s.queueOrder).not.toContain(late.id);
+    expect(late.gamesPlayed).toBe(0);
+    expect(late.lastFinishedSeq).toBe(s.gameSeq);
+  });
+
+  it('is never placed, with 4, 5 and 8 players and 1 or 2 late, in both modes', () => {
+    const everyone = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
+    for (const mode of ['fairness', 'queue'] as Mode[]) {
+      for (const total of [4, 5, 8]) {
+        for (const lateCount of [1, 2]) {
+          const names = everyone.slice(0, total);
+          const late = names.slice(total - lateCount);
+          const s = start(names, late, mode, 2);
+          const lateIds = s.players.filter((p) => late.includes(p.name)).map((p) => p.id);
+          for (const id of lateIds) expect(placed(s)).not.toContain(id);
+          expect(s.players.filter((p) => late.includes(p.name)).every((p) => p.status === 'break')).toBe(true);
+          assertInvariants(s);
+        }
+      }
+    }
+  });
+
+  it('leaves the court empty when the late players would have made the fourth', () => {
+    const s = start(['A', 'B', 'C', 'Late'], ['Late'], 'fairness', 1);
+    expect(s.courts[0].status).toBe('empty');
+    expect(s.queueOrder).toHaveLength(3);
+    assertInvariants(s);
+  });
+
+  it('is added mid-session on a break too, through addPlayer', () => {
+    const s0 = newTestSession(['A', 'B', 'C', 'D']);
+    const s = addPlayer(s0, { name: 'Late', onBreak: true }, makeCtx());
+    const late = s.players.find((p) => p.name === 'Late')!;
+    expect(late.status).toBe('break');
+    expect(s.queueOrder).not.toContain(late.id);
+    assertInvariants(s);
+  });
+
+  it('joins the queue as a late arrival when returned to play', () => {
+    const s0 = start(['A', 'B', 'C', 'D', 'E', 'Late'], ['Late'], 'fairness', 1);
+    const id = idOf(s0, 'Late');
+    const s = setPlayerStatus(s0, id, 'active', makeCtx());
+    expect(s.players.find((p) => p.id === id)!.status).toBe('active');
+    expect(s.queueOrder.at(-1)).toBe(id);
+    assertInvariants(s);
+  });
+
+  it('still blocks a second player with the same name', () => {
+    const s = start(['A', 'B', 'C', 'D', 'Late'], ['Late'], 'fairness');
+    expectEngineError(() => addPlayer(s, { name: ' late ' }, makeCtx()), 'DUPLICATE_NAME');
+    expectEngineError(
+      () => createSession({ name: 'T', mode: 'fairness', courtCount: 1, players: [{ name: 'X', onBreak: true }, { name: 'x' }] }, makeCtx()),
+      'DUPLICATE_NAME',
+    );
+  });
+
+  it('treats onBreak false as a normal player', () => {
+    const s = createSession({ name: 'T', mode: 'fairness', courtCount: 1, players: [{ name: 'A', onBreak: false }] }, makeCtx());
+    expect(s.players[0].status).toBe('active');
+    expect(s.queueOrder).toEqual([s.players[0].id]);
+  });
+});
```

Apply this patch to `src/store/persistence.test.ts`:

```diff
diff --git a/src/store/persistence.test.ts b/src/store/persistence.test.ts
index ef10bef..430899d 100644
--- a/src/store/persistence.test.ts
+++ b/src/store/persistence.test.ts
@@ -1,4 +1,5 @@
 import { beforeEach, describe, expect, it } from 'vitest';
+import { createSession } from '../engine';
 import { makeCtx, newTestSession } from '../engine/testing';
 import { clearPersisted, loadPersisted, savePersisted, STORAGE_KEY } from './persistence';
 
@@ -251,3 +252,17 @@ describe('persisted slot id', () => {
     }
   });
 });
+
+describe('a session with a player on a break from the start', () => {
+  it('keeps the break through a save and a load', () => {
+    const s = createSession(
+      { name: 'T', mode: 'fairness', courtCount: 1, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'Late', onBreak: true }] },
+      makeCtx(),
+    );
+    savePersisted({ session: s, undoStack: [] });
+    const loaded = loadPersisted()?.session;
+    expect(loaded).toEqual(s);
+    expect(loaded?.players.find((p) => p.name === 'Late')?.status).toBe('break');
+    expect(loaded?.queueOrder).not.toContain(loaded?.players.find((p) => p.name === 'Late')?.id);
+  });
+});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/engine/session.test.ts src/store/persistence.test.ts`

Expected: it fails. Test Files `2 failed (2)`, Tests `6 failed | 40 passed (46)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/engine/session.ts`:

```diff
diff --git a/src/engine/session.ts b/src/engine/session.ts
index da2e407..c194f6a 100644
--- a/src/engine/session.ts
+++ b/src/engine/session.ts
@@ -18,7 +18,7 @@ function ratingFor(input: NewPlayerInput, ctx: Ctx): { rating?: number } {
   return rating === undefined ? {} : { rating };
 }
 
-/** MUTATES `s`. Validates, creates the player, and queues them at the back. */
+/** MUTATES `s`. Validates, creates the player, and queues them at the back, unless they start on a break. */
 function insertPlayer(s: Session, input: NewPlayerInput, ctx: Ctx): void {
   const name = input.name.trim();
   if (!name) throw new EngineError('EMPTY_NAME', 'Enter a name for the player.');
@@ -30,7 +30,7 @@ function insertPlayer(s: Session, input: NewPlayerInput, ctx: Ctx): void {
     name,
     rosterId: input.rosterId,
     ...ratingFor(input, ctx),
-    status: 'active',
+    status: input.onBreak ? 'break' : 'active',
     gamesPlayed: lateArrivalGames(s),
     lastFinishedSeq: s.gameSeq,
     tieKey: ctx.rng(),
@@ -38,7 +38,7 @@ function insertPlayer(s: Session, input: NewPlayerInput, ctx: Ctx): void {
     opponentCounts: {},
   };
   s.players.push(player);
-  s.queueOrder.push(player.id);
+  if (!input.onBreak) s.queueOrder.push(player.id);
 }
 
 export function createSession(input: NewSessionInput, ctx: Ctx): Session {
```

Apply this patch to `src/engine/types.ts`:

```diff
diff --git a/src/engine/types.ts b/src/engine/types.ts
index 3dee9a9..e4fabc4 100644
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -109,6 +109,8 @@ export interface Ctx {
 export interface NewPlayerInput {
   name: string;
   rosterId?: string;
+  /** Starts the player on a break: not in the queue until they are set back to active. */
+  onBreak?: boolean;
 }
 
 export interface NewSessionInput {
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/engine/session.test.ts src/store/persistence.test.ts`

Expected: it passes. Test Files `2 passed (2)`, Tests `46 passed (46)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2216 tests across 156 files.

- [ ] **Step 5: Commit**

```bash
git add src/engine/session.test.ts src/store/persistence.test.ts src/engine/session.ts src/engine/types.ts
git commit -m "Let a session start with a player on a break"
```

---

### Task 4: The guest states, the play-tonight list and the late flag

The data the session flow needs from the database: the organizer can set a waiting name to play tonight, added or dismissed, the card can list who is playing tonight, and the summary keeps who said they will be late. An old saved copy without the new fields still loads.

**Files:**
- Modify: `src/sync/attendance/fakeRemote.ts`
- Modify: `src/sync/attendance/links.ts`
- Modify: `src/sync/attendance/remote.ts`
- Modify: `src/sync/attendance/store.ts`
- Modify: `src/sync/attendance/types.ts`
- Modify: `src/sync/attendance/links.test.ts`
- Modify: `src/sync/attendance/remote.test.ts`
- Modify: `src/sync/attendance/remote.wire.test.ts`
- Modify: `src/sync/attendance/start.test.ts`
- Modify: `src/sync/attendance/store.test.ts`
- Modify: `src/ui/AttendanceCard.test.tsx`
- Modify: `src/ui/attendanceHome.test.tsx`

- [ ] **Step 1: Write the failing tests**

Apply this patch to `src/sync/attendance/links.test.ts`:

```diff
diff --git a/src/sync/attendance/links.test.ts b/src/sync/attendance/links.test.ts
index fa83ecc..3719bb8 100644
--- a/src/sync/attendance/links.test.ts
+++ b/src/sync/attendance/links.test.ts
@@ -109,7 +109,7 @@ describe('summarize', () => {
 
   it('counts in, maybe, out and late, and keeps friends and waiting names', () => {
     const waiting = [{ id: 'g1', name: 'Zed', broughtBy: null }];
-    const s = summarize('tue', 'abc', view(), waiting, 5000);
+    const s = summarize('tue', 'abc', view(), waiting, [], 5000);
     expect(s).toEqual({
       slotId: 'tue',
       code: 'abc',
@@ -118,6 +118,8 @@ describe('summarize', () => {
       counts: { in: 2, maybe: 1, out: 1, late: 1 },
       friends: 2,
       waiting,
+      tonight: [],
+      lateIds: ['a'],
       answers: { a: 'in', b: 'in', c: 'maybe', d: 'out' },
       names: { a: 'Ana', b: 'Ben', c: 'Cy', d: 'Di', e: 'Ed' },
       fetchedAt: 5000,
@@ -125,18 +127,18 @@ describe('summarize', () => {
   });
 
   it('counts a player who has not answered nowhere', () => {
-    const s = summarize('tue', 'abc', view({ answers: [] }), [], 1);
+    const s = summarize('tue', 'abc', view({ answers: [] }), [], [], 1);
     expect(s.counts).toEqual({ in: 0, maybe: 0, out: 0, late: 0 });
   });
 
   it('ignores an answer from someone no longer on the roster', () => {
-    const s = summarize('tue', 'abc', view({ answers: [{ player_id: 'gone', status: 'in', late: false }] }), [], 1);
+    const s = summarize('tue', 'abc', view({ answers: [{ player_id: 'gone', status: 'in', late: false }] }), [], [], 1);
     expect(s.counts.in).toBe(0);
     expect(s.answers).toEqual({});
   });
 
   it('carries the cancellation', () => {
-    const s = summarize('tue', 'abc', view({ cancelled: { reason: 'Rain' } }), [], 1);
+    const s = summarize('tue', 'abc', view({ cancelled: { reason: 'Rain' } }), [], [], 1);
     expect(s.cancelled).toEqual({ reason: 'Rain' });
   });
 });
@@ -204,3 +206,38 @@ describe('shareUrl', () => {
     expect(shareUrl('https://pikl.example/', 'abc')).toBe('https://pikl.example/#/j/abc');
   });
 });
+
+describe('summarize, the play-tonight list and the late ids', () => {
+  const base: AttendanceViewData = {
+    title: 'Tuesday open play', weekday: 2, venue: null, start_min: null, end_min: null, courts: null, play_date: '2026-11-10', cancelled: null,
+    players: [player('a', 'Ana'), player('b', 'Ben'), player('c', 'Cy'), player('d', 'Di')],
+    answers: [], friends: 0,
+  };
+
+  it('keeps the play-tonight list as given', () => {
+    const tonight = [{ id: 'g1', name: 'Fay', broughtBy: 'a' }];
+    expect(summarize('tue', 'x', base, [], tonight, 1).tonight).toBe(tonight);
+  });
+
+  it('lists as late only the players whose answer is In with late set', () => {
+    const view: AttendanceViewData = {
+      ...base,
+      answers: [
+        { player_id: 'a', status: 'in', late: true },
+        { player_id: 'b', status: 'in', late: false },
+        { player_id: 'c', status: 'maybe', late: true },
+        { player_id: 'd', status: 'out', late: true },
+      ],
+    };
+    expect(summarize('tue', 'x', view, [], [], 1).lateIds).toEqual(['a']);
+  });
+
+  it('leaves out a late answer from someone no longer on the roster', () => {
+    const view: AttendanceViewData = { ...base, answers: [{ player_id: 'gone', status: 'in', late: true }, { player_id: 'b', status: 'in', late: true }] };
+    expect(summarize('tue', 'x', view, [], [], 1).lateIds).toEqual(['b']);
+  });
+
+  it('has no late ids when nobody is late', () => {
+    expect(summarize('tue', 'x', base, [], [], 1).lateIds).toEqual([]);
+  });
+});
```

Apply this patch to `src/sync/attendance/remote.test.ts`:

```diff
diff --git a/src/sync/attendance/remote.test.ts b/src/sync/attendance/remote.test.ts
index 2584ea1..52ddc77 100644
--- a/src/sync/attendance/remote.test.ts
+++ b/src/sync/attendance/remote.test.ts
@@ -220,6 +220,74 @@ describe('view and waiting names', () => {
   });
 });
 
+describe('guest states and the play-tonight list', () => {
+  const stateOf = async (name: string) =>
+    (await db.query<{ state: string }>('select state from public.attendance_guests where name = $1', [name])).rows[0]?.state;
+  async function seeded() {
+    await a.upsertLink(tue);
+    const code = (await a.getLink('tue'))!.code;
+    const date = (await a.view(code))!.play_date;
+    await guest(code, 'Newbie');
+    await guest(code, 'Friend', ANA);
+    const all = await a.listWaiting('tue', date);
+    const named = (n: string) => all.find((g) => g.name === n)!;
+    return { code, date, newbie: named('Newbie'), friend: named('Friend') };
+  }
+
+  it('sets each of the three states on a guest', async () => {
+    const { newbie, friend } = await seeded();
+    await a.setGuestState(newbie.id, 'play_tonight');
+    expect(await stateOf('Newbie')).toBe('play_tonight');
+    await a.setGuestState(newbie.id, 'added');
+    expect(await stateOf('Newbie')).toBe('added');
+    await a.setGuestState(friend.id, 'dismissed');
+    expect(await stateOf('Friend')).toBe('dismissed');
+  });
+
+  it('changes only the guest it was given', async () => {
+    const { newbie } = await seeded();
+    await a.setGuestState(newbie.id, 'dismissed');
+    expect(await stateOf('Friend')).toBe('pending');
+  });
+
+  it('cannot change another organizer guest', async () => {
+    const { newbie } = await seeded();
+    await b.setGuestState(newbie.id, 'dismissed');
+    expect(await stateOf('Newbie')).toBe('pending');
+  });
+
+  it('lists only play_tonight guests for the date, in the order they asked, and not the pending ones', async () => {
+    const { code, date, newbie, friend } = await seeded();
+    await guest(code, 'Third', BEN);
+    await a.setGuestState(friend.id, 'play_tonight');
+    await db.exec("update public.attendance_guests set created_at = '2026-11-09 08:00+00' where name = 'Friend'");
+    const third = (await a.listWaiting('tue', date)).find((g) => g.name === 'Third')!;
+    await a.setGuestState(third.id, 'play_tonight');
+    await db.exec("update public.attendance_guests set created_at = '2026-11-09 09:00+00' where name = 'Third'");
+    await a.setGuestState(newbie.id, 'added');
+    const list = await a.listTonight('tue', date);
+    expect(list.map((g) => [g.name, g.broughtBy])).toEqual([['Friend', ANA], ['Third', BEN]]);
+    expect(list[0].id).toBe(friend.id);
+    expect((await a.listWaiting('tue', date)).map((g) => g.name)).toEqual([]);
+    expect(await a.listTonight('tue', '2020-01-07')).toEqual([]);
+  });
+
+  it('does not list another organizer play_tonight guests', async () => {
+    const { date, newbie } = await seeded();
+    await a.setGuestState(newbie.id, 'play_tonight');
+    expect(await b.listTonight('tue', date)).toEqual([]);
+  });
+
+  it('fails offline and changes nothing', async () => {
+    const { newbie } = await seeded();
+    flags.offline = true;
+    const error = await a.setGuestState(newbie.id, 'added').catch((e: unknown) => e);
+    expect(isRemoteError(error) && error.kind).toBe('offline');
+    flags.offline = false;
+    expect(await stateOf('Newbie')).toBe('pending');
+  });
+});
+
 describe('the in-memory remote itself', () => {
   it('fails with an offline error and changes nothing while offline', async () => {
     flags.offline = true;
@@ -237,6 +305,8 @@ describe('the in-memory remote itself', () => {
     await a.closeThrough('tue', '2026-11-10');
     await a.resetLink('tue');
     await a.listWaiting('tue', '2026-11-10');
+    await a.listTonight('tue', '2026-11-10');
+    await a.setGuestState(ANA, 'added');
     await a.view('abc');
     expect(flags.calls).toEqual([
       'upsertLink:tue',
@@ -246,6 +316,8 @@ describe('the in-memory remote itself', () => {
       'closeThrough:tue:2026-11-10',
       'resetLink:tue',
       'listWaiting:tue:2026-11-10',
+      'listTonight:tue:2026-11-10',
+      `setGuestState:${ANA}:added`,
       'view',
     ]);
   });
```

Apply this patch to `src/sync/attendance/remote.wire.test.ts`:

```diff
diff --git a/src/sync/attendance/remote.wire.test.ts b/src/sync/attendance/remote.wire.test.ts
index 19dd7a8..4ea9ff9 100644
--- a/src/sync/attendance/remote.wire.test.ts
+++ b/src/sync/attendance/remote.wire.test.ts
@@ -105,6 +105,48 @@ describe('what the attendance remote sends', () => {
     expect(url.searchParams.get('order')).toBe('created_at.asc');
   });
 
+  it('lists the play-tonight guests the same way as the waiting ones, with the other state', async () => {
+    reply = () => json(200, [{ id: 'g2', name: 'Fay', brought_by: 'p1' }]);
+    expect(await realRemote().listTonight('tue', '2026-11-10')).toEqual([{ id: 'g2', name: 'Fay', broughtBy: 'p1' }]);
+    const { method, url } = seen[0];
+    expect(method).toBe('GET');
+    expect(url.pathname).toBe('/rest/v1/attendance_guests');
+    expect(url.searchParams.get('select')).toBe('id,name,brought_by');
+    expect(url.searchParams.get('slot_id')).toBe('eq.tue');
+    expect(url.searchParams.get('play_date')).toBe('eq.2026-11-10');
+    expect(url.searchParams.get('state')).toBe('eq.play_tonight');
+    expect(url.searchParams.get('order')).toBe('created_at.asc');
+  });
+
+  it('sets a guest state with an update filtered on the guest id', async () => {
+    reply = () => new Response(null, { status: 204 });
+    await realRemote().setGuestState('g9', 'play_tonight');
+    expect(seen).toHaveLength(1);
+    const { method, url, body } = seen[0];
+    expect(method).toBe('PATCH');
+    expect(url.pathname).toBe('/rest/v1/attendance_guests');
+    expect(url.searchParams.get('id')).toBe('eq.g9');
+    expect([...url.searchParams.keys()]).toEqual(['id']);
+    expect(JSON.parse(body!)).toEqual({ state: 'play_tonight' });
+  });
+
+  it('writes each state in the body', async () => {
+    reply = () => new Response(null, { status: 204 });
+    for (const state of ['play_tonight', 'added', 'dismissed'] as const) await realRemote().setGuestState('g1', state);
+    expect(seen.map((c) => JSON.parse(c.body!).state)).toEqual(['play_tonight', 'added', 'dismissed']);
+  });
+
+  it('turns a refused guest update into the right error kind', async () => {
+    reply = () => json(401, { code: 'PGRST301', message: 'JWT expired' });
+    let error = await realRemote().setGuestState('g1', 'added').catch((e: unknown) => e);
+    expect(isRemoteError(error) && error.kind).toBe('auth');
+    reply = () => json(500, { code: 'XX000', message: 'boom' });
+    error = await realRemote().listTonight('tue', '2026-11-10').catch((e: unknown) => e);
+    expect(isRemoteError(error) && error.kind).toBe('server');
+    error = await realRemote().setGuestState('g1', 'added').catch((e: unknown) => e);
+    expect(isRemoteError(error) && error.kind).toBe('server');
+  });
+
   it('resets the link through the database function and returns the new code', async () => {
     reply = () => json(200, 'newcode0123456789abcdef');
     expect(await realRemote().resetLink('tue')).toBe('newcode0123456789abcdef');
```

Apply this patch to `src/sync/attendance/start.test.ts`:

```diff
diff --git a/src/sync/attendance/start.test.ts b/src/sync/attendance/start.test.ts
index 8b07b78..dd9b4e8 100644
--- a/src/sync/attendance/start.test.ts
+++ b/src/sync/attendance/start.test.ts
@@ -17,6 +17,8 @@ const remote = (): AttendanceRemote => ({
   upsertLink: async (row) => void upserts.push(row),
   view: async () => null,
   listWaiting: async () => [],
+  listTonight: async () => [],
+  setGuestState: async () => undefined,
   resetLink: async () => null,
   cancel: async () => undefined,
   undoCancel: async () => undefined,
```

Apply this patch to `src/sync/attendance/store.test.ts`:

```diff
diff --git a/src/sync/attendance/store.test.ts b/src/sync/attendance/store.test.ts
index 3efa2f9..cab4842 100644
--- a/src/sync/attendance/store.test.ts
+++ b/src/sync/attendance/store.test.ts
@@ -142,6 +142,28 @@ describe('refresh', () => {
     expect(state().lastError.tue).toBeNull();
   });
 
+  it('fills the play-tonight list and the late ids', async () => {
+    const code = await withAnswers();
+    await answerAs(code, BEN, 'in', false);
+    await state().refresh('tue');
+    expect(state().summaries.tue.tonight).toEqual([]);
+    expect(state().summaries.tue.lateIds).toEqual([ANA]);
+    const zed = state().summaries.tue.waiting.find((w) => w.name === 'Zed')!;
+    await fakeAttendanceRemote(db, USER_A).setGuestState(zed.id, 'play_tonight');
+    await state().refresh('tue');
+    expect(state().summaries.tue.tonight.map((w) => [w.name, w.broughtBy])).toEqual([['Zed', ANA]]);
+    expect(state().summaries.tue.waiting.map((w) => w.name)).toEqual(['Newbie']);
+  });
+
+  it('asks for the play-tonight list for the date of the view', async () => {
+    await withAnswers();
+    flags.calls.length = 0;
+    await state().refresh('tue');
+    const date = state().summaries.tue.playDate;
+    expect(flags.calls).toContain(`listTonight:tue:${date}`);
+    expect(flags.calls).toContain(`listWaiting:tue:${date}`);
+  });
+
   it('keeps the cached summary when the request fails offline, and says why', async () => {
     await withAnswers();
     await state().refresh('tue');
@@ -399,6 +421,60 @@ describe('reset, cancel and undo', () => {
   });
 });
 
+describe('guest states', () => {
+  async function withGuests() {
+    await state().ensureLink(TUE);
+    const code = (await codeOf())!;
+    await guest(code, 'Zed', ANA);
+    await guest(code, 'Newbie');
+    await state().refresh('tue');
+    const byName = (n: string) => state().summaries.tue.waiting.find((w) => w.name === n)!;
+    return { byName };
+  }
+  const stateOf = async (name: string) =>
+    (await db.query<{ state: string }>('select state from public.attendance_guests where name = $1', [name])).rows[0]?.state;
+
+  it('writes the state, then reloads so the row leaves waiting', async () => {
+    const { byName } = await withGuests();
+    expect(await state().setGuestState('tue', byName('Newbie').id, 'dismissed')).toEqual({ ok: true });
+    expect(await stateOf('Newbie')).toBe('dismissed');
+    expect(state().summaries.tue.waiting.map((w) => w.name)).toEqual(['Zed']);
+  });
+
+  it('moves a friend to the play-tonight list', async () => {
+    const { byName } = await withGuests();
+    await state().setGuestState('tue', byName('Zed').id, 'play_tonight');
+    expect(state().summaries.tue.tonight.map((w) => w.name)).toEqual(['Zed']);
+    expect(state().summaries.tue.waiting.map((w) => w.name)).toEqual(['Newbie']);
+  });
+
+  it('says so and changes nothing offline', async () => {
+    const { byName } = await withGuests();
+    const before = state().summaries;
+    flags.offline = true;
+    expect(await state().setGuestState('tue', byName('Zed').id, 'added')).toEqual({ ok: false, message: OFFLINE });
+    flags.offline = false;
+    expect(state().summaries).toBe(before);
+    expect(await stateOf('Zed')).toBe('pending');
+  });
+
+  it('asks to sign in when nobody is signed in', async () => {
+    signedIn = null;
+    const result = await state().setGuestState('tue', 'g1', 'added');
+    expect(result).toEqual({ ok: false, message: 'Sign in to use the attendance link.' });
+  });
+
+  it('shows busy only while it runs', async () => {
+    const { byName } = await withGuests();
+    const seen: boolean[] = [];
+    const unsubscribe = useAttendanceStore.subscribe((s) => seen.push(Boolean(s.busy.tue)));
+    await state().setGuestState('tue', byName('Zed').id, 'added');
+    unsubscribe();
+    expect(seen).toContain(true);
+    expect(state().busy.tue).toBeFalsy();
+  });
+});
+
 describe('writes with no connection', () => {
   it('say so and change nothing', async () => {
     await state().ensureLink(TUE);
@@ -616,7 +692,7 @@ describe('the saved copy', () => {
 describe('reading a bad saved copy', () => {
   const summary = {
     slotId: 'tue', code: 'c', playDate: '2026-11-10', cancelled: null,
-    counts: { in: 1, maybe: 0, out: 0, late: 0 }, friends: 0, waiting: [], answers: { p: 'in' }, names: { p: 'Ana' }, fetchedAt: 5,
+    counts: { in: 1, maybe: 0, out: 0, late: 0 }, friends: 0, waiting: [], tonight: [], lateIds: [], answers: { p: 'in' }, names: { p: 'Ana' }, fetchedAt: 5,
   };
   const good = { version: 1, userId: 'u', links: { tue: { code: 'c' } }, summaries: { tue: summary }, lastChange: {}, pendingClose: [] };
 
@@ -624,6 +700,29 @@ describe('reading a bad saved copy', () => {
     expect(parseAttendanceCache(JSON.stringify(good))).toMatchObject({ ownerId: 'u', links: { tue: { code: 'c' } }, summaries: { tue: summary } });
   });
 
+  it('keeps a copy saved before the new fields, with both as empty lists', () => {
+    const { tonight: _t, lateIds: _l, ...old } = summary;
+    const parsed = parseAttendanceCache(JSON.stringify({ ...good, summaries: { tue: old } }))!;
+    expect(parsed.summaries.tue).toEqual(summary);
+  });
+
+  it('keeps the new fields when they are there', () => {
+    const next = { ...summary, tonight: [{ id: 'g', name: 'Fay', broughtBy: 'p' }], lateIds: ['p'] };
+    expect(parseAttendanceCache(JSON.stringify({ ...good, summaries: { tue: next } }))!.summaries.tue).toEqual(next);
+  });
+
+  it('drops a summary whose new fields are malformed', () => {
+    for (const bad of [
+      { ...summary, tonight: 'x' },
+      { ...summary, tonight: [{ id: 'g', name: 5, broughtBy: null }] },
+      { ...summary, tonight: [{ id: 'g', name: 'Fay', broughtBy: 5 }] },
+      { ...summary, lateIds: 'p' },
+      { ...summary, lateIds: [5] },
+    ]) {
+      expect(parseAttendanceCache(JSON.stringify({ ...good, summaries: { tue: bad } }))!.summaries).toEqual({});
+    }
+  });
+
   it('gives nothing for missing, broken or foreign data', () => {
     for (const raw of [null, '', 'nope', '[]', '5', JSON.stringify({ ...good, version: 2 }), JSON.stringify({ ...good, userId: 5 }), JSON.stringify({ ...good, userId: '' })]) {
       expect(parseAttendanceCache(raw)).toBeNull();
```

Apply this patch to `src/ui/AttendanceCard.test.tsx`:

```diff
diff --git a/src/ui/AttendanceCard.test.tsx b/src/ui/AttendanceCard.test.tsx
index a60f642..685f42b 100644
--- a/src/ui/AttendanceCard.test.tsx
+++ b/src/ui/AttendanceCard.test.tsx
@@ -46,6 +46,8 @@ const summary = (over: Partial<Summary> = {}): Summary => ({
   counts: { in: 11, maybe: 3, out: 2, late: 0 },
   friends: 1,
   waiting: [],
+  tonight: [],
+  lateIds: [],
   answers: {},
   names: {},
   fetchedAt: NOW,
```

Apply this patch to `src/ui/attendanceHome.test.tsx`:

```diff
diff --git a/src/ui/attendanceHome.test.tsx b/src/ui/attendanceHome.test.tsx
index 8f5a3ff..2dda72a 100644
--- a/src/ui/attendanceHome.test.tsx
+++ b/src/ui/attendanceHome.test.tsx
@@ -24,6 +24,8 @@ const summary = (slotId: string): Summary => ({
   counts: { in: 4, maybe: 1, out: 0, late: 0 },
   friends: 0,
   waiting: [],
+  tonight: [],
+  lateIds: [],
   answers: {},
   names: {},
   fetchedAt: NOW,
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/sync/attendance/links.test.ts src/sync/attendance/remote.test.ts src/sync/attendance/remote.wire.test.ts src/sync/attendance/start.test.ts src/sync/attendance/store.test.ts src/ui/AttendanceCard.test.tsx src/ui/attendanceHome.test.tsx`

Expected: it fails. Test Files `4 failed | 3 passed (7)`, Tests `25 failed | 213 passed (238)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/sync/attendance/fakeRemote.ts`:

```diff
diff --git a/src/sync/attendance/fakeRemote.ts b/src/sync/attendance/fakeRemote.ts
index 042502c..85e7c7d 100644
--- a/src/sync/attendance/fakeRemote.ts
+++ b/src/sync/attendance/fakeRemote.ts
@@ -27,6 +27,15 @@ export function fakeAttendanceRemote(db: PGlite, user: string, flags: FakeFlags
       throw new RemoteError('server');
     }
   };
+  const guests = async (call: string, slotId: string, playDate: string, state: string) => {
+    const rows = await sql(
+      call,
+      `select id, name, brought_by from public.attendance_guests
+       where slot_id = $1 and play_date = $2::date and state = $3 order by created_at, id`,
+      [slotId, playDate, state],
+    );
+    return rows.map((g) => ({ id: String(g.id), name: String(g.name), broughtBy: (g.brought_by as string | null) ?? null }));
+  };
   return {
     async getLink(slotId) {
       const rows = await sql(`getLink:${slotId}`, 'select code, closed_through::text as closed_through from public.attendance_links where slot_id = $1', [slotId]);
@@ -47,14 +56,10 @@ export function fakeAttendanceRemote(db: PGlite, user: string, flags: FakeFlags
       const rows = await sql('view', 'select public.attendance_view($1) as v', [code]);
       return (rows[0]?.v as AttendanceViewData | null) ?? null;
     },
-    async listWaiting(slotId, playDate) {
-      const rows = await sql(
-        `listWaiting:${slotId}:${playDate}`,
-        `select id, name, brought_by from public.attendance_guests
-         where slot_id = $1 and play_date = $2::date and state = 'pending' order by created_at, id`,
-        [slotId, playDate],
-      );
-      return rows.map((g) => ({ id: String(g.id), name: String(g.name), broughtBy: (g.brought_by as string | null) ?? null }));
+    listWaiting: (slotId, playDate) => guests(`listWaiting:${slotId}:${playDate}`, slotId, playDate, 'pending'),
+    listTonight: (slotId, playDate) => guests(`listTonight:${slotId}:${playDate}`, slotId, playDate, 'play_tonight'),
+    async setGuestState(guestId, state) {
+      await sql(`setGuestState:${guestId}:${state}`, 'update public.attendance_guests set state = $2 where id = $1', [guestId, state]);
     },
     async resetLink(slotId) {
       const rows = await sql(`resetLink:${slotId}`, 'select public.reset_attendance_link($1) as code', [slotId]);
```

Apply this patch to `src/sync/attendance/links.ts`:

```diff
diff --git a/src/sync/attendance/links.ts b/src/sync/attendance/links.ts
index 6374a05..9587ccc 100644
--- a/src/sync/attendance/links.ts
+++ b/src/sync/attendance/links.ts
@@ -53,17 +53,22 @@ export function summarize(
   code: string,
   view: AttendanceViewData,
   waiting: WaitingName[],
+  tonight: WaitingName[],
   now: number,
 ): Summary {
   const names = displayNames(view.players);
   const counts = { in: 0, maybe: 0, out: 0, late: 0 };
   const answers: Record<string, AttendanceStatus> = {};
+  const lateIds: string[] = [];
   for (const a of view.answers) {
     // An answer from someone removed from the roster is not counted.
     if (!(a.player_id in names)) continue;
     answers[a.player_id] = a.status;
     counts[a.status] += 1;
-    if (a.status === 'in' && a.late) counts.late += 1;
+    if (a.status === 'in' && a.late) {
+      counts.late += 1;
+      lateIds.push(a.player_id);
+    }
   }
   return {
     slotId,
@@ -73,6 +78,8 @@ export function summarize(
     counts,
     friends: view.friends,
     waiting,
+    tonight,
+    lateIds,
     answers,
     names,
     fetchedAt: now,
```

Apply this patch to `src/sync/attendance/remote.ts`:

```diff
diff --git a/src/sync/attendance/remote.ts b/src/sync/attendance/remote.ts
index 045d965..9afefc5 100644
--- a/src/sync/attendance/remote.ts
+++ b/src/sync/attendance/remote.ts
@@ -2,6 +2,9 @@ import type { SupabaseClient } from '@supabase/supabase-js';
 import { fail } from '../remote';
 import type { AttendanceViewData, LinkRow, WaitingName } from './types';
 
+/** The states an organizer can give a waiting name. */
+export type GuestState = 'play_tonight' | 'added' | 'dismissed';
+
 /** What the organizer's attendance link asks of the server. Every method throws a `RemoteError` when it fails. */
 export interface AttendanceRemote {
   /** The link of this slot, or null when there is none. */
@@ -12,6 +15,10 @@ export interface AttendanceRemote {
   view(code: string): Promise<AttendanceViewData | null>;
   /** Names waiting for the organizer on a date. Pending ones only. */
   listWaiting(slotId: string, playDate: string): Promise<WaitingName[]>;
+  /** Friends the organizer marked to play tonight, on a date. Same shape and order as `listWaiting`. */
+  listTonight(slotId: string, playDate: string): Promise<WaitingName[]>;
+  /** Moves a waiting name on: to tonight's list, onto the roster, or away. */
+  setGuestState(guestId: string, state: GuestState): Promise<void>;
   /** A new code for the slot's link, or null when there is no link. */
   resetLink(slotId: string): Promise<string | null>;
   /** Cancels a date, replacing any earlier cancellation and its reason. */
@@ -21,6 +28,18 @@ export interface AttendanceRemote {
   closeThrough(slotId: string, date: string): Promise<void>;
 }
 
+async function guestsIn(client: SupabaseClient, slotId: string, playDate: string, state: 'pending' | 'play_tonight'): Promise<WaitingName[]> {
+  const { data, error, status } = await client
+    .from('attendance_guests')
+    .select('id,name,brought_by')
+    .eq('slot_id', slotId)
+    .eq('play_date', playDate)
+    .eq('state', state)
+    .order('created_at', { ascending: true });
+  if (error) fail(error, status);
+  return (data ?? []).map((g) => ({ id: String(g.id), name: String(g.name), broughtBy: (g.brought_by as string | null) ?? null }));
+}
+
 /** The real server, as the signed-in organizer `ownerId`. */
 export function supabaseAttendanceRemote(client: SupabaseClient, ownerId: string): AttendanceRemote {
   return {
@@ -38,16 +57,11 @@ export function supabaseAttendanceRemote(client: SupabaseClient, ownerId: string
       if (error) fail(error, status);
       return (data as AttendanceViewData | null) ?? null;
     },
-    async listWaiting(slotId, playDate) {
-      const { data, error, status } = await client
-        .from('attendance_guests')
-        .select('id,name,brought_by')
-        .eq('slot_id', slotId)
-        .eq('play_date', playDate)
-        .eq('state', 'pending')
-        .order('created_at', { ascending: true });
+    listWaiting: (slotId, playDate) => guestsIn(client, slotId, playDate, 'pending'),
+    listTonight: (slotId, playDate) => guestsIn(client, slotId, playDate, 'play_tonight'),
+    async setGuestState(guestId, state) {
+      const { error, status } = await client.from('attendance_guests').update({ state }).eq('id', guestId);
       if (error) fail(error, status);
-      return (data ?? []).map((g) => ({ id: String(g.id), name: String(g.name), broughtBy: (g.brought_by as string | null) ?? null }));
     },
     async resetLink(slotId) {
       const { data, error, status } = await client.rpc('reset_attendance_link', { p_slot_id: slotId });
```

Apply this patch to `src/sync/attendance/store.ts`:

```diff
diff --git a/src/sync/attendance/store.ts b/src/sync/attendance/store.ts
index d1482a0..3b9eba6 100644
--- a/src/sync/attendance/store.ts
+++ b/src/sync/attendance/store.ts
@@ -5,7 +5,7 @@ import { useAuthStore } from '../auth';
 import { getSupabase } from '../client';
 import { isRemoteError, RemoteError } from '../remote';
 import { diffChange, linkRow, localDate, safeTimezone, summarize } from './links';
-import { supabaseAttendanceRemote, type AttendanceRemote } from './remote';
+import { supabaseAttendanceRemote, type AttendanceRemote, type GuestState } from './remote';
 import type { AttendanceStatus, ChangeNote, Failure, Summary } from './types';
 
 export const ATTENDANCE_KEY = 'pickleball.attendance.v1';
@@ -62,6 +62,8 @@ interface AttendanceState extends Data {
   resetLink: (slotId: string) => Promise<AttendanceResult>;
   cancelWeek: (slotId: string, reason: string) => Promise<AttendanceResult>;
   undoCancel: (slotId: string) => Promise<AttendanceResult>;
+  /** Moves a waiting name on, then reads the answers again so it leaves the waiting list. */
+  setGuestState: (slotId: string, guestId: string, state: GuestState) => Promise<AttendanceResult>;
   /** Closes the date a session started on. Never throws. */
   closeForSession: (session: Session) => Promise<AttendanceResult>;
   /** Sends a saved slot to its link, when it has one. */
@@ -84,6 +86,8 @@ const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'obj
 const isStatus = (x: unknown): x is AttendanceStatus => x === 'in' || x === 'maybe' || x === 'out';
 const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
 const isDate = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
+const isWaitingName = (w: unknown): boolean =>
+  isObject(w) && typeof w.id === 'string' && typeof w.name === 'string' && (w.broughtBy === null || typeof w.broughtBy === 'string');
 const isText = (x: unknown): x is string => typeof x === 'string' && x !== '';
 const everyValue = (x: unknown, ok: (v: unknown) => boolean) => isObject(x) && Object.values(x).every(ok);
 
@@ -102,9 +106,10 @@ function isSummary(key: string, x: unknown): x is Summary {
     isCount(counts.late) &&
     isCount(x.friends) &&
     Array.isArray(waiting) &&
-    waiting.every(
-      (w) => isObject(w) && typeof w.id === 'string' && typeof w.name === 'string' && (w.broughtBy === null || typeof w.broughtBy === 'string'),
-    ) &&
+    waiting.every(isWaitingName) &&
+    // A copy saved before these two fields existed has neither; they default to empty lists.
+    (x.tonight === undefined || (Array.isArray(x.tonight) && x.tonight.every(isWaitingName))) &&
+    (x.lateIds === undefined || (Array.isArray(x.lateIds) && x.lateIds.every((id) => typeof id === 'string'))) &&
     everyValue(x.answers, isStatus) &&
     everyValue(x.names, (v) => typeof v === 'string') &&
     typeof x.fetchedAt === 'number' &&
@@ -128,7 +133,7 @@ export function parseAttendanceCache(raw: string | null): Data | null {
     }
     const summaries: Data['summaries'] = {};
     if (isObject(data.summaries)) {
-      for (const [slotId, s] of Object.entries(data.summaries)) if (slotId in links && isSummary(slotId, s)) summaries[slotId] = s;
+      for (const [slotId, s] of Object.entries(data.summaries)) if (slotId in links && isSummary(slotId, s)) summaries[slotId] = { ...s, tonight: s.tonight ?? [], lateIds: s.lateIds ?? [] };
     }
     const lastChange: Data['lastChange'] = {};
     if (isObject(data.lastChange)) {
@@ -248,9 +253,10 @@ export const useAttendanceStore = create<AttendanceState>()((set, get) => {
         if (!view) throw new RemoteError('server');
       }
       const waiting = await remote.listWaiting(slotId, view.play_date);
+      const tonight = await remote.listTonight(slotId, view.play_date);
       if (!current()) return { ok: true };
       const now = deps.now();
-      const summary = summarize(slotId, code!, view, waiting, now);
+      const summary = summarize(slotId, code!, view, waiting, tonight, now);
       const before = get().summaries[slotId];
       let change = get().lastChange[slotId] ?? null;
       if (before && before.playDate !== summary.playDate) change = null;
@@ -336,6 +342,10 @@ export const useAttendanceStore = create<AttendanceState>()((set, get) => {
       return write(slotId, (remote) => remote.undoCancel(slotId, date));
     },
 
+    setGuestState(slotId, guestId, state) {
+      return write(slotId, (remote) => remote.setGuestState(guestId, state));
+    },
+
     async closeForSession(session) {
       try {
         const slotId = session.slotId;
```

Apply this patch to `src/sync/attendance/types.ts`:

```diff
diff --git a/src/sync/attendance/types.ts b/src/sync/attendance/types.ts
index c1d411a..00ea5b6 100644
--- a/src/sync/attendance/types.ts
+++ b/src/sync/attendance/types.ts
@@ -35,6 +35,10 @@ export interface Summary {
   counts: { in: number; maybe: number; out: number; late: number };
   friends: number;
   waiting: WaitingName[];
+  /** Friends the organizer said will play tonight. */
+  tonight: WaitingName[];
+  /** Players whose answer is In and who said they are late. */
+  lateIds: string[];
   answers: Record<string, AttendanceStatus>;
   /** Display first name by player id, with a last initial when two players share a first name. */
   names: Record<string, string>;
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/sync/attendance/links.test.ts src/sync/attendance/remote.test.ts src/sync/attendance/remote.wire.test.ts src/sync/attendance/start.test.ts src/sync/attendance/store.test.ts src/ui/AttendanceCard.test.tsx src/ui/attendanceHome.test.tsx`

Expected: it passes. Test Files `7 passed (7)`, Tests `238 passed (238)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2240 tests across 156 files.

- [ ] **Step 5: Commit**

```bash
git add src/sync/attendance/links.test.ts src/sync/attendance/remote.test.ts src/sync/attendance/remote.wire.test.ts src/sync/attendance/start.test.ts src/sync/attendance/store.test.ts src/ui/AttendanceCard.test.tsx src/ui/attendanceHome.test.tsx src/sync/attendance/fakeRemote.ts src/sync/attendance/links.ts src/sync/attendance/remote.ts src/sync/attendance/store.ts src/sync/attendance/types.ts
git commit -m "Add the attendance guest states, the play-tonight list and the late flag"
```

---

### Task 5: The prefill, copy text and name match helpers

Pure helpers, tested with fixed dates: what Who's playing is pre-filled with (only when the answers are for today and the week is not cancelled), the text of the list for the group chat and of the nudge to the maybes, and whether a typed name is the same as, or could be, a saved player.

**Files:**
- Create: `src/sync/attendance/copy.ts`
- Create: `src/sync/attendance/nameMatch.ts`
- Create: `src/sync/attendance/prefill.ts`
- Create: `src/sync/attendance/copy.test.ts`
- Create: `src/sync/attendance/nameMatch.test.ts`
- Create: `src/sync/attendance/prefill.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/sync/attendance/copy.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Slot } from '../../store/slots';
import { listText, nudgeText } from './copy';
import type { Summary } from './types';

const TUE: Slot = { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Sample Hall', courts: 3 };
const summary = (over: Partial<Summary> = {}): Summary => ({
  slotId: 'tue',
  code: 'abc',
  playDate: '2026-11-10',
  cancelled: null,
  counts: { in: 0, maybe: 0, out: 0, late: 0 },
  friends: 0,
  waiting: [],
  tonight: [],
  lateIds: [],
  answers: {},
  names: {},
  fetchedAt: 1,
  ...over,
});

describe('listText', () => {
  it('writes the heading, the In line, the Maybe line and the Friends line, in that order', () => {
    const s = summary({
      names: { a: 'Ana', b: 'Ben', c: 'Cy', d: 'Di' },
      answers: { a: 'in', b: 'in', c: 'maybe', d: 'out' },
      tonight: [{ id: 'g1', name: 'Fay', broughtBy: 'a' }],
    });
    expect(listText(TUE, s)).toBe(
      ['Tuesday open play, Tue 10 Nov, 7:00 to 9:00 pm, Sample Hall', 'In (2): Ana, Ben', 'Maybe (1): Cy', 'Friends (1): Fay'].join('\n'),
    );
  });

  it('has no trailing newline', () => {
    expect(listText(TUE, summary()).endsWith('\n')).toBe(false);
  });

  it('shows In (0) with nothing after it when nobody is in, and leaves the other lines off', () => {
    expect(listText(TUE, summary())).toBe('Tuesday open play, Tue 10 Nov, 7:00 to 9:00 pm, Sample Hall\nIn (0)');
  });

  it('marks a late name', () => {
    const s = summary({ names: { a: 'Ana', b: 'Ben' }, answers: { a: 'in', b: 'in' }, lateIds: ['b'] });
    expect(listText(TUE, s).split('\n')[1]).toBe('In (2): Ana, Ben (late)');
  });

  it('never lists Out answers', () => {
    const s = summary({ names: { a: 'Ana', b: 'Ben' }, answers: { a: 'out', b: 'out' } });
    expect(listText(TUE, s)).not.toMatch(/Ana|Ben/);
  });

  it('leaves the Maybe line off at zero and the Friends line off at zero', () => {
    const s = summary({ names: { a: 'Ana' }, answers: { a: 'in' } });
    expect(listText(TUE, s)).not.toMatch(/Maybe|Friends/);
  });

  it('does not list pending names as friends', () => {
    const s = summary({ waiting: [{ id: 'w', name: 'Pat', broughtBy: 'a' }] });
    expect(listText(TUE, s)).not.toMatch(/Friends|Pat/);
  });

  it('sorts names ignoring case in every line, with the late mark following its name', () => {
    const s = summary({
      names: { a: 'zed', b: 'Ben', c: 'ana', d: 'Kai', e: 'al' },
      answers: { a: 'in', b: 'in', c: 'in', d: 'maybe', e: 'maybe' },
      lateIds: ['c'],
      tonight: [
        { id: 'g1', name: 'zoe', broughtBy: null },
        { id: 'g2', name: 'Amy', broughtBy: null },
      ],
    });
    const lines = listText(TUE, s).split('\n');
    expect(lines[1]).toBe('In (3): ana (late), Ben, zed');
    expect(lines[2]).toBe('Maybe (2): al, Kai');
    expect(lines[3]).toBe('Friends (2): Amy, zoe');
  });

  it('leaves out the time part when the slot has no time', () => {
    const slot: Slot = { id: 'tue', weekday: 2, venue: 'Sample Hall' };
    expect(listText(slot, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov, Sample Hall');
  });

  it('leaves out the venue part when the slot has no venue, or a blank one', () => {
    expect(listText({ ...TUE, venue: undefined }, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov, 7:00 to 9:00 pm');
    expect(listText({ ...TUE, venue: '  ' }, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov, 7:00 to 9:00 pm');
  });

  it('is just the title and the date for a bare slot', () => {
    expect(listText({ id: 'tue', weekday: 2 }, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov');
  });

  it('writes a start time alone and an end time alone the way slots do', () => {
    expect(listText({ ...TUE, endMin: undefined, venue: undefined }, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov, From 7:00 pm');
    expect(listText({ ...TUE, startMin: undefined, venue: undefined }, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov, Until 9:00 pm');
  });

  it('names the date from the summary, not from today', () => {
    expect(listText(TUE, summary({ playDate: '2026-12-01' })).split('\n')[0]).toContain('Tue 1 Dec');
  });
});

describe('nudgeText', () => {
  const maybes = (...names: string[]) =>
    summary({
      names: Object.fromEntries(names.map((n, i) => [`p${i}`, n])),
      answers: Object.fromEntries(names.map((_, i) => [`p${i}`, 'maybe' as const])),
    });

  it('asks one maybe', () => {
    expect(nudgeText(TUE, maybes('Ben'))).toBe('Ben, are you in for Tuesday?');
  });

  it('joins two maybes with and', () => {
    expect(nudgeText(TUE, maybes('Kai', 'Ben'))).toBe('Ben and Kai, are you in for Tuesday?');
  });

  it('joins three maybes with commas and a last and', () => {
    expect(nudgeText(TUE, maybes('Kai', 'ian', 'Ben'))).toBe('Ben, ian and Kai, are you in for Tuesday?');
  });

  it('is an empty string with no maybes', () => {
    expect(nudgeText(TUE, summary())).toBe('');
  });

  it('only asks players who answered Maybe', () => {
    const s = summary({ names: { a: 'Ana', b: 'Ben', c: 'Cy' }, answers: { a: 'in', b: 'maybe', c: 'out' } });
    expect(nudgeText(TUE, s)).toBe('Ben, are you in for Tuesday?');
  });

  it('uses the slot weekday and carries no link', () => {
    const text = nudgeText({ id: 'thu', weekday: 4 }, { ...maybes('Ben'), code: 'secretcode' });
    expect(text).toBe('Ben, are you in for Thursday?');
    expect(text).not.toMatch(/secretcode|http|#/);
  });
});
```

Create `src/sync/attendance/nameMatch.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { RosterPlayer } from '../../store/rosterDb';
import { nameMatch } from './nameMatch';

const p = (id: string, name: string): RosterPlayer => ({ id, name, photoVersion: 0, photoSeq: 0, updatedAt: 1 });
const roster = [p('1', 'Ana Reyes'), p('2', 'Ben Cruz'), p('3', 'Ben Dale'), p('4', 'Cy')];

describe('nameMatch', () => {
  it('is exact for the same name, ignoring case and spaces at the ends', () => {
    expect(nameMatch('ana reyes', roster)).toEqual({ kind: 'exact', player: roster[0] });
    expect(nameMatch('  BEN CRUZ  ', roster)).toEqual({ kind: 'exact', player: roster[1] });
    expect(nameMatch('Cy', roster)).toEqual({ kind: 'exact', player: roster[3] });
  });

  it('is likely for the same first word and a different name', () => {
    expect(nameMatch('Ana Lopez', roster)).toEqual({ kind: 'likely', player: roster[0] });
    expect(nameMatch('ana', roster)).toEqual({ kind: 'likely', player: roster[0] });
    expect(nameMatch('Cy Tan', roster)).toEqual({ kind: 'likely', player: roster[3] });
  });

  it('takes the first saved player when several share the first word', () => {
    expect(nameMatch('Ben Smith', roster)).toEqual({ kind: 'likely', player: roster[1] });
  });

  it('prefers an exact match over an earlier likely one', () => {
    expect(nameMatch('Ben Dale', roster)).toEqual({ kind: 'exact', player: roster[2] });
  });

  it('is none when nothing lines up', () => {
    expect(nameMatch('Zed Zane', roster)).toEqual({ kind: 'none' });
    expect(nameMatch('Anabel', roster)).toEqual({ kind: 'none' });
  });

  it('is none for an empty roster or a blank name', () => {
    expect(nameMatch('Ana', [])).toEqual({ kind: 'none' });
    expect(nameMatch('   ', roster)).toEqual({ kind: 'none' });
    expect(nameMatch('', roster)).toEqual({ kind: 'none' });
  });

  it('has no player when there is none', () => {
    expect(nameMatch('Zed', roster)).not.toHaveProperty('player');
  });

  it('splits the first word on any run of spaces', () => {
    expect(nameMatch('Ana   Lopez', roster)).toEqual({ kind: 'likely', player: roster[0] });
  });
});
```

Create `src/sync/attendance/prefill.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { prefillFor } from './prefill';
import type { Summary } from './types';

const summary = (over: Partial<Summary> = {}): Summary => ({
  slotId: 'tue',
  code: 'abc',
  playDate: '2026-11-10',
  cancelled: null,
  counts: { in: 0, maybe: 0, out: 0, late: 0 },
  friends: 0,
  waiting: [],
  tonight: [],
  lateIds: [],
  answers: {},
  names: {},
  fetchedAt: 1,
  ...over,
});
const TODAY = '2026-11-10';

describe('prefillFor', () => {
  it('is null with no summary', () => {
    expect(prefillFor(undefined, TODAY)).toBeNull();
  });

  it('is null when the summary is for another day, earlier or later', () => {
    expect(prefillFor(summary(), '2026-11-09')).toBeNull();
    expect(prefillFor(summary(), '2026-11-11')).toBeNull();
    expect(prefillFor(summary({ playDate: '2026-11-03' }), TODAY)).toBeNull();
  });

  it('is null when the day is cancelled, with or without a reason', () => {
    expect(prefillFor(summary({ cancelled: { reason: 'Rain' } }), TODAY)).toBeNull();
    expect(prefillFor(summary({ cancelled: { reason: null } }), TODAY)).toBeNull();
  });

  it('is null for a summary of another slot when the slot is given, and not otherwise', () => {
    expect(prefillFor(summary({ slotId: 'thu' }), TODAY, 'tue')).toBeNull();
    expect(prefillFor(summary(), TODAY, 'tue')).not.toBeNull();
    expect(prefillFor(summary({ slotId: 'thu' }), TODAY)).not.toBeNull();
  });

  it('is empty lists when nobody answered', () => {
    expect(prefillFor(summary(), TODAY)).toEqual({ inIds: [], lateIds: [], maybeIds: [], friends: [] });
  });

  it('splits answers: In, Maybe, and leaves Out out', () => {
    const s = summary({
      names: { a: 'Ana', b: 'Ben', c: 'Cy', d: 'Di' },
      answers: { a: 'in', b: 'maybe', c: 'out', d: 'in' },
    });
    expect(prefillFor(s, TODAY)).toEqual({ inIds: ['a', 'd'], lateIds: [], maybeIds: ['b'], friends: [] });
  });

  it('orders each list by display name, ignoring case', () => {
    const s = summary({
      names: { a: 'zed', b: 'Ben', c: 'ana', d: 'Cy', e: 'bo', f: 'Al' },
      answers: { a: 'in', b: 'in', c: 'in', d: 'maybe', e: 'maybe', f: 'maybe' },
    });
    const p = prefillFor(s, TODAY)!;
    expect(p.inIds).toEqual(['c', 'b', 'a']);
    expect(p.maybeIds).toEqual(['f', 'e', 'd']);
  });

  it('keeps late players in inIds and in lateIds, in name order', () => {
    const s = summary({
      names: { a: 'Ana', b: 'Ben', c: 'Cy' },
      answers: { a: 'in', b: 'in', c: 'in' },
      lateIds: ['c', 'a'],
    });
    const p = prefillFor(s, TODAY)!;
    expect(p.inIds).toEqual(['a', 'b', 'c']);
    expect(p.lateIds).toEqual(['a', 'c']);
  });

  it('does not count a late id whose answer is not In', () => {
    const s = summary({ names: { a: 'Ana', b: 'Ben' }, answers: { a: 'out', b: 'in' }, lateIds: ['a', 'b'] });
    expect(prefillFor(s, TODAY)!.lateIds).toEqual(['b']);
  });

  it('takes friends only from the play-tonight list, by name, with the guest id', () => {
    const s = summary({
      waiting: [{ id: 'w1', name: 'Pending Pat', broughtBy: null }],
      tonight: [
        { id: 'g2', name: 'zoe', broughtBy: 'a' },
        { id: 'g1', name: 'Amy', broughtBy: null },
      ],
    });
    expect(prefillFor(s, TODAY)!.friends).toEqual([
      { id: 'g1', name: 'Amy' },
      { id: 'g2', name: 'zoe' },
    ]);
  });

  it('skips an answer from an id with no display name', () => {
    const s = summary({ names: { a: 'Ana' }, answers: { a: 'in', gone: 'in', gone2: 'maybe' } });
    expect(prefillFor(s, TODAY)).toMatchObject({ inIds: ['a'], maybeIds: [] });
  });

  it('does not change the summary', () => {
    const s = summary({ names: { a: 'Ana', b: 'Al' }, answers: { a: 'in', b: 'in' }, lateIds: ['a'] });
    const copy = structuredClone(s);
    prefillFor(s, TODAY);
    expect(s).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/sync/attendance/copy.test.ts src/sync/attendance/nameMatch.test.ts src/sync/attendance/prefill.test.ts`

Expected: it fails. Test Files `3 failed (3)`, Tests `no tests`.

- [ ] **Step 3: Write the code**

Create `src/sync/attendance/copy.ts`:

```typescript
import { formatRange, type Slot } from '../../store/slots';
import { dateLabel } from '../../member/format';
import { titleFor, weekdayName } from './links';
import type { Summary } from './types';

const compare = (a: string, b: string) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
const sorted = (names: string[]) => [...names].sort(compare);
const withAnswer = (summary: Summary, status: 'in' | 'maybe') =>
  Object.entries(summary.answers)
    .filter(([id, answer]) => answer === status && id in summary.names)
    .map(([id]) => ({ id, name: summary.names[id] }));

/** The attendance list for the group chat. No trailing newline, and Out answers are never listed. */
export function listText(slot: Slot, summary: Summary): string {
  const head = [titleFor(slot), dateLabel(summary.playDate)];
  if (slot.startMin !== undefined || slot.endMin !== undefined) head.push(formatRange(slot.startMin, slot.endMin));
  if (slot.venue?.trim()) head.push(slot.venue.trim());
  const late = new Set(summary.lateIds);
  const inNames = withAnswer(summary, 'in')
    .map((p) => ({ ...p, label: late.has(p.id) ? `${p.name} (late)` : p.name }))
    .sort((a, b) => compare(a.name, b.name));
  const lines = [head.join(', '), `In (${inNames.length})${inNames.length ? `: ${inNames.map((p) => p.label).join(', ')}` : ''}`];
  const maybe = sorted(withAnswer(summary, 'maybe').map((p) => p.name));
  if (maybe.length) lines.push(`Maybe (${maybe.length}): ${maybe.join(', ')}`);
  const friends = sorted(summary.tonight.map((g) => g.name));
  if (friends.length) lines.push(`Friends (${friends.length}): ${friends.join(', ')}`);
  return lines.join('\n');
}

/** A message for the people who answered Maybe, or an empty string when there are none. No link in it. */
export function nudgeText(slot: Slot, summary: Summary): string {
  const names = sorted(withAnswer(summary, 'maybe').map((p) => p.name));
  if (names.length === 0) return '';
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${who}, are you in for ${weekdayName(slot.weekday)}?`;
}
```

Create `src/sync/attendance/nameMatch.ts`:

```typescript
import { norm } from '../rows';
import type { RosterPlayer } from '../../store/rosterDb';

export interface NameMatch {
  kind: 'exact' | 'likely' | 'none';
  player?: RosterPlayer;
}

const firstWord = (name: string) => norm(name).split(/\s+/)[0] ?? '';

/**
 * How a name from the link lines up with the saved roster. Exact: the same name, ignoring case and spaces at the
 * ends. Likely: the same first word and a different name. An exact match anywhere wins over a likely one.
 */
export function nameMatch(name: string, roster: RosterPlayer[]): NameMatch {
  const key = norm(name);
  if (!key) return { kind: 'none' };
  const exact = roster.find((p) => norm(p.name) === key);
  if (exact) return { kind: 'exact', player: exact };
  const first = firstWord(name);
  const likely = roster.find((p) => firstWord(p.name) === first);
  return likely ? { kind: 'likely', player: likely } : { kind: 'none' };
}
```

Create `src/sync/attendance/prefill.ts`:

```typescript
import type { Summary } from './types';

/** What the link tells Setup, when a session starts from the slot the link is for. */
export interface AttendancePrefill {
  /** Players who answered In, late ones included. */
  inIds: string[];
  /** The part of `inIds` who said they are late. */
  lateIds: string[];
  maybeIds: string[];
  /** Friends marked to play tonight. The id is the guest id. */
  friends: { id: string; name: string }[];
}

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * What to pre-fill Setup with, or null when it would not be safe: no summary, the summary is for another slot, the
 * date is not `today` (YYYY-MM-DD, the device's calendar date), or the day is cancelled.
 */
export function prefillFor(summary: Summary | undefined, today: string, slotId?: string): AttendancePrefill | null {
  if (!summary || summary.cancelled || summary.playDate !== today) return null;
  if (slotId !== undefined && summary.slotId !== slotId) return null;
  const named = (status: 'in' | 'maybe') =>
    Object.entries(summary.answers)
      .filter(([id, answer]) => answer === status && id in summary.names)
      .map(([id]) => ({ id, name: summary.names[id] }))
      .sort(byName)
      .map((p) => p.id);
  const inIds = named('in');
  const late = new Set(summary.lateIds);
  return {
    inIds,
    lateIds: inIds.filter((id) => late.has(id)),
    maybeIds: named('maybe'),
    friends: summary.tonight.map(({ id, name }) => ({ id, name })).sort(byName),
  };
}
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/sync/attendance/copy.test.ts src/sync/attendance/nameMatch.test.ts src/sync/attendance/prefill.test.ts`

Expected: it passes. Test Files `3 passed (3)`, Tests `39 passed (39)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2279 tests across 159 files.

- [ ] **Step 5: Commit**

```bash
git add src/sync/attendance/copy.test.ts src/sync/attendance/nameMatch.test.ts src/sync/attendance/prefill.test.ts src/sync/attendance/copy.ts src/sync/attendance/nameMatch.ts src/sync/attendance/prefill.ts
git commit -m "Add the prefill, copy text and name match helpers"
```

---

### Task 6: Cover the gaps the first break-it-on-purpose run found (data layer)

Tests only, added after deliberate breaks to Tasks 3 to 5 got through. They pass on the code from Tasks 3 to 5.

**Files:**
- Modify: `src/sync/attendance/copy.test.ts`

- [ ] **Step 1: Add the tests**

Apply this patch to `src/sync/attendance/copy.test.ts`:

```diff
diff --git a/src/sync/attendance/copy.test.ts b/src/sync/attendance/copy.test.ts
index 8fa36cd..f4327d9 100644
--- a/src/sync/attendance/copy.test.ts
+++ b/src/sync/attendance/copy.test.ts
@@ -76,6 +76,12 @@ describe('listText', () => {
     expect(lines[3]).toBe('Friends (2): Amy, zoe');
   });
 
+  it('skips an answer from someone with no display name', () => {
+    const s = summary({ names: { a: 'Ana' }, answers: { a: 'in', gone: 'in', gone2: 'maybe' } });
+    expect(listText(TUE, s).split('\n').slice(1)).toEqual(['In (1): Ana']);
+    expect(nudgeText(TUE, s)).toBe('');
+  });
+
   it('leaves out the time part when the slot has no time', () => {
     const slot: Slot = { id: 'tue', weekday: 2, venue: 'Sample Hall' };
     expect(listText(slot, summary()).split('\n')[0]).toBe('Tuesday open play, Tue 10 Nov, Sample Hall');
```

- [ ] **Step 2: Run them, then the whole project**

Run: `npx vitest run src/sync/attendance/copy.test.ts`

Expected: it passes. Test Files `1 passed (1)`, Tests `20 passed (20)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2280 tests across 159 files.

- [ ] **Step 3: Commit**

```bash
git add src/sync/attendance/copy.test.ts
git commit -m "Cover a gap found by the mutation check"
```

---

### Task 7: The review sheet and the copy buttons

On the attendance card: "N new names to review" opens a sheet where each new name or friend can be added to the roster, played tonight (friends) or dismissed, with a hint when the name is already saved or could be someone saved. The card also gets "Copy list for the group chat" and "Nudge the maybes", which copy text to the clipboard, with a text box to copy from when the clipboard is refused.

**Files:**
- Modify: `src/styles/app.css`
- Modify: `src/ui/AttendanceCard.tsx`
- Modify: `src/ui/AttendanceSheets.tsx`
- Modify: `src/ui/AttendanceCard.test.tsx`
- Modify: `src/ui/attendanceCss.test.ts`
- Create: `src/ui/attendanceReview.test.tsx`

- [ ] **Step 1: Write the failing tests**

Apply this patch to `src/ui/AttendanceCard.test.tsx`:

```diff
diff --git a/src/ui/AttendanceCard.test.tsx b/src/ui/AttendanceCard.test.tsx
index 685f42b..4a1d571 100644
--- a/src/ui/AttendanceCard.test.tsx
+++ b/src/ui/AttendanceCard.test.tsx
@@ -20,7 +20,7 @@ const TUE: Slot = { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue:
 const OFFLINE = 'No connection. Try again when you are online.';
 const actions = (() => {
   const s = useAttendanceStore.getState();
-  return { refresh: s.refresh, ensureLink: s.ensureLink, resetLink: s.resetLink, cancelWeek: s.cancelWeek, undoCancel: s.undoCancel };
+  return { refresh: s.refresh, ensureLink: s.ensureLink, resetLink: s.resetLink, cancelWeek: s.cancelWeek, undoCancel: s.undoCancel, setGuestState: s.setGuestState };
 })();
 
 function resetEverything() {
@@ -314,7 +314,7 @@ describe('the link state', () => {
   it('counts the new names to review, with the right plural', () => {
     seed({ waiting: [{ id: 'g1', name: 'Mika', broughtBy: null }] });
     const one = setup();
-    expect(screen.getByText('1 new name to review')).toBeInTheDocument();
+    expect(screen.getByRole('button', { name: '1 new name to review' })).toBeInTheDocument();
     one.unmount();
     seed({
       waiting: [
@@ -323,20 +323,21 @@ describe('the link state', () => {
       ],
     });
     setup();
-    expect(screen.getByText('2 new names to review')).toBeInTheDocument();
+    expect(screen.getByRole('button', { name: '2 new names to review' })).toBeInTheDocument();
+    expect(document.querySelector('p.attendance-line:not([role])')).toBeNull();
   });
 
-  it('shows no review line when nobody is waiting', () => {
+  it('shows no review button when nobody is waiting', () => {
     seed();
     setup();
     expect(screen.queryByText(/to review/)).not.toBeInTheDocument();
   });
 
-  it('puts the lines in order: pills, stale, change, review, link, buttons', () => {
+  it('puts the lines in order: pills, stale, change, review button, link, buttons, copy buttons', () => {
     seed({ fetchedAt: new Date(2026, 10, 9, 16, 12).getTime(), waiting: [{ id: 'g1', name: 'Mika', broughtBy: null }] }, { change: { player: 'Ben', from: 'in', to: 'out', at: NOW } });
     const { container } = setup();
     const text = container.textContent!;
-    const order = ['Attendance link', '11 in', 'Updated 4:12 pm', 'Ben changed to Out', '1 new name to review', '/#/j/abc123', 'Share'].map((t) => text.indexOf(t));
+    const order = ['Attendance link', '11 in', 'Updated 4:12 pm', 'Ben changed to Out', '1 new name to review', '/#/j/abc123', 'Share', 'Copy list for the group chat'].map((t) => text.indexOf(t));
     expect(order.every((i) => i >= 0)).toBe(true);
     expect([...order].sort((a, b) => a - b)).toEqual(order);
   });
```

Apply this patch to `src/ui/attendanceCss.test.ts`:

```diff
diff --git a/src/ui/attendanceCss.test.ts b/src/ui/attendanceCss.test.ts
index 38e9aac..81d22c7 100644
--- a/src/ui/attendanceCss.test.ts
+++ b/src/ui/attendanceCss.test.ts
@@ -54,6 +54,21 @@ describe('Attendance card styles', () => {
     expect(rule('.attendance-actions')).toMatch(/flex-wrap:\s*wrap/);
   });
 
+  it('makes the review button full width at 44 px or more, and the copy text 16 px', () => {
+    expect(rule('.attendance-review')).toMatch(/width:\s*100%/);
+    expect(rule('.attendance-btn')).toMatch(/min-height:\s*44px/);
+    expect(rule('.attendance-text')).toMatch(/font-size:\s*16px/);
+  });
+
+  it('draws the review sheet rows from the line and surface variables, and wraps long names and actions', () => {
+    expect(rule('.review-row')).toMatch(/border:[^;]*var\(--line\)/);
+    expect(rule('.review-row')).toMatch(/background:\s*var\(--surface\)/);
+    expect(rule('.review-name')).toMatch(/overflow-wrap:\s*anywhere/);
+    expect(rule('.review-hint')).toMatch(/overflow-wrap:\s*anywhere/);
+    expect(rule('.review-actions')).toMatch(/flex-wrap:\s*wrap/);
+    expect(rule('.review-list')).toMatch(/flex-direction:\s*column/);
+  });
+
   it('has no hard-coded colours and adds no variables', () => {
     expect(section).toContain('var(--');
     expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
```

Create `src/ui/attendanceReview.test.tsx`:

```tsx
import type { PGlite } from '@electric-sql/pglite';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryStore } from '../store/historyStore';
import type { RosterPlayer } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore, type Slot } from '../store/slots';
import { fakeAttendanceRemote, type FakeFlags } from '../sync/attendance/fakeRemote';
import { resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from '../sync/attendance/store';
import type { Summary, WaitingName } from '../sync/attendance/types';
import { useAuthStore } from '../sync/auth';
import { USER_A, createDb } from '../sync/db/harness';
import { useSyncStore } from '../sync/syncStore';
import { AttendanceCard } from './AttendanceCard';

// Monday 9 Nov 2026, 4:20 pm. Date is faked and timers stay real.
const NOW = new Date(2026, 10, 9, 16, 20).getTime();
const TUE: Slot = { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall', courts: 3 };
const OFFLINE = 'No connection. Try again when you are online.';
const realStore = useAttendanceStore.getState();
const actions = {
  refresh: realStore.refresh,
  ensureLink: realStore.ensureLink,
  resetLink: realStore.resetLink,
  cancelWeek: realStore.cancelWeek,
  undoCancel: realStore.undoCancel,
  setGuestState: realStore.setGuestState,
};
const realAdd = useRosterStore.getState().add;

const player = (id: string, name: string): RosterPlayer => ({ id, name, photoVersion: 0, photoSeq: 0, updatedAt: 1 });
const guest = (id: string, name: string, broughtBy: string | null = null): WaitingName => ({ id, name, broughtBy });

function resetEverything() {
  localStorage.clear();
  useAuthStore.setState({ status: 'signedIn', email: 'o@example.com', userId: USER_A, error: null, busy: false });
  useSyncStore.setState({ status: 'off', pending: 0, lastSyncedAt: null });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useRosterStore.setState({ players: [], loaded: true, add: realAdd });
  useAttendanceStore.getState().clear();
  useAttendanceStore.setState(actions);
}

const summary = (over: Partial<Summary> = {}): Summary => ({
  slotId: 'tue',
  code: 'abc123',
  playDate: '2026-11-10',
  cancelled: null,
  counts: { in: 2, maybe: 0, out: 0, late: 0 },
  friends: 0,
  waiting: [],
  tonight: [],
  lateIds: [],
  answers: {},
  names: {},
  fetchedAt: NOW,
  ...over,
});

function seed(over: Partial<Summary> = {}) {
  useAttendanceStore.setState({
    ownerId: USER_A,
    links: { tue: { code: 'abc123' } },
    summaries: { tue: summary(over) },
    lastChange: { tue: null },
    lastError: { tue: null },
    busy: { tue: false },
  });
}

function setup() {
  const user = userEvent.setup({ advanceTimers: () => {} });
  const view = render(<AttendanceCard slot={TUE} onSignIn={vi.fn()} />);
  return { user, ...view };
}

const stubClipboard = (writeText: unknown) =>
  Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true, writable: true });

beforeEach(() => {
  resetEverything();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setAttendanceDeps({ server: () => null, now: () => Date.now(), timezone: () => 'Asia/Manila' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetAttendanceDeps();
  delete (navigator as unknown as Record<string, unknown>).clipboard;
});

const row = (name: string) => within(screen.getByText(name, { selector: '.review-name' }).closest('li') as HTMLElement);
const WAITING = [guest('g1', 'Mika'), guest('g2', 'Rico', 'p-ana')];
const NAMES = { 'p-ana': 'Ana' };

describe('the review button on the card', () => {
  it('is a button with the same words, and the right plural', () => {
    seed({ waiting: [guest('g1', 'Mika')] });
    const one = setup();
    expect(screen.getByRole('button', { name: '1 new name to review' })).toBeEnabled();
    one.unmount();
    seed({ waiting: WAITING });
    setup();
    expect(screen.getByRole('button', { name: '2 new names to review' })).toBeInTheDocument();
  });

  it('is not there when nobody is waiting, or in the cancelled and signed-out states', () => {
    seed();
    const a = setup();
    expect(screen.queryByRole('button', { name: /to review/ })).not.toBeInTheDocument();
    a.unmount();
    seed({ waiting: WAITING, cancelled: { reason: null } });
    const b = setup();
    expect(screen.queryByRole('button', { name: /to review/ })).not.toBeInTheDocument();
    b.unmount();
    useAuthStore.setState({ status: 'signedOut', userId: null });
    seed({ waiting: WAITING });
    setup();
    expect(screen.queryByRole('button', { name: /to review/ })).not.toBeInTheDocument();
  });

  it('opens the review sheet with a title that counts the names', async () => {
    seed({ waiting: WAITING, names: NAMES });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '2 new names to review' }));
    const dialog = screen.getByRole('dialog', { name: '2 to review' });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('the review sheet rows', () => {
  async function open(over: Partial<Summary> = {}, roster: RosterPlayer[] = []) {
    useRosterStore.setState({ players: roster });
    seed({ waiting: WAITING, names: NAMES, ...over });
    const view = setup();
    await view.user.click(screen.getByRole('button', { name: /to review/ }));
    return view;
  }

  it('shows a new member with its note and the two actions', async () => {
    await open();
    const mika = row('Mika');
    expect(mika.getByText('New name, asked to join')).toBeInTheDocument();
    expect(mika.getAllByRole('button').map((b) => b.textContent)).toEqual(['Add to roster', 'Dismiss']);
  });

  it('shows a friend with the first name of the sponsor and the three actions', async () => {
    await open();
    const rico = row('Rico');
    expect(rico.getByText('Friend of Ana')).toBeInTheDocument();
    expect(rico.getAllByRole('button').map((b) => b.textContent)).toEqual(['Play tonight', 'Add to roster', 'Dismiss']);
  });

  it('keeps the sponsor initial when the card shows one, and says Friend when the sponsor is unknown', async () => {
    await open({ names: { 'p-ana': 'Ben K.' }, waiting: [guest('g2', 'Rico', 'p-ana'), guest('g3', 'Lou', 'p-gone')] });
    expect(row('Rico').getByText('Friend of Ben K.')).toBeInTheDocument();
    expect(row('Lou').getByText('Friend')).toBeInTheDocument();
  });

  it('shows the footer line', async () => {
    await open();
    expect(screen.getByText("Added players are saved to your roster. Tick them in Who's playing.")).toBeInTheDocument();
  });

  it('shows no hint for a new name', async () => {
    await open({}, [player('r1', 'Zed')]);
    expect(screen.queryByText(/already saved/)).not.toBeInTheDocument();
  });

  it('hints an exact match, ignoring case and spaces, and Add to roster reads Mark as done', async () => {
    await open({ waiting: [guest('g1', '  mika ')] }, [player('r1', 'Mika')]);
    const mika = row('mika');
    expect(mika.getByText('Already saved as Mika.')).toBeInTheDocument();
    expect(mika.getByRole('button', { name: 'Mark as done' })).toBeInTheDocument();
    expect(mika.queryByRole('button', { name: 'Add to roster' })).not.toBeInTheDocument();
  });

  it('hints a likely match on the first word and still offers Add to roster', async () => {
    await open({ waiting: [guest('g1', 'Mika Tan')] }, [player('r1', 'Mika Reyes')]);
    const mika = row('Mika Tan');
    expect(mika.getByText('Could be Mika Reyes, who is already saved.')).toBeInTheDocument();
    expect(mika.getByRole('button', { name: 'Add to roster' })).toBeInTheDocument();
    expect(mika.queryByRole('button', { name: 'Mark as done' })).not.toBeInTheDocument();
  });

  it('gives a friend with an exact match the Mark as done label too', async () => {
    await open({ waiting: [guest('g2', 'Rico', 'p-ana')] }, [player('r1', 'Rico')]);
    expect(row('Rico').getAllByRole('button').map((b) => b.textContent)).toEqual(['Play tonight', 'Mark as done', 'Dismiss']);
  });
});

describe('the review sheet actions', () => {
  const setGuestState = vi.fn();
  const add = vi.fn();
  beforeEach(() => {
    setGuestState.mockReset().mockResolvedValue({ ok: true });
    add.mockReset().mockImplementation(async (name: string) => player('r-new', name));
    useAttendanceStore.setState({ setGuestState });
    useRosterStore.setState({ add });
  });

  async function open(over: Partial<Summary> = {}) {
    seed({ waiting: WAITING, names: NAMES, ...over });
    const view = setup();
    await view.user.click(screen.getByRole('button', { name: /to review/ }));
    return view;
  }

  it('Add to roster saves the name first, then marks the guest added', async () => {
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Add to roster' }));
    expect(add).toHaveBeenCalledWith('Mika');
    expect(setGuestState).toHaveBeenCalledWith('tue', 'g1', 'added');
    expect(add.mock.invocationCallOrder[0]).toBeLessThan(setGuestState.mock.invocationCallOrder[0]);
  });

  it('Add to roster on a friend does the same', async () => {
    const { user } = await open();
    await user.click(row('Rico').getByRole('button', { name: 'Add to roster' }));
    expect(add).toHaveBeenCalledWith('Rico');
    expect(setGuestState).toHaveBeenCalledWith('tue', 'g2', 'added');
  });

  it('Mark as done still goes through add, which returns the saved player', async () => {
    useRosterStore.setState({ players: [player('r1', 'Mika')] });
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Mark as done' }));
    expect(add).toHaveBeenCalledWith('Mika');
    expect(setGuestState).toHaveBeenCalledWith('tue', 'g1', 'added');
  });

  it('Play tonight sets play_tonight and does not touch the roster', async () => {
    const { user } = await open();
    await user.click(row('Rico').getByRole('button', { name: 'Play tonight' }));
    expect(setGuestState).toHaveBeenCalledWith('tue', 'g2', 'play_tonight');
    expect(add).not.toHaveBeenCalled();
  });

  it('Dismiss sets dismissed and does not touch the roster', async () => {
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    expect(setGuestState).toHaveBeenCalledWith('tue', 'g1', 'dismissed');
    expect(add).not.toHaveBeenCalled();
  });

  it('disables only that row while its write runs, then lets go', async () => {
    let release: (r: { ok: true }) => void = () => {};
    setGuestState.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    for (const b of row('Mika').getAllByRole('button')) expect(b).toBeDisabled();
    for (const b of row('Rico').getAllByRole('button')) expect(b).toBeEnabled();
    await act(async () => release({ ok: true }));
    for (const b of row('Mika').getAllByRole('button')) expect(b).toBeEnabled();
  });

  it('shows the store message in an alert inside the sheet when the write fails, and keeps the row', async () => {
    setGuestState.mockResolvedValueOnce({ ok: false, message: OFFLINE });
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    const alert = await within(screen.getByRole('dialog')).findByRole('alert');
    expect(alert).toHaveTextContent(OFFLINE);
    expect(row('Mika').getByRole('button', { name: 'Dismiss' })).toBeEnabled();
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it('shows the roster message when saving the name fails, and does not mark the guest', async () => {
    add.mockRejectedValueOnce(new Error('That name is not valid.'));
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Add to roster' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That name is not valid.');
    expect(setGuestState).not.toHaveBeenCalled();
  });

  it('falls back to a plain message when the roster failure has no text', async () => {
    add.mockRejectedValueOnce('boom');
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Add to roster' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not add that player.');
  });

  it('clears the message on the next try', async () => {
    setGuestState.mockResolvedValueOnce({ ok: false, message: OFFLINE });
    const { user } = await open();
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    await screen.findByRole('alert');
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('closes with All done on the card when the list empties', async () => {
    const { user } = await open({ waiting: [guest('g1', 'Mika')] });
    setGuestState.mockImplementationOnce(async () => {
      useAttendanceStore.setState({ summaries: { tue: summary({ waiting: [] }) } });
      return { ok: true };
    });
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('All done.');
    expect(screen.queryByRole('button', { name: /to review/ })).not.toBeInTheDocument();
  });

  it('keeps the sheet open while names are left, and shows no All done', async () => {
    const { user } = await open();
    setGuestState.mockImplementationOnce(async () => {
      useAttendanceStore.setState({ summaries: { tue: summary({ waiting: [guest('g2', 'Rico', 'p-ana')], names: NAMES }) } });
      return { ok: true };
    });
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText('Mika', { selector: '.review-name' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: '1 to review' })).toBeInTheDocument();
    expect(screen.queryByText('All done.')).not.toBeInTheDocument();
  });

  it('closes with the close key and shows no All done while names are waiting', async () => {
    const { user } = await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('All done.')).not.toBeInTheDocument();
  });

  it('drops All done the next time the sheet opens', async () => {
    const { user } = await open({ waiting: [guest('g1', 'Mika')] });
    setGuestState.mockImplementationOnce(async () => {
      useAttendanceStore.setState({ summaries: { tue: summary({ waiting: [] }) } });
      return { ok: true };
    });
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    await screen.findByText('All done.');
    await act(async () => {
      useAttendanceStore.setState({ summaries: { tue: summary({ waiting: [guest('g9', 'Zed')] }) } });
    });
    expect(screen.queryByText('All done.')).not.toBeInTheDocument();
  });
});

describe('the review sheet against the real store', () => {
  let db: PGlite;
  let flags: FakeFlags;
  beforeAll(async () => {
    db = await createDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec('truncate public.players, public.attendance_links cascade');
    flags = { offline: false, calls: [] };
    setAttendanceDeps({
      server: () => ({ remote: fakeAttendanceRemote(db, USER_A, flags), userId: USER_A }),
      now: () => Date.now(),
      timezone: () => 'Asia/Manila',
    });
  });

  it('dismisses a name: the row leaves, All done shows, and the guest is dismissed in the database', async () => {
    await db.exec(`insert into public.attendance_links (owner_id, slot_id, title, weekday, timezone) values ('${USER_A}', 'tue', 'Tuesday open play', 2, 'Asia/Manila')`);
    await db.exec(`insert into public.attendance_guests (owner_id, slot_id, play_date, name, state) values ('${USER_A}', 'tue', '2026-11-10', 'Mika', 'pending')`);
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: '1 new name to review' }));
    await user.click(row('Mika').getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('All done.')).toBeInTheDocument();
    expect((await db.query<{ state: string }>('select state from public.attendance_guests')).rows[0].state).toBe('dismissed');
    expect(flags.calls.some((c) => c.startsWith('setGuestState:') && c.endsWith(':dismissed'))).toBe(true);
  });
});

describe('the copy buttons', () => {
  const answers = { a: 'in', b: 'in', c: 'maybe', d: 'maybe', e: 'out' } as const;
  const names = { a: 'Ana', b: 'Ben', c: 'Cai', d: 'Dee', e: 'Eli' };
  const full = (over: Partial<Summary> = {}) =>
    seed({ counts: { in: 2, maybe: 2, out: 1, late: 0 }, answers: { ...answers }, names, ...over });
  const LIST = 'Tuesday open play, Tue 10 Nov, 7:00 to 9:00 pm, Hall\nIn (2): Ana, Ben\nMaybe (2): Cai, Dee';

  it('shows both buttons in the action row after the existing three', () => {
    full();
    setup();
    const names = within(document.querySelector('.attendance-actions') as HTMLElement)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['Share', 'Reset link', 'Cancel this week', 'Copy list for the group chat', 'Nudge the maybes']);
  });

  it('hides Nudge the maybes at zero maybes and keeps the list button', () => {
    seed({ counts: { in: 2, maybe: 0, out: 0, late: 0 }, answers: { a: 'in' }, names });
    setup();
    expect(screen.getByRole('button', { name: 'Copy list for the group chat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nudge the maybes' })).not.toBeInTheDocument();
  });

  it('has neither button in the cancelled state, signed out, or while the link is missing', () => {
    full({ cancelled: { reason: null } });
    const a = setup();
    expect(screen.queryByRole('button', { name: /Copy list|Nudge/ })).not.toBeInTheDocument();
    a.unmount();
    useAuthStore.setState({ status: 'signedOut', userId: null });
    full();
    const b = setup();
    expect(screen.queryByRole('button', { name: /Copy list|Nudge/ })).not.toBeInTheDocument();
    b.unmount();
    useAuthStore.setState({ status: 'signedIn', userId: USER_A });
    useAttendanceStore.getState().clear();
    useAttendanceStore.setState({ lastError: { tue: null } });
    setup();
    expect(screen.queryByRole('button', { name: /Copy list|Nudge/ })).not.toBeInTheDocument();
  });

  it('copies the list and says so', async () => {
    full();
    const { user } = setup();
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    await user.click(screen.getByRole('button', { name: 'Copy list for the group chat' }));
    expect(writeText).toHaveBeenCalledWith(LIST);
    expect(await screen.findByRole('status')).toHaveTextContent('List copied');
    expect(screen.queryByLabelText('Text to copy')).not.toBeInTheDocument();
  });

  it('copies the nudge and says so', async () => {
    full();
    const { user } = setup();
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    await user.click(screen.getByRole('button', { name: 'Nudge the maybes' }));
    expect(writeText).toHaveBeenCalledWith('Cai and Dee, are you in for Tuesday?');
    expect(await screen.findByRole('status')).toHaveTextContent('Message copied');
  });

  it('shows the text selected in a read-only box when the clipboard refuses', async () => {
    full();
    const { user } = setup();
    stubClipboard(vi.fn(async () => { throw new Error('denied'); }));
    await user.click(screen.getByRole('button', { name: 'Copy list for the group chat' }));
    expect(await screen.findByText('Could not copy. Select the text below.')).toBeInTheDocument();
    const box = screen.getByLabelText('Text to copy') as HTMLTextAreaElement;
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('readonly');
    expect(box.value).toBe(LIST);
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(LIST.length);
    expect(screen.queryByText('List copied')).not.toBeInTheDocument();
  });

  it('falls back the same way for the nudge, and when there is no clipboard at all', async () => {
    full();
    const { user } = setup();
    stubClipboard(undefined);
    await user.click(screen.getByRole('button', { name: 'Nudge the maybes' }));
    expect((await screen.findByLabelText('Text to copy')) as HTMLTextAreaElement).toHaveValue('Cai and Dee, are you in for Tuesday?');
  });

  it('replaces the last message with the next one, and drops it when Share is pressed', async () => {
    full();
    const { user } = setup();
    stubClipboard(vi.fn(async () => {}));
    await user.click(screen.getByRole('button', { name: 'Copy list for the group chat' }));
    await screen.findByText('List copied');
    await user.click(screen.getByRole('button', { name: 'Nudge the maybes' }));
    expect(await screen.findByText('Message copied')).toBeInTheDocument();
    expect(screen.queryByText('List copied')).not.toBeInTheDocument();
    Object.defineProperty(navigator, 'share', { value: vi.fn(async () => {}), configurable: true, writable: true });
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.queryByText('Message copied')).not.toBeInTheDocument();
    delete (navigator as unknown as Record<string, unknown>).share;
  });

  it('drops the Link copied line when a list is copied', async () => {
    full();
    const { user } = setup();
    stubClipboard(vi.fn(async () => {}));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await screen.findByText('Link copied');
    await user.click(screen.getByRole('button', { name: 'Copy list for the group chat' }));
    await screen.findByText('List copied');
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument();
  });

  it('keeps the buttons usable while a write is running', () => {
    full();
    useAttendanceStore.setState({ busy: { tue: true } });
    setup();
    expect(screen.getByRole('button', { name: 'Copy list for the group chat' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Nudge the maybes' })).toBeEnabled();
  });

  it('puts late names and friends in the list', async () => {
    full({ lateIds: ['b'], tonight: [guest('g1', 'Rico', 'a')] });
    const { user } = setup();
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    await user.click(screen.getByRole('button', { name: 'Copy list for the group chat' }));
    expect(writeText).toHaveBeenCalledWith(`${LIST}\nFriends (1): Rico`.replace('Ana, Ben', 'Ana, Ben (late)'));
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/AttendanceCard.test.tsx src/ui/attendanceCss.test.ts src/ui/attendanceReview.test.tsx`

Expected: it fails. Test Files `3 failed (3)`, Tests `39 failed | 83 passed (122)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
index 2e90575..cacca1a 100644
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -2639,6 +2639,65 @@ caption {
   font-size: 14px;
 }
 
+.attendance-review {
+  width: 100%;
+  justify-content: center;
+  font-weight: 700;
+}
+
+/* The text the clipboard would not take, selected so a long press can copy it. */
+.attendance-text {
+  font-size: 16px;
+  line-height: 1.4;
+  resize: none;
+}
+
+/* The review sheet: one block per name, with the actions under it. */
+.review-list {
+  display: flex;
+  flex-direction: column;
+  gap: 10px;
+  margin: 0;
+  padding: 0;
+  list-style: none;
+}
+
+.review-row {
+  display: flex;
+  flex-direction: column;
+  gap: 4px;
+  padding: 10px 12px;
+  border: 1px solid var(--line);
+  border-radius: 12px;
+  background: var(--surface);
+}
+
+.review-name {
+  font-size: 16px;
+  font-weight: 700;
+  overflow-wrap: anywhere;
+}
+
+.review-note {
+  font-size: 14px;
+}
+
+.review-hint {
+  padding: 6px 10px;
+  border-radius: 10px;
+  background: color-mix(in srgb, var(--accent) 22%, var(--surface));
+  color: var(--ink);
+  font-size: 14px;
+  overflow-wrap: anywhere;
+}
+
+.review-actions {
+  display: flex;
+  flex-wrap: wrap;
+  gap: 6px;
+  margin-top: 4px;
+}
+
 /* Member page */
 /* What a club member sees at the join link. It uses the app colours; only the name circles bring their own. */
 .member {
```

Apply this patch to `src/ui/AttendanceCard.tsx`:

```diff
diff --git a/src/ui/AttendanceCard.tsx b/src/ui/AttendanceCard.tsx
index b0362a7..a98e589 100644
--- a/src/ui/AttendanceCard.tsx
+++ b/src/ui/AttendanceCard.tsx
@@ -1,11 +1,12 @@
-import { useEffect, useRef, useState, type ReactNode } from 'react';
+import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
 import { shortDate } from '../store/attendance';
 import { formatClock, type Slot } from '../store/slots';
+import { listText, nudgeText } from '../sync/attendance/copy';
 import { shareUrl, titleFor, weekdayName } from '../sync/attendance/links';
 import { useAttendanceStore, type AttendanceResult } from '../sync/attendance/store';
 import type { AttendanceStatus } from '../sync/attendance/types';
 import { useAuthStore } from '../sync/auth';
-import { CancelSheet, ResetSheet } from './AttendanceSheets';
+import { CancelSheet, ResetSheet, ReviewSheet } from './AttendanceSheets';
 import { useAttendance } from './useAttendance';
 
 interface Props {
@@ -57,10 +58,14 @@ export function AttendanceCard({ slot, onSignIn }: Props) {
   const savedChange = useAttendanceStore((s) => s.lastChange[slot.id]);
   const savedError = useAttendanceStore((s) => s.lastError[slot.id]);
   const busy = useAttendanceStore((s) => !!s.busy[slot.id]);
-  const [sheet, setSheet] = useState<'reset' | 'cancel' | null>(null);
+  const [sheet, setSheet] = useState<'reset' | 'cancel' | 'review' | null>(null);
+  // The review sheet closed on its own because the last name was dealt with.
+  const [reviewed, setReviewed] = useState(false);
+  const [copied, setCopied] = useState<{ kind: 'list' | 'nudge'; ok: boolean; text: string } | null>(null);
   const [problem, setProblem] = useState<string | null>(null);
   const [shared, setShared] = useState<'copied' | 'field' | null>(null);
   const fieldRef = useRef<HTMLInputElement>(null);
+  const copyRef = useRef<HTMLTextAreaElement>(null);
 
   // A different account's copy is not shown while the new one loads.
   const mine = ownerId === null || userId === null || ownerId === userId;
@@ -73,6 +78,16 @@ export function AttendanceCard({ slot, onSignIn }: Props) {
     if (shared === 'field') fieldRef.current?.select();
   }, [shared]);
 
+  useEffect(() => {
+    if (copied && !copied.ok) copyRef.current?.select();
+  }, [copied]);
+
+  // The sheet shuts itself when the list is empty. A stable function, so it is not called again by a re-render.
+  const finishReview = useCallback(() => {
+    setSheet((now) => (now === 'review' ? null : now));
+    setReviewed(true);
+  }, []);
+
   if (status === 'unconfigured' || status === 'loading') return null;
 
   if (status === 'signedOut' || status === 'linkSent') {
@@ -102,8 +117,21 @@ export function AttendanceCard({ slot, onSignIn }: Props) {
     else setProblem(result.message);
   }
 
+  async function copy(kind: 'list' | 'nudge', text: string) {
+    setShared(null);
+    setReviewed(false);
+    setProblem(null);
+    try {
+      await navigator.clipboard.writeText(text);
+      setCopied({ kind, ok: true, text });
+    } catch {
+      setCopied({ kind, ok: false, text });
+    }
+  }
+
   async function share(url: string) {
     setShared(null);
+    setCopied(null);
     setProblem(null);
     if (typeof navigator.share === 'function') {
       try {
@@ -212,6 +240,7 @@ export function AttendanceCard({ slot, onSignIn }: Props) {
 
   const url = shareUrl(window.location.origin, link.code);
   const { counts, waiting } = summary;
+  const nudge = counts.maybe > 0 ? nudgeText(slot, summary) : '';
   return (
     <Shell weekday={weekdayName(slot.weekday)}>
       <ul className="attendance-pills" aria-label="Answers">
@@ -228,7 +257,19 @@ export function AttendanceCard({ slot, onSignIn }: Props) {
         stale || !!change || waiting.length > 0,
         <>
           {change && <p className="attendance-line">{`${change.player} changed to ${STATUS_LABEL[change.to]} at ${clock(change.at)}.`}</p>}
-          {waiting.length > 0 && <p className="attendance-line">{`${plural(waiting.length, 'new name', 'new names')} to review`}</p>}
+          {waiting.length > 0 && (
+            <button
+              type="button"
+              className="btn attendance-btn attendance-review"
+              onClick={() => {
+                setReviewed(false);
+                setProblem(null);
+                setSheet('review');
+              }}
+            >
+              {`${plural(waiting.length, 'new name', 'new names')} to review`}
+            </button>
+          )}
         </>,
       )}
       <p className="attendance-link">{url}</p>
@@ -242,7 +283,31 @@ export function AttendanceCard({ slot, onSignIn }: Props) {
         <button type="button" className="btn attendance-btn" disabled={busy} onClick={() => setSheet('cancel')}>
           Cancel this week
         </button>
+        <button type="button" className="btn attendance-btn" onClick={() => void copy('list', listText(slot, summary))}>
+          Copy list for the group chat
+        </button>
+        {nudge && (
+          <button type="button" className="btn attendance-btn" onClick={() => void copy('nudge', nudge)}>
+            Nudge the maybes
+          </button>
+        )}
       </div>
+      {reviewed && waiting.length === 0 && (
+        <p className="attendance-line" role="status">
+          All done.
+        </p>
+      )}
+      {copied?.ok && (
+        <p className="attendance-line" role="status">
+          {copied.kind === 'list' ? 'List copied' : 'Message copied'}
+        </p>
+      )}
+      {copied && !copied.ok && (
+        <>
+          <p className="attendance-line">Could not copy. Select the text below.</p>
+          <textarea ref={copyRef} className="field attendance-text" readOnly rows={4} aria-label="Text to copy" value={copied.text} />
+        </>
+      )}
       {shared === 'copied' && (
         <p className="attendance-line" role="status">
           Link copied
@@ -253,6 +318,7 @@ export function AttendanceCard({ slot, onSignIn }: Props) {
       {sheet === 'reset' && (
         <ResetSheet busy={busy} error={problem} onClose={closeSheet} onConfirm={() => void run(() => store().resetLink(slot.id), closeSheet)} />
       )}
+      {sheet === 'review' && <ReviewSheet slotId={slot.id} waiting={waiting} names={summary.names} onEmpty={finishReview} onClose={closeSheet} />}
       {sheet === 'cancel' && (
         <CancelSheet
           dateLabel={dateLabel(summary.playDate)}
```

Apply this patch to `src/ui/AttendanceSheets.tsx`:

```diff
diff --git a/src/ui/AttendanceSheets.tsx b/src/ui/AttendanceSheets.tsx
index 936cf9a..f76c686 100644
--- a/src/ui/AttendanceSheets.tsx
+++ b/src/ui/AttendanceSheets.tsx
@@ -1,4 +1,8 @@
-import { useState } from 'react';
+import { useEffect, useRef, useState } from 'react';
+import { useRosterStore } from '../store/rosterStore';
+import { nameMatch } from '../sync/attendance/nameMatch';
+import { useAttendanceStore } from '../sync/attendance/store';
+import type { WaitingName } from '../sync/attendance/types';
 import { Sheet } from './Sheet';
 
 const MAX_REASON = 140;
@@ -80,3 +84,92 @@ export function CancelSheet({ dateLabel, busy, error, onConfirm, onClose }: Canc
     </Sheet>
   );
 }
+
+interface ReviewProps {
+  slotId: string;
+  waiting: WaitingName[];
+  /** Display first names by player id, for "Friend of Ana". */
+  names: Record<string, string>;
+  /** Called when the last name has been dealt with. */
+  onEmpty: () => void;
+  onClose: () => void;
+}
+
+/** The new names and friends members sent. Nothing reaches the roster until the organizer says so. */
+export function ReviewSheet({ slotId, waiting, names, onEmpty, onClose }: ReviewProps) {
+  const roster = useRosterStore((s) => s.players);
+  const [working, setWorking] = useState<string | null>(null);
+  const [error, setError] = useState<string | null>(null);
+
+  const onEmptyRef = useRef(onEmpty);
+  useEffect(() => {
+    onEmptyRef.current = onEmpty;
+  }, [onEmpty]);
+  useEffect(() => {
+    if (waiting.length === 0) onEmptyRef.current();
+  }, [waiting.length]);
+
+  /** Runs one row's change. A failure keeps the row and shows why. */
+  async function act(guest: WaitingName, change: () => Promise<string | null>) {
+    setError(null);
+    setWorking(guest.id);
+    try {
+      const problem = await change();
+      if (problem) setError(problem);
+    } finally {
+      setWorking(null);
+    }
+  }
+  const mark = async (guest: WaitingName, state: 'play_tonight' | 'added' | 'dismissed') => {
+    const result = await useAttendanceStore.getState().setGuestState(slotId, guest.id, state);
+    return result.ok ? null : result.message;
+  };
+  const addToRoster = async (guest: WaitingName) => {
+    try {
+      await useRosterStore.getState().add(guest.name);
+    } catch (e) {
+      return e instanceof Error ? e.message : 'Could not add that player.';
+    }
+    return mark(guest, 'added');
+  };
+
+  return (
+    <Sheet title={`${waiting.length} to review`} onClose={onClose}>
+      <ul className="review-list">
+        {waiting.map((guest) => {
+          const match = nameMatch(guest.name, roster);
+          const friend = guest.broughtBy !== null;
+          const sponsor = guest.broughtBy !== null ? names[guest.broughtBy] : undefined;
+          const disabled = working === guest.id;
+          return (
+            <li key={guest.id} className="review-row">
+              <p className="review-name">{guest.name}</p>
+              <p className="muted review-note">{friend ? (sponsor ? `Friend of ${sponsor}` : 'Friend') : 'New name, asked to join'}</p>
+              {match.kind === 'exact' && <p className="review-hint">{`Already saved as ${match.player?.name}.`}</p>}
+              {match.kind === 'likely' && <p className="review-hint">{`Could be ${match.player?.name}, who is already saved.`}</p>}
+              <div className="review-actions">
+                {friend && (
+                  <button type="button" className="btn btn-live attendance-btn" disabled={disabled} onClick={() => void act(guest, () => mark(guest, 'play_tonight'))}>
+                    Play tonight
+                  </button>
+                )}
+                <button type="button" className="btn attendance-btn" disabled={disabled} onClick={() => void act(guest, () => addToRoster(guest))}>
+                  {match.kind === 'exact' ? 'Mark as done' : 'Add to roster'}
+                </button>
+                <button type="button" className="btn attendance-btn" disabled={disabled} onClick={() => void act(guest, () => mark(guest, 'dismissed'))}>
+                  Dismiss
+                </button>
+              </div>
+            </li>
+          );
+        })}
+      </ul>
+      {error && (
+        <p className="error" role="alert">
+          {error}
+        </p>
+      )}
+      <p className="muted">Added players are saved to your roster. Tick them in Who's playing.</p>
+    </Sheet>
+  );
+}
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/AttendanceCard.test.tsx src/ui/attendanceCss.test.ts src/ui/attendanceReview.test.tsx`

Expected: it passes. Test Files `3 passed (3)`, Tests `122 passed (122)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2319 tests across 160 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/AttendanceCard.test.tsx src/ui/attendanceCss.test.ts src/ui/attendanceReview.test.tsx src/styles/app.css src/ui/AttendanceCard.tsx src/ui/AttendanceSheets.tsx
git commit -m "Add the review sheet and the copy buttons to the attendance card"
```

---

### Task 8: Who's playing opens pre-filled

Starting a session from a slot on the day members answered now opens Who's playing with the people who said In ticked (a late one is tagged and will start on a break), the maybes listed unticked, and friends marked to play tonight in their own group as session-only players. Everyone else sits below. Starting on any other day, or while signed out, works exactly as before.

**Files:**
- Modify: `src/styles/app.css`
- Modify: `src/ui/HomeScreen.tsx`
- Modify: `src/ui/SetupScreen.tsx`
- Create: `src/ui/attendanceStart.test.tsx`
- Create: `src/ui/setupAttendance.test.tsx`
- Create: `src/ui/setupGroupsCss.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/attendanceStart.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore } from '../store/slots';
import { resetAttendanceDeps, setAttendanceDeps, useAttendanceStore } from '../sync/attendance/store';
import type { Summary } from '../sync/attendance/types';
import { useAuthStore } from '../sync/auth';
import { useSyncStore } from '../sync/syncStore';
import { HomeScreen, type SessionPlan } from './HomeScreen';

// Saturday 7 Nov 2026, noon: the Saturday slot is selected.
const NOW = new Date(2026, 10, 7, 12).getTime();

const summary = (over: Partial<Summary> = {}): Summary => ({
  slotId: 'sat',
  code: 'code-sat',
  playDate: '2026-11-07',
  cancelled: null,
  counts: { in: 2, maybe: 1, out: 0, late: 1 },
  friends: 1,
  waiting: [],
  tonight: [{ id: 'g1', name: 'Rico', broughtBy: 'p1' }],
  lateIds: ['p2'],
  answers: { p1: 'in', p2: 'in', p3: 'maybe', p4: 'out' },
  names: { p1: 'Ana', p2: 'Ben', p3: 'Cai', p4: 'Dee' },
  fetchedAt: NOW,
  ...over,
});

function seed(over: Partial<Summary> | null = {}, owner: string | null = 'user-a') {
  useAttendanceStore.setState({
    ownerId: owner,
    links: { sat: { code: 'code-sat' } },
    summaries: over === null ? {} : { sat: summary(over) },
    lastChange: {},
    lastError: { sat: null },
    busy: {},
  });
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ status: 'signedIn', email: 'o@example.com', userId: 'user-a', error: null, busy: false });
  useSyncStore.setState({ status: 'off', pending: 0, lastSyncedAt: null });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useRosterStore.setState({ players: [], loaded: true });
  useAttendanceStore.getState().clear();
  setAttendanceDeps({ server: () => null, now: () => Date.now(), timezone: () => 'Asia/Manila' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetAttendanceDeps();
});

async function start(): Promise<SessionPlan | undefined> {
  const onStart = vi.fn();
  const user = userEvent.setup({ advanceTimers: () => {} });
  render(<HomeScreen onStart={onStart} onResume={vi.fn()} onHistory={vi.fn()} onViewSummary={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Start session/ }));
  expect(onStart).toHaveBeenCalledTimes(1);
  return onStart.mock.calls[0][0];
}

describe('Home hands the answers to Setup', () => {
  it('builds the prefill from the answers when everything lines up', async () => {
    seed();
    const plan = await start();
    expect(plan?.attendance).toEqual({
      inIds: ['p1', 'p2'],
      lateIds: ['p2'],
      maybeIds: ['p3'],
      friends: [{ id: 'g1', name: 'Rico' }],
    });
  });

  it('keeps the rest of the plan as it was', async () => {
    seed();
    const plan = await start();
    expect(plan).toMatchObject({ slotId: 'sat', weekday: 6 });
  });

  it('adds nothing when the play date is not today', async () => {
    seed({ playDate: '2026-11-14' });
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing when the play date was yesterday', async () => {
    seed({ playDate: '2026-11-06' });
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing when the day is cancelled', async () => {
    seed({ cancelled: { reason: 'Rain' } });
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing when there is no summary', async () => {
    seed(null);
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing when the summary is for another slot', async () => {
    seed({ slotId: 'tue' });
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing when the copy belongs to another account', async () => {
    seed({}, 'user-b');
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing when the device has no saved owner', async () => {
    seed({}, null);
    expect(await start()).not.toHaveProperty('attendance');
  });

  it.each(['signedOut', 'linkSent', 'unknown'] as const)('adds nothing when sign-in is %s', async (status) => {
    useAuthStore.setState({ status, userId: status === 'unknown' ? null : null });
    seed();
    expect(await start()).not.toHaveProperty('attendance');
  });

  it('adds nothing for a one-off session', async () => {
    seed();
    const onStart = vi.fn();
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<HomeScreen onStart={onStart} onResume={vi.fn()} onHistory={vi.fn()} onViewSummary={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'One-off session' }));
    await user.click(screen.getByRole('button', { name: 'Start a one-off session' }));
    expect(onStart).toHaveBeenCalledWith(undefined);
  });

  it('reads the date on the device clock, not in UTC, just after local midnight', async () => {
    vi.setSystemTime(new Date(2026, 10, 7, 0, 30).getTime());
    seed();
    expect((await start())?.attendance?.inIds).toEqual(['p1', 'p2']);
  });

  it('reads the date on the device clock, not in UTC, just before local midnight', async () => {
    vi.setSystemTime(new Date(2026, 10, 7, 23, 59).getTime());
    seed();
    expect((await start())?.attendance?.inIds).toEqual(['p1', 'p2']);
  });
});
```

Create `src/ui/setupAttendance.test.tsx`:

```tsx
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../engine/types';
import { useHistoryStore } from '../store/historyStore';
import type { RosterPlayer } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, useSlotsStore } from '../store/slots';
import type { AttendancePrefill } from '../sync/attendance/prefill';
import { setDefaultMode } from './matchmaking';
import type { SessionPlan } from './HomeScreen';
import { SetupScreen } from './SetupScreen';

const player = (id: string, name: string): RosterPlayer => ({ id, name, photoVersion: 0, photoSeq: 0, updatedAt: 1 });
const ROSTER = [
  player('ana', 'Ana'),
  player('ben', 'Ben'),
  player('cai', 'Cai'),
  player('dee', 'Dee'),
  player('eli', 'Eli'),
  player('fay', 'Fay'),
  player('gus', 'Gus'),
  player('hal', 'Hal'),
];

const prefill = (over: Partial<AttendancePrefill> = {}): AttendancePrefill => ({
  inIds: ['ana', 'ben', 'cai', 'dee'],
  lateIds: [],
  maybeIds: ['eli', 'fay'],
  friends: [{ id: 'g1', name: 'Rico' }],
  ...over,
});
const plan = (attendance?: AttendancePrefill): SessionPlan => ({ slotId: 'tue', weekday: 2, ...(attendance ? { attendance } : {}) });

beforeEach(() => {
  localStorage.clear();
  setDefaultMode('fairness');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
  useRosterStore.setState({ players: ROSTER, loaded: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(p: SessionPlan) {
  const user = userEvent.setup();
  render(<SetupScreen onManage={vi.fn()} plan={p} />);
  return user;
}
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const group = (title: string) => within(screen.getByRole('heading', { name: title }).closest('section') as HTMLElement);
const session = () => useSessionStore.getState().session as Session;
const byName = (name: string) => session().players.find((p) => p.name === name);
const onCourt = (s: Session) =>
  new Set(s.courts.flatMap((c) => [c.game, c.lineup].flatMap((g) => (g ? [...g.team1, ...g.team2] : []))));

describe('Setup without a prefill', () => {
  it('has no groups, no friends and no extra lines, and nothing is ticked', () => {
    setup(plan());
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText('Everyone else')).not.toBeInTheDocument();
    expect(screen.queryByText(/not saved on this phone/)).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Saved players' })).toBeInTheDocument();
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pick at least 4' })).toBeDisabled();
  });

  it('treats a prefill with nothing in it as no prefill', () => {
    setup(plan(prefill({ inIds: [], lateIds: [], maybeIds: [], friends: [] })));
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText('Everyone else')).not.toBeInTheDocument();
  });
});

describe('Setup with a prefill: the groups', () => {
  it('shows the groups in order, with their counts, and the rest of the roster last', () => {
    setup(plan(prefill()));
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(['Said In, 4', 'Maybe, 2', 'Friends, 1', 'Everyone else']);
  });

  it('puts each player in the right group, and the rest in Everyone else', () => {
    setup(plan(prefill()));
    const names = (title: string) => group(title).getAllByRole('checkbox').map((c) => c.closest('li')!.querySelector('.row-name')!.textContent);
    expect(names('Said In, 4')).toEqual(['Ana', 'Ben', 'Cai', 'Dee']);
    expect(names('Maybe, 2')).toEqual(['Eli', 'Fay']);
    expect(names('Friends, 1')).toEqual(['Rico']);
    expect(names('Everyone else')).toEqual(['Gus', 'Hal']);
  });

  it('ticks Said In and the friends, and leaves Maybe and everyone else unticked', () => {
    setup(plan(prefill()));
    for (const n of ['Ana', 'Ben', 'Cai', 'Dee', 'Rico']) expect(box(n)).toBeChecked();
    for (const n of ['Eli', 'Fay', 'Gus', 'Hal']) expect(box(n)).not.toBeChecked();
  });

  it('counts roster players plus ticked friends, in the header and on the Start button', () => {
    setup(plan(prefill()));
    expect(screen.getByText('5 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start 5 players' })).toBeEnabled();
  });

  it('leaves out a group that is empty', () => {
    setup(plan(prefill({ maybeIds: [], friends: [] })));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Said In, 4', 'Everyone else']);
  });

  it('labels late players, and only them', () => {
    setup(plan(prefill({ lateIds: ['cai'] })));
    expect(within(group('Said In, 4').getByRole('checkbox', { name: 'Cai' }).closest('li') as HTMLElement).getByText('Late, starts on a break')).toBeInTheDocument();
    expect(screen.getAllByText('Late, starts on a break')).toHaveLength(1);
  });

  it('labels the friends', () => {
    setup(plan(prefill()));
    expect(within(group('Friends, 1').getByRole('checkbox', { name: 'Rico' }).closest('li') as HTMLElement).getByText('Friend, tonight only')).toBeInTheDocument();
  });

  it('describes a checkbox by its tag, so the name stays clean', () => {
    setup(plan(prefill({ lateIds: ['cai'] })));
    expect(box('Cai')).toHaveAccessibleDescription('Late, starts on a break');
    expect(box('Rico')).toHaveAccessibleDescription('Friend, tonight only');
  });

  it('says how many who said In are not saved on this phone, and skips them', () => {
    setup(plan(prefill({ inIds: ['ana', 'ben', 'cai', 'dee', 'zed', 'yan'] })));
    expect(screen.getByText('2 who said In are not saved on this phone yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Said In, 4' })).toBeInTheDocument();
    expect(screen.getByText('5 selected')).toBeInTheDocument();
  });

  it('uses the singular for one', () => {
    setup(plan(prefill({ inIds: ['ana', 'ben', 'cai', 'dee', 'zed'] })));
    expect(screen.getByText('1 who said In is not saved on this phone yet.')).toBeInTheDocument();
  });

  it('shows no such line when everyone is saved', () => {
    setup(plan(prefill()));
    expect(screen.queryByText(/not saved on this phone/)).not.toBeInTheDocument();
  });

  it('still shows the line when nobody who said In is saved', () => {
    setup(plan(prefill({ inIds: ['zed'] })));
    expect(screen.getByText('1 who said In is not saved on this phone yet.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Said In/ })).not.toBeInTheDocument();
  });
});

describe('Setup with a prefill: picking', () => {
  it('unticks a player and updates the count, and the player stays in the group', async () => {
    const user = setup(plan(prefill()));
    await user.click(box('Ana'));
    expect(box('Ana')).not.toBeChecked();
    expect(screen.getByText('4 selected')).toBeInTheDocument();
    expect(group('Said In, 4').getByRole('checkbox', { name: 'Ana' })).toBeInTheDocument();
  });

  it('ticks a maybe', async () => {
    const user = setup(plan(prefill()));
    await user.click(box('Eli'));
    expect(screen.getByText('6 selected')).toBeInTheDocument();
  });

  it('toggles a friend on and off, and the count follows', async () => {
    const user = setup(plan(prefill()));
    await user.click(box('Rico'));
    expect(box('Rico')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Start 4 players' })).toBeEnabled();
    expect(screen.getByText('4 selected')).toBeInTheDocument();
    await user.click(box('Rico'));
    expect(screen.getByText('5 selected')).toBeInTheDocument();
  });

  it('asks for four when fewer are ticked, friends included', async () => {
    const user = setup(plan(prefill()));
    await user.click(box('Ana'));
    await user.click(box('Rico'));
    expect(screen.getByRole('button', { name: 'Pick at least 4' })).toBeDisabled();
  });

  it('keeps the friends as they are when Clear, Select all or a shortcut is used', async () => {
    const user = setup(plan(prefill({ friends: [{ id: 'g1', name: 'Rico' }, { id: 'g2', name: 'Zoe' }] })));
    await user.click(box('Zoe'));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(box('Rico')).toBeChecked();
    expect(box('Zoe')).not.toBeChecked();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(box('Rico')).toBeChecked();
    expect(box('Zoe')).not.toBeChecked();
    expect(screen.getByText('9 selected')).toBeInTheDocument();
  });

  it('keeps the friends when Same as last time is used', async () => {
    useRosterStore.setState({ players: ROSTER.map((p) => (p.id === 'gus' || p.id === 'hal' ? { ...p, lastPlayedAt: 5 } : p)) });
    const user = setup(plan(prefill()));
    await user.click(screen.getByRole('button', { name: 'Same as last time (2)' }));
    expect(box('Gus')).toBeChecked();
    expect(box('Ana')).not.toBeChecked();
    expect(box('Rico')).toBeChecked();
  });

  it('searches only Everyone else, and does not claim nobody matches when a grouped player does', async () => {
    const user = setup(plan(prefill()));
    await user.type(screen.getByLabelText('Search or add players'), 'gu');
    expect(group('Everyone else').getAllByRole('checkbox')).toHaveLength(1);
    await user.clear(screen.getByLabelText('Search or add players'));
    await user.type(screen.getByLabelText('Search or add players'), 'ben');
    expect(screen.queryByText('No one matches.')).not.toBeInTheDocument();
  });

  it('puts the groups above the search box', () => {
    setup(plan(prefill()));
    const title = screen.getByRole('heading', { name: 'Said In, 4' });
    const search = screen.getByLabelText('Search or add players');
    expect(title.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Setup with a prefill: starting the session', () => {
  it('starts the ticked roster players with their roster ids and the ticked friends without one', async () => {
    const user = setup(plan(prefill()));
    await user.click(screen.getByRole('button', { name: 'Start 5 players' }));
    const players = session().players;
    expect(players.map((p) => p.name).sort()).toEqual(['Ana', 'Ben', 'Cai', 'Dee', 'Rico']);
    expect(byName('Ana')).toMatchObject({ rosterId: 'ana', status: 'active' });
    expect(byName('Rico')?.rosterId).toBeUndefined();
    expect(byName('Rico')?.status).toBe('active');
  });

  it('starts late players on a break, off the courts, and fills the courts with the others', async () => {
    const user = setup(plan(prefill({ inIds: ['ana', 'ben', 'cai', 'dee', 'eli', 'fay'], lateIds: ['fay'], maybeIds: [], friends: [] })));
    await user.click(screen.getByRole('button', { name: 'Start 6 players' }));
    const s = session();
    expect(byName('Fay')).toMatchObject({ status: 'break', rosterId: 'fay' });
    expect(s.queueOrder).not.toContain(byName('Fay')!.id);
    const placed = onCourt(s);
    expect(placed.has(byName('Fay')!.id)).toBe(false);
    expect(placed.size).toBe(4);
    for (const n of ['Ana', 'Ben', 'Cai', 'Dee', 'Eli']) expect(byName(n)!.status).toBe('active');
  });

  it('does not start a late player who was unticked', async () => {
    const user = setup(plan(prefill({ inIds: ['ana', 'ben', 'cai', 'dee', 'eli'], lateIds: ['eli'], maybeIds: [], friends: [] })));
    await user.click(box('Eli'));
    await user.click(screen.getByRole('button', { name: 'Start 4 players' }));
    expect(byName('Eli')).toBeUndefined();
  });

  it('does not make a late player of a ticked maybe', async () => {
    const user = setup(plan(prefill({ lateIds: ['ana'] })));
    await user.click(box('Eli'));
    await user.click(screen.getByRole('button', { name: 'Start 6 players' }));
    expect(byName('Eli')?.status).toBe('active');
    expect(byName('Ana')?.status).toBe('break');
  });

  it('skips a friend whose name matches a ticked player, ignoring case and spaces, and does not count it', async () => {
    const user = setup(plan(prefill({ friends: [{ id: 'g1', name: '  ana ' }, { id: 'g2', name: 'Rico' }] })));
    expect(screen.getByRole('button', { name: 'Start 5 players' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Start 5 players' }));
    expect(session().players.map((p) => p.name).sort()).toEqual(['Ana', 'Ben', 'Cai', 'Dee', 'Rico']);
  });

  it('skips a friend who matches an earlier friend', async () => {
    const user = setup(plan(prefill({ friends: [{ id: 'g1', name: 'Rico' }, { id: 'g2', name: 'RICO' }] })));
    await user.click(screen.getByRole('button', { name: 'Start 5 players' }));
    expect(session().players.filter((p) => p.name.toLowerCase() === 'rico')).toHaveLength(1);
  });

  it('keeps a friend whose name matches a player who is not ticked', async () => {
    const user = setup(plan(prefill({ friends: [{ id: 'g1', name: 'Gus' }] })));
    await user.click(screen.getByRole('button', { name: 'Start 5 players' }));
    const gus = byName('Gus');
    expect(gus).toBeDefined();
    expect(gus?.rosterId).toBeUndefined();
  });

  it('does not add a friend to the roster', async () => {
    const add = vi.spyOn(useRosterStore.getState(), 'add');
    const user = setup(plan(prefill()));
    await user.click(screen.getByRole('button', { name: 'Start 5 players' }));
    expect(add).not.toHaveBeenCalled();
    expect(useRosterStore.getState().players).toHaveLength(8);
  });

  it('starts with no friends when they are all unticked', async () => {
    const user = setup(plan(prefill()));
    await user.click(box('Rico'));
    await user.click(screen.getByRole('button', { name: 'Start 4 players' }));
    expect(byName('Rico')).toBeUndefined();
    expect(session().players).toHaveLength(4);
  });

  it('carries the slot, weekday and venue through, as before', async () => {
    const user = setup({ ...plan(prefill()), venue: 'Hall' });
    await user.click(screen.getByRole('button', { name: 'Start 5 players' }));
    expect(session()).toMatchObject({ slotId: 'tue', weekday: 2, venue: 'Hall' });
  });
});
```

Create `src/ui/setupGroupsCss.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import css from '../styles/app.css?raw';

// The Setup rules sit together before the Home section.
const START = css.indexOf('/* ---------- New session ---------- */');
const END = css.indexOf('/* Home */');
const section = css.slice(START, END);

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(section);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
}

describe('Setup group styles', () => {
  it('sit with the other Setup rules, before Home', () => {
    expect(START).toBeGreaterThan(0);
    expect(END).toBeGreaterThan(START);
    for (const sel of ['.pick-group', '.pick-group-title', '.pick-wide', '.pick-tag']) expect(section).toContain(`${sel} {`);
  });

  it('stack a group as a heading over its list', () => {
    expect(rule('.pick-group')).toMatch(/flex-direction:\s*column/);
  });

  it('draw the heading in the muted colour', () => {
    expect(rule('.pick-group-title')).toMatch(/color:\s*var\(--muted\)/);
  });

  it('give a tagged row the whole width of the grid', () => {
    expect(rule('.pick-wide')).toMatch(/grid-column:\s*1\s*\/\s*-1/);
  });

  it('keep the tag readable on the ticked ink row: outlined in the text colour, not filled', () => {
    expect(rule('.pick-tag')).toMatch(/border:\s*1px solid currentColor/);
    expect(rule('.pick-tag')).toMatch(/background:\s*transparent/);
    expect(rule('.pick-tag')).toMatch(/margin-left:\s*auto/);
  });

  it('let a long name shrink instead of pushing the row sideways', () => {
    expect(rule('.pick-wide .row-name')).toMatch(/min-width:\s*0/);
    expect(rule('.pick-tag')).toMatch(/min-width:\s*0/);
  });

  it('keep the rows at 44 px or more, with no hard-coded colours', () => {
    expect(rule('.pick')).toMatch(/min-height:\s*(4[4-9]|[5-9]\d)px/);
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('have no em dashes', () => {
    expect(section).not.toContain(String.fromCharCode(0x2014));
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/attendanceStart.test.tsx src/ui/setupAttendance.test.tsx src/ui/setupGroupsCss.test.ts`

Expected: it fails. Test Files `3 failed (3)`, Tests `38 failed | 17 passed (55)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
index cacca1a..57c0046 100644
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1444,6 +1444,42 @@ caption {
   outline-offset: 2px;
 }
 
+/* The groups the attendance link fills in: Said In, Maybe, Friends, then everyone else. */
+.pick-group {
+  display: flex;
+  flex-direction: column;
+  gap: 8px;
+}
+
+.pick-group-title {
+  margin: 0;
+  color: var(--muted);
+  font-size: 13px;
+  font-weight: 700;
+  letter-spacing: 0.04em;
+  text-transform: uppercase;
+}
+
+/* A row with a tag takes the whole width, so the tag has room beside the name. */
+.pick-wide {
+  grid-column: 1 / -1;
+}
+
+.pick-tag {
+  margin-left: auto;
+  flex: 0 1 auto;
+  min-width: 0;
+  border: 1px solid currentColor;
+  background: transparent;
+  color: inherit;
+  text-align: right;
+}
+
+.pick-wide .row-name {
+  flex: 0 1 auto;
+  min-width: 0;
+}
+
 /* ---------- Saved players rows ---------- */
 .saved-row {
   display: flex;
```

Apply this patch to `src/ui/HomeScreen.tsx`:

```diff
diff --git a/src/ui/HomeScreen.tsx b/src/ui/HomeScreen.tsx
index 11511fd..39410ca 100644
--- a/src/ui/HomeScreen.tsx
+++ b/src/ui/HomeScreen.tsx
@@ -4,6 +4,10 @@ import { chipLabel, ctaGrade, doneEntry, sessionWeekday, sortedSlots, weeksPlaye
 import { useHistoryStore } from '../store/historyStore';
 import { useSessionStore } from '../store/sessionStore';
 import { effectiveSlot, nextSlot, timestampAt, useSlotsStore, type Slot } from '../store/slots';
+import { prefillFor, type AttendancePrefill } from '../sync/attendance/prefill';
+import { localDate } from '../sync/attendance/links';
+import { useAttendanceStore } from '../sync/attendance/store';
+import { useAuthStore } from '../sync/auth';
 import { AttendanceCard } from './AttendanceCard';
 import { EditSlotSheet, type SlotPatch, type SlotScope } from './EditSlotSheet';
 import { DoneCard, ViewSummaryRow, useSharePicture } from './HomeDone';
@@ -18,6 +22,8 @@ export interface SessionPlan {
   venue?: string;
   plannedEndAt?: number;
   courts?: number;
+  /** What the attendance link says, when it is safe to use it. */
+  attendance?: AttendancePrefill;
 }
 
 interface Props {
@@ -73,6 +79,10 @@ export function HomeScreen({ onStart, onResume, onHistory, onViewSummary, onSign
   const clearTonight = useSlotsStore((s) => s.clearTonight);
   const session = useSessionStore((s) => s.session);
   const entries = useHistoryStore((s) => s.entries);
+  const status = useAuthStore((s) => s.status);
+  const userId = useAuthStore((s) => s.userId);
+  const ownerId = useAttendanceStore((s) => s.ownerId);
+  const summaries = useAttendanceStore((s) => s.summaries);
   // A tapped chip wins over the default until the screen goes away.
   const [picked, setPicked] = useState<string | null>(null);
   const [editingId, setEditingId] = useState<string | null>(null);
@@ -98,6 +108,12 @@ export function HomeScreen({ onStart, onResume, onHistory, onViewSummary, onSign
     if (e.venue !== undefined) plan.venue = e.venue;
     if (e.courts !== undefined) plan.courts = e.courts;
     if (e.endMin !== undefined) plan.plannedEndAt = timestampAt(e.endMin, Date.now());
+    // Only the signed-in organizer who owns the saved copy, and only for today's date at this slot.
+    if (status === 'signedIn' && userId !== null && ownerId === userId) {
+      const today = localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone);
+      const attendance = prefillFor(summaries[slot.id], today, slot.id);
+      if (attendance) plan.attendance = attendance;
+    }
     onStart(plan);
   }
 
```

Apply this patch to `src/ui/SetupScreen.tsx`:

```diff
diff --git a/src/ui/SetupScreen.tsx b/src/ui/SetupScreen.tsx
index 3eb5817..ae73c35 100644
--- a/src/ui/SetupScreen.tsx
+++ b/src/ui/SetupScreen.tsx
@@ -1,5 +1,5 @@
 import { gsap } from 'gsap';
-import { useEffect, useMemo, useRef, useState } from 'react';
+import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
 import { attendanceByRoster, regularsForWeekday, sortByAttendance } from '../store/attendance';
 import { useHistoryStore } from '../store/historyStore';
 import { lastSessionIds } from '../store/rosterDb';
@@ -31,6 +31,59 @@ function defaultSessionName(weekday: number): string {
   return `${WEEKDAY_NAMES[weekday]} open play`;
 }
 
+interface PickRowProps {
+  name: string;
+  /** The saved player behind the row. A friend has none. */
+  rosterId?: string;
+  checked: boolean;
+  onToggle: () => void;
+  /** A small label on the row. The checkbox keeps the plain name and is described by it. */
+  tag?: string;
+}
+
+function PickRow({ name, rosterId, checked, onToggle, tag }: PickRowProps) {
+  const tagId = useId();
+  return (
+    <li className={tag ? 'pick-wide' : undefined}>
+      <label className="pick">
+        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={tag ? name : undefined} aria-describedby={tag ? tagId : undefined} />
+        <PlayerAvatar name={name} rosterId={rosterId} size="sm" />
+        <span className="row-name">{name}</span>
+        {tag && (
+          <span id={tagId} className="tag pick-tag">
+            {tag}
+          </span>
+        )}
+      </label>
+    </li>
+  );
+}
+
+/** The saved players list. With groups above it, it gets a heading of its own. */
+function ListWrap({ grouped, children }: { grouped: boolean; children: ReactNode }) {
+  const list = (
+    <ul className="pick-grid" aria-label="Saved players">
+      {children}
+    </ul>
+  );
+  if (!grouped) return list;
+  return (
+    <section className="pick-group">
+      <h2 className="pick-group-title">Everyone else</h2>
+      {list}
+    </section>
+  );
+}
+
+function PickGroup({ title, children }: { title: string; children: ReactNode }) {
+  return (
+    <section className="pick-group">
+      <h2 className="pick-group-title">{title}</h2>
+      <ul className="pick-grid">{children}</ul>
+    </section>
+  );
+}
+
 export function SetupScreen({ onManage, plan, onBack }: Props) {
   const saved = useRosterStore((s) => s.players);
   const history = useHistoryStore((s) => s.entries);
@@ -61,7 +114,10 @@ export function SetupScreen({ onManage, plan, onBack }: Props) {
   const planLine = [plan?.venue, when].filter(Boolean).join(' · ');
 
   const [courtCount, setCourtCount] = useState(() => plan?.courts ?? getNumPref(COURTS_KEY, 2, 1, MAX_COURTS));
-  const [selected, setSelected] = useState<Set<string>>(new Set());
+  const attendance = plan?.attendance;
+  const [selected, setSelected] = useState<Set<string>>(() => new Set(attendance?.inIds ?? []));
+  // The friends ticked for tonight, by guest id. Shortcuts below never touch them.
+  const [friendsOn, setFriendsOn] = useState<Set<string>>(() => new Set(attendance?.friends.map((f) => f.id) ?? []));
   const [query, setQuery] = useState('');
   const [error, setError] = useState<string | null>(null);
   const [startError, setStartError] = useState<string | null>(null);
@@ -75,7 +131,16 @@ export function SetupScreen({ onManage, plan, onBack }: Props) {
 
   const lastIds = lastSessionIds(roster);
   const chosen = roster.filter((p) => selected.has(p.id));
-  const canStart = chosen.length >= MIN_PLAYERS;
+  // A friend with the same name as a player in the list, or as an earlier friend, would be a duplicate: the engine refuses those.
+  const seenNames = new Set(chosen.map((p) => norm(p.name)));
+  const friendPlayers: { id: string; name: string }[] = [];
+  for (const f of attendance?.friends ?? []) {
+    if (!friendsOn.has(f.id) || seenNames.has(norm(f.name))) continue;
+    seenNames.add(norm(f.name));
+    friendPlayers.push(f);
+  }
+  const total = chosen.length + friendPlayers.length;
+  const canStart = total >= MIN_PLAYERS;
   const countRef = useRef<HTMLSpanElement>(null);
   const startRef = useRef<HTMLButtonElement>(null);
   const counted = useRef<{ count: number; canStart: boolean } | null>(null);
@@ -83,18 +148,31 @@ export function SetupScreen({ onManage, plan, onBack }: Props) {
   // The count gives a small bump each time it changes, and the Start button springs when it becomes available.
   useEffect(() => {
     const before = counted.current;
-    counted.current = { count: chosen.length, canStart };
+    counted.current = { count: total, canStart };
     if (!before || !motionOK()) return;
-    if (before.count !== chosen.length && countRef.current) {
-      gsap.fromTo(countRef.current, { y: before.count < chosen.length ? 6 : -6, scale: 1.18 }, { y: 0, scale: 1, duration: MOTION.fast + 0.1, ease: MOTION.out, clearProps: 'transform' });
+    if (before.count !== total && countRef.current) {
+      gsap.fromTo(countRef.current, { y: before.count < total ? 6 : -6, scale: 1.18 }, { y: 0, scale: 1, duration: MOTION.fast + 0.1, ease: MOTION.out, clearProps: 'transform' });
     }
     if (canStart && !before.canStart && startRef.current) {
       gsap.fromTo(startRef.current, { scale: 0.94 }, { scale: 1, duration: MOTION.slow + 0.1, ease: 'back.out(2.4)', clearProps: 'transform' });
     }
-  }, [chosen.length, canStart]);
+  }, [total, canStart]);
+  // The groups the link fills in. Players the link names but this phone does not have are only counted.
+  const byId = new Map(roster.map((p) => [p.id, p]));
+  const found = (ids: string[]) => ids.flatMap((id) => byId.get(id) ?? []);
+  const saidIn = found(attendance?.inIds ?? []);
+  const maybe = found(attendance?.maybeIds ?? []);
+  const missing = (attendance?.inIds.length ?? 0) - saidIn.length;
+  const friends = attendance?.friends ?? [];
+  const grouped = saidIn.length + maybe.length + friends.length > 0;
+  const inGroup = new Set([...saidIn, ...maybe].map((p) => p.id));
+  const rest = grouped ? roster.filter((p) => !inGroup.has(p.id)) : roster;
+  const late = new Set(attendance?.lateIds ?? []);
   const typed = query.trim();
   const exact = roster.find((p) => norm(p.name) === norm(typed));
-  const shown = typed ? roster.filter((p) => norm(p.name).includes(norm(typed))) : roster;
+  const matches = (p: { name: string }) => !typed || norm(p.name).includes(norm(typed));
+  const shown = rest.filter(matches);
+  const anyMatch = roster.some(matches);
   const canAdd = typed !== '' && !exact;
 
   function toggle(id: string) {
@@ -133,13 +211,25 @@ export function SetupScreen({ onManage, plan, onBack }: Props) {
     setQuery('');
   }
 
+  function toggleFriend(id: string) {
+    setFriendsOn((prev) => {
+      const next = new Set(prev);
+      if (next.has(id)) next.delete(id);
+      else next.add(id);
+      return next;
+    });
+  }
+
   function startSession() {
     const res = start({
       name: defaultSessionName(weekday),
       mode: getDefaultMode(),
       courtCount,
       autoStart: getBoolPref(AUTO_START_KEY, false),
-      players: chosen.map((p) => ({ name: p.name, rosterId: p.id })),
+      players: [
+        ...chosen.map((p) => ({ name: p.name, rosterId: p.id, ...(late.has(p.id) ? { onBreak: true } : {}) })),
+        ...friendPlayers.map((f) => ({ name: f.name })),
+      ],
       venue: plan?.venue,
       plannedEndAt: plan?.plannedEndAt,
       weekday: plan?.weekday,
@@ -164,11 +254,36 @@ export function SetupScreen({ onManage, plan, onBack }: Props) {
       <div className="setup-head">
         <h1 className="screen-title">Who’s playing?</h1>
         <span ref={countRef} className="setup-count" aria-live="polite">
-          {chosen.length} selected
+          {total} selected
         </span>
       </div>
       {planLine && <p className="muted setup-plan">{planLine}</p>}
 
+      {missing > 0 && (
+        <p className="muted setup-note">{`${missing} who said In ${missing === 1 ? 'is' : 'are'} not saved on this phone yet.`}</p>
+      )}
+      {saidIn.length > 0 && (
+        <PickGroup title={`Said In, ${saidIn.length}`}>
+          {saidIn.map((p) => (
+            <PickRow key={p.id} name={p.name} rosterId={p.id} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} tag={late.has(p.id) ? 'Late, starts on a break' : undefined} />
+          ))}
+        </PickGroup>
+      )}
+      {maybe.length > 0 && (
+        <PickGroup title={`Maybe, ${maybe.length}`}>
+          {maybe.map((p) => (
+            <PickRow key={p.id} name={p.name} rosterId={p.id} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} />
+          ))}
+        </PickGroup>
+      )}
+      {friends.length > 0 && (
+        <PickGroup title={`Friends, ${friends.length}`}>
+          {friends.map((f) => (
+            <PickRow key={f.id} name={f.name} checked={friendsOn.has(f.id)} onToggle={() => toggleFriend(f.id)} tag="Friend, tonight only" />
+          ))}
+        </PickGroup>
+      )}
+
       <input
         className="field"
         type="text"
@@ -225,7 +340,7 @@ export function SetupScreen({ onManage, plan, onBack }: Props) {
       )}
 
       {(shown.length > 0 || canAdd) && (
-        <ul className="pick-grid" aria-label="Saved players">
+        <ListWrap grouped={grouped}>
           {canAdd && (
             <li>
               <button type="button" className="pick pick-add" onClick={submitQuery}>
@@ -234,17 +349,11 @@ export function SetupScreen({ onManage, plan, onBack }: Props) {
             </li>
           )}
           {shown.map((p) => (
-            <li key={p.id}>
-              <label className="pick">
-                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
-                <PlayerAvatar name={p.name} rosterId={p.id} size="sm" />
-                <span className="row-name">{p.name}</span>
-              </label>
-            </li>
+            <PickRow key={p.id} name={p.name} rosterId={p.id} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} />
           ))}
-        </ul>
+        </ListWrap>
       )}
-      {typed !== '' && shown.length === 0 && !canAdd && <p className="muted">No one matches.</p>}
+      {typed !== '' && !anyMatch && !canAdd && <p className="muted">No one matches.</p>}
 
       {roster.length > 0 && (
         <button type="button" className="btn btn-ghost btn-small edit-players" onClick={onManage}>
@@ -285,7 +394,7 @@ export function SetupScreen({ onManage, plan, onBack }: Props) {
             disabled={!canStart}
             onClick={startSession}
           >
-            {canStart ? `Start ${chosen.length} players` : `Pick at least ${MIN_PLAYERS}`}
+            {canStart ? `Start ${total} players` : `Pick at least ${MIN_PLAYERS}`}
           </button>
         </div>
         {startError && (
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/attendanceStart.test.tsx src/ui/setupAttendance.test.tsx src/ui/setupGroupsCss.test.ts`

Expected: it passes. Test Files `3 passed (3)`, Tests `55 passed (55)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2374 tests across 163 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/attendanceStart.test.tsx src/ui/setupAttendance.test.tsx src/ui/setupGroupsCss.test.ts src/styles/app.css src/ui/HomeScreen.tsx src/ui/SetupScreen.tsx
git commit -m "Open Who's playing pre-filled from the attendance answers"
```

---

### Task 9: Polish from the browser check

Found by looking at the screens in a browser: the copy fallback text box cut off its last line, a full-width tagged row left a gap in the two-column grid, and on a narrow phone the tag squeezed the name. Each has a test.

**Files:**
- Modify: `src/styles/app.css`
- Modify: `src/ui/AttendanceCard.tsx`
- Modify: `src/ui/attendanceReview.test.tsx`
- Modify: `src/ui/setupGroupsCss.test.ts`

- [ ] **Step 1: Write the failing tests**

Apply this patch to `src/ui/attendanceReview.test.tsx`:

```diff
diff --git a/src/ui/attendanceReview.test.tsx b/src/ui/attendanceReview.test.tsx
index b3c0ee1..e506f24 100644
--- a/src/ui/attendanceReview.test.tsx
+++ b/src/ui/attendanceReview.test.tsx
@@ -448,6 +448,26 @@ describe('the copy buttons', () => {
     expect(screen.queryByText('List copied')).not.toBeInTheDocument();
   });
 
+  it('gives the fallback box a row for every line of a long list, so nothing is cut off, up to a limit', async () => {
+    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, `Player${i}`]));
+    const inAnswers = Object.fromEntries(Object.keys(many).map((id) => [id, 'in' as const]));
+    seed({ counts: { in: 40, maybe: 0, out: 0, late: 0 }, answers: inAnswers, names: many });
+    const { user } = setup();
+    stubClipboard(vi.fn(async () => { throw new Error('denied'); }));
+    await user.click(screen.getByRole('button', { name: 'Copy list for the group chat' }));
+    expect(Number((await screen.findByLabelText('Text to copy')).getAttribute('rows'))).toBe(12);
+  });
+
+  it('sizes the fallback box to a short nudge too', async () => {
+    full();
+    const { user } = setup();
+    stubClipboard(undefined);
+    await user.click(screen.getByRole('button', { name: 'Nudge the maybes' }));
+    const rows = Number((await screen.findByLabelText('Text to copy')).getAttribute('rows'));
+    expect(rows).toBeGreaterThanOrEqual(3);
+    expect(rows).toBeLessThanOrEqual(4);
+  });
+
   it('falls back the same way for the nudge, and when there is no clipboard at all', async () => {
     full();
     const { user } = setup();
```

Apply this patch to `src/ui/setupGroupsCss.test.ts`:

```diff
diff --git a/src/ui/setupGroupsCss.test.ts b/src/ui/setupGroupsCss.test.ts
index ab4b2b8..7ff2383 100644
--- a/src/ui/setupGroupsCss.test.ts
+++ b/src/ui/setupGroupsCss.test.ts
@@ -17,7 +17,7 @@ describe('Setup group styles', () => {
   it('sit with the other Setup rules, before Home', () => {
     expect(START).toBeGreaterThan(0);
     expect(END).toBeGreaterThan(START);
-    for (const sel of ['.pick-group', '.pick-group-title', '.pick-wide', '.pick-tag']) expect(section).toContain(`${sel} {`);
+    for (const sel of ['.pick-group', '.pick-group-title', '.pick-group .pick-grid', '.pick-wide', '.pick-tag']) expect(section).toContain(`${sel} {`);
   });
 
   it('stack a group as a heading over its list', () => {
@@ -28,6 +28,10 @@ describe('Setup group styles', () => {
     expect(rule('.pick-group-title')).toMatch(/color:\s*var\(--muted\)/);
   });
 
+  it('fill the gap beside a half-width row, so a tagged row does not leave holes', () => {
+    expect(rule('.pick-group .pick-grid')).toMatch(/grid-auto-flow:\s*dense/);
+  });
+
   it('give a tagged row the whole width of the grid', () => {
     expect(rule('.pick-wide')).toMatch(/grid-column:\s*1\s*\/\s*-1/);
   });
@@ -38,6 +42,13 @@ describe('Setup group styles', () => {
     expect(rule('.pick-tag')).toMatch(/margin-left:\s*auto/);
   });
 
+  it('drops the tag under the name on a narrow phone, so the name is not cut', () => {
+    const media = /@media \(max-width: 380px\) \{([\s\S]*?)\n\}/.exec(section);
+    expect(media).not.toBeNull();
+    expect(media![1]).toMatch(/\.pick-wide \.pick \{[^}]*flex-wrap:\s*wrap/);
+    expect(media![1]).toMatch(/\.pick-wide \.pick-tag \{[^}]*flex:\s*1 0 100%/);
+  });
+
   it('let a long name shrink instead of pushing the row sideways', () => {
     expect(rule('.pick-wide .row-name')).toMatch(/min-width:\s*0/);
     expect(rule('.pick-tag')).toMatch(/min-width:\s*0/);
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/attendanceReview.test.tsx src/ui/setupGroupsCss.test.ts`

Expected: it fails. Test Files `2 failed (2)`, Tests `4 failed | 45 passed (49)`.

- [ ] **Step 3: Write the code**

Apply this patch to `src/styles/app.css`:

```diff
diff --git a/src/styles/app.css b/src/styles/app.css
index 57c0046..b1d4ee2 100644
--- a/src/styles/app.css
+++ b/src/styles/app.css
@@ -1451,6 +1451,10 @@ caption {
   gap: 8px;
 }
 
+.pick-group .pick-grid {
+  grid-auto-flow: dense;
+}
+
 .pick-group-title {
   margin: 0;
   color: var(--muted);
@@ -1480,6 +1484,22 @@ caption {
   min-width: 0;
 }
 
+/* On a narrow phone the tag drops under the name, so the name keeps its room. */
+@media (max-width: 380px) {
+  .pick-wide .pick {
+    flex-wrap: wrap;
+    padding-block: 8px;
+  }
+
+  .pick-wide .pick-tag {
+    flex: 1 0 100%;
+    margin-left: 0;
+    padding: 0 0 0 40px;
+    border: 0;
+    text-align: left;
+  }
+}
+
 /* ---------- Saved players rows ---------- */
 .saved-row {
   display: flex;
```

Apply this patch to `src/ui/AttendanceCard.tsx`:

```diff
diff --git a/src/ui/AttendanceCard.tsx b/src/ui/AttendanceCard.tsx
index a98e589..8235a51 100644
--- a/src/ui/AttendanceCard.tsx
+++ b/src/ui/AttendanceCard.tsx
@@ -31,6 +31,12 @@ function dateLabel(playDate: string): string {
   return shortDate(new Date(y, m - 1, d).getTime());
 }
 
+/** Rows for the copy box: a line per line of text, plus one for each time a long line wraps, up to a limit. */
+const MAX_ROWS = 12;
+const CHARS_PER_ROW = 28;
+const rowsFor = (text: string) =>
+  Math.min(MAX_ROWS, Math.max(3, text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / CHARS_PER_ROW)), 0)));
+
 const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
 
 function Shell({ weekday, children }: { weekday?: string; children: ReactNode }) {
@@ -305,7 +311,7 @@ export function AttendanceCard({ slot, onSignIn }: Props) {
       {copied && !copied.ok && (
         <>
           <p className="attendance-line">Could not copy. Select the text below.</p>
-          <textarea ref={copyRef} className="field attendance-text" readOnly rows={4} aria-label="Text to copy" value={copied.text} />
+          <textarea ref={copyRef} className="field attendance-text" readOnly rows={rowsFor(copied.text)} aria-label="Text to copy" value={copied.text} />
         </>
       )}
       {shared === 'copied' && (
```

- [ ] **Step 4: Run them, then the whole project**

Run: `npx vitest run src/ui/attendanceReview.test.tsx src/ui/setupGroupsCss.test.ts`

Expected: it passes. Test Files `2 passed (2)`, Tests `49 passed (49)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2378 tests across 163 files.

- [ ] **Step 5: Commit**

```bash
git add src/ui/attendanceReview.test.tsx src/ui/setupGroupsCss.test.ts src/styles/app.css src/ui/AttendanceCard.tsx
git commit -m "Polish the session flow from the browser check"
```

---

### Task 10: Cover the gaps the second break-it-on-purpose run found (screens)

Tests only, added after deliberate breaks to Tasks 7 to 9 got through. They pass on the code from Tasks 7 to 9.

**Files:**
- Modify: `src/ui/attendanceReview.test.tsx`
- Modify: `src/ui/attendanceStart.test.tsx`
- Modify: `src/ui/setupAttendance.test.tsx`

- [ ] **Step 1: Add the tests**

Apply this patch to `src/ui/attendanceReview.test.tsx`:

```diff
diff --git a/src/ui/attendanceReview.test.tsx b/src/ui/attendanceReview.test.tsx
index e506f24..1b37be3 100644
--- a/src/ui/attendanceReview.test.tsx
+++ b/src/ui/attendanceReview.test.tsx
@@ -110,6 +110,14 @@ describe('the review button on the card', () => {
     expect(screen.getByRole('button', { name: '2 new names to review' })).toBeInTheDocument();
   });
 
+  it('has the full-width review class and the 44 px button class', () => {
+    seed({ waiting: WAITING });
+    setup();
+    const button = screen.getByRole('button', { name: '2 new names to review' });
+    expect(button).toHaveClass('attendance-btn');
+    expect(button).toHaveClass('attendance-review');
+  });
+
   it('is not there when nobody is waiting, or in the cancelled and signed-out states', () => {
     seed();
     const a = setup();
```

Apply this patch to `src/ui/attendanceStart.test.tsx`:

```diff
diff --git a/src/ui/attendanceStart.test.tsx b/src/ui/attendanceStart.test.tsx
index 2984ab5..88b50e8 100644
--- a/src/ui/attendanceStart.test.tsx
+++ b/src/ui/attendanceStart.test.tsx
@@ -128,6 +128,12 @@ describe('Home hands the answers to Setup', () => {
     expect(await start()).not.toHaveProperty('attendance');
   });
 
+  it.each(['signedOut', 'linkSent', 'unknown'] as const)('adds nothing when sign-in is %s, even with a matching user and owner', async (status) => {
+    useAuthStore.setState({ status, userId: 'user-a' });
+    seed();
+    expect(await start()).not.toHaveProperty('attendance');
+  });
+
   it('adds nothing for a one-off session', async () => {
     seed();
     const onStart = vi.fn();
```

Apply this patch to `src/ui/setupAttendance.test.tsx`:

```diff
diff --git a/src/ui/setupAttendance.test.tsx b/src/ui/setupAttendance.test.tsx
index 0d987c2..a317c24 100644
--- a/src/ui/setupAttendance.test.tsx
+++ b/src/ui/setupAttendance.test.tsx
@@ -175,6 +175,13 @@ describe('Setup with a prefill: picking', () => {
     expect(screen.getByText('5 selected')).toBeInTheDocument();
   });
 
+  it('lets Start through when three players and a friend make four', async () => {
+    const user = setup(plan(prefill({ inIds: ['ana', 'ben', 'cai'], maybeIds: [] })));
+    expect(screen.getByRole('button', { name: 'Start 4 players' })).toBeEnabled();
+    await user.click(box('Rico'));
+    expect(screen.getByRole('button', { name: 'Pick at least 4' })).toBeDisabled();
+  });
+
   it('asks for four when fewer are ticked, friends included', async () => {
     const user = setup(plan(prefill()));
     await user.click(box('Ana'));
```

- [ ] **Step 2: Run them, then the whole project**

Run: `npx vitest run src/ui/attendanceReview.test.tsx src/ui/attendanceStart.test.tsx src/ui/setupAttendance.test.tsx`

Expected: it passes. Test Files `3 passed (3)`, Tests `91 passed (91)`.

Then run `npx tsc --noEmit` and `npx vitest run`. Expected: the typecheck is clean and the suite shows 2383 tests across 163 files.

- [ ] **Step 3: Commit**

```bash
git add src/ui/attendanceReview.test.tsx src/ui/attendanceStart.test.tsx src/ui/setupAttendance.test.tsx
git commit -m "Cover a gap found by the mutation check"
```

---

### Task 11: Break it on purpose, then check it for real

The tests are only worth trusting if they fail when the code is wrong. This script makes 147 deliberate breaks (66 to the engine and data layer, 77 to the screens, 4 to the two cleanups), one at a time, runs the test files that should catch each, and puts the file back. Every break must make a test fail.

**Files:** none changed (the script restores every file).

- [ ] **Step 1: Save the script**

Save this outside the project, so a break can never be committed by accident.

Create `/tmp/mutate-flow.py`:

```python
#!/usr/bin/env python3
"""Breaks the attendance session flow code on purpose, one change at a time. Every break must make a listed test fail."""
import subprocess, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
# (part, file, old text, new text, test files that must fail)
BREAKS = [
 ('A', 'src/engine/session.ts', "status: input.onBreak ? 'break' : 'active',", "status: 'active',", ['src/engine/session.test.ts', 'src/store/persistence.test.ts']),
 ('A', 'src/engine/session.ts', 'if (!input.onBreak) s.queueOrder.push(player.id);', 's.queueOrder.push(player.id);', ['src/engine/session.test.ts', 'src/store/persistence.test.ts']),
 ('A', 'src/engine/session.ts', 'if (!input.onBreak) s.queueOrder.push(player.id);', 'if (input.onBreak) s.queueOrder.push(player.id);', ['src/engine/courts.test.ts', 'src/engine/fuzz.test.ts', 'src/engine/game.test.ts', 'src/engine/pins.test.ts', 'src/engine/preview.test.ts', 'src/engine/readyCourt.test.ts', 'src/engine/readyCourts.test.ts', 'src/engine/readyStatus.test.ts', 'src/engine/session.test.ts', 'src/engine/simulation.test.ts', 'src/engine/status.test.ts', 'src/engine/swap.test.ts', 'src/store/persistence.test.ts']),
 ('A', 'src/engine/session.ts', "status: input.onBreak ? 'break' : 'active',", "status: input.onBreak ? 'active' : 'break',", ['src/engine/courts.test.ts', 'src/engine/fuzz.test.ts', 'src/engine/game.test.ts', 'src/engine/pins.test.ts', 'src/engine/preview.test.ts', 'src/engine/readyCourt.test.ts', 'src/engine/readyCourts.test.ts', 'src/engine/readyStatus.test.ts', 'src/engine/result.test.ts', 'src/engine/session.test.ts', 'src/engine/simulation.test.ts', 'src/engine/status.test.ts', 'src/engine/summary.test.ts', 'src/engine/summaryResults.test.ts', 'src/engine/swap.test.ts', 'src/store/persistence.test.ts']),
 ('A', 'src/engine/session.ts', 'gamesPlayed: lateArrivalGames(s),', 'gamesPlayed: input.onBreak ? 99 : lateArrivalGames(s),', ['src/engine/session.test.ts']),
 ('A', 'src/engine/session.ts', "p.status !== 'left' && normalize(p.name) === normalize(name)", "p.status === 'active' && normalize(p.name) === normalize(name)", ['src/engine/session.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', "'update public.attendance_guests set state = $2 where id = $1'", "'update public.attendance_guests set state = $2 where id = $1 or true'", ['src/sync/attendance/remote.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', '`setGuestState:${guestId}:${state}`', '`setGuestState:${state}:${guestId}`', ['src/sync/attendance/remote.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', "`listTonight:${slotId}:${playDate}`, slotId, playDate, 'play_tonight'", "`listTonight:${slotId}:${playDate}`, slotId, playDate, 'pending'", ['src/sync/attendance/remote.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', 'state = $3 order by created_at, id', 'state = $3 order by created_at desc, id', ['src/sync/attendance/remote.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', 'and state = $3', 'and state <> $3', ['src/sync/attendance/remote.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', "`listWaiting:${slotId}:${playDate}`, slotId, playDate, 'pending'", "`listWaiting:${slotId}:${playDate}`, slotId, playDate, 'play_tonight'", ['src/sync/attendance/remote.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/fakeRemote.ts', 'and play_date = $2::date and state = $3', 'and play_date <> $2::date and state = $3', ['src/sync/attendance/remote.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', '.update({ state })', ".update({ state: 'added' })", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', ".eq('id', guestId)", ".eq('slot_id', guestId)", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', ".eq('state', state)", ".eq('state', 'pending')", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', "listTonight: (slotId, playDate) => guestsIn(client, slotId, playDate, 'play_tonight')", "listTonight: (slotId, playDate) => guestsIn(client, slotId, playDate, 'pending')", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', "listWaiting: (slotId, playDate) => guestsIn(client, slotId, playDate, 'pending')", "listWaiting: (slotId, playDate) => guestsIn(client, slotId, playDate, 'play_tonight')", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', ".order('created_at', { ascending: true });\n  if (error) fail(error, status);\n  return (data", ".order('created_at', { ascending: false });\n  if (error) fail(error, status);\n  return (data", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', "client.from('attendance_guests').update({ state })", "client.from('attendance_answers').update({ state })", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', "    .eq('play_date', playDate)\n    .eq('state', state)", "    .eq('play_date', slotId)\n    .eq('state', state)", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/remote.ts', ".eq('id', guestId);\n      if (error) fail(error, status);", ".eq('id', guestId);", ['src/sync/attendance/remote.wire.test.ts']),
 ('A', 'src/sync/attendance/links.ts', "if (a.status === 'in' && a.late) {", 'if (a.late) {', ['src/sync/attendance/links.test.ts']),
 ('A', 'src/sync/attendance/links.ts', 'lateIds.push(a.player_id);', 'void 0;', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', '    tonight,\n    lateIds,', '    tonight: waiting,\n    lateIds,', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', '    tonight,\n    lateIds,', '    tonight,\n    lateIds: [],', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/links.ts', 'counts.late += 1;', 'counts.late += 0;', ['src/sync/attendance/links.test.ts', 'src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'const tonight = await remote.listTonight(slotId, view.play_date);', 'const tonight = await remote.listWaiting(slotId, view.play_date);', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'summarize(slotId, code!, view, waiting, tonight, now)', 'summarize(slotId, code!, view, tonight, waiting, now)', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'remote.setGuestState(guestId, state)', 'remote.setGuestState(slotId, state)', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'remote.setGuestState(guestId, state)', "remote.setGuestState(guestId, 'dismissed')", ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'x.tonight === undefined || (Array.isArray(x.tonight) && x.tonight.every(isWaitingName))', 'x.tonight === undefined || Array.isArray(x.tonight)', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', "(x.lateIds === undefined || (Array.isArray(x.lateIds) && x.lateIds.every((id) => typeof id === 'string')))", '(x.lateIds === undefined || Array.isArray(x.lateIds))', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'tonight: s.tonight ?? [], lateIds: s.lateIds ?? []', 'tonight: s.tonight ?? [], lateIds: s.lateIds', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', 'tonight: s.tonight ?? [], lateIds: s.lateIds ?? []', 'tonight: s.tonight, lateIds: s.lateIds ?? []', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', '(x.tonight === undefined ||', '(x.tonight !== undefined ||', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', '    waiting.every(isWaitingName) &&', '    waiting.length >= 0 &&', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/store.ts', "(w.broughtBy === null || typeof w.broughtBy === 'string');\nconst isText", '(w.broughtBy === null);\nconst isText', ['src/sync/attendance/store.test.ts']),
 ('A', 'src/sync/attendance/prefill.ts', 'if (!summary || summary.cancelled || summary.playDate !== today) return null;', 'if (!summary || summary.playDate !== today) return null;', ['src/sync/attendance/prefill.test.ts']),
 ('A', 'src/sync/attendance/prefill.ts', 'summary.cancelled || summary.playDate !== today', 'summary.cancelled || summary.playDate < today', ['src/sync/attendance/prefill.test.ts']),
 ('A', 'src/sync/attendance/prefill.ts', '  if (slotId !== undefined && summary.slotId !== slotId) return null;\n', '', ['src/sync/attendance/prefill.test.ts']),
 ('A', 'src/sync/attendance/prefill.ts', 'answer === status && id in summary.names', 'answer === status', ['src/sync/attendance/prefill.test.ts']),
 ('A', 'src/sync/attendance/prefill.ts', '.sort(byName)\n      .map((p) => p.id);', '.map((p) => p.id);', ['src/sync/attendance/prefill.test.ts']),
 ('A', 'src/sync/attendance/prefill.ts', 'lateIds: inIds.filter((id) => late.has(id)),', 'lateIds: [...late],', ['src/sync/attendance/prefill.test.ts']),
 ('A', 'src/sync/attendance/prefill.ts', 'friends: summary.tonight.map(', 'friends: summary.waiting.map(', ['src/sync/attendance/prefill.test.ts']),
 ('A', 'src/sync/attendance/prefill.ts', 'x < y ? -1 : x > y ? 1 :', 'x < y ? 1 : x > y ? -1 :', ['src/sync/attendance/prefill.test.ts']),
 ('A', 'src/sync/attendance/prefill.ts', 'const x = a.name.toLowerCase();', 'const x = a.name;', ['src/sync/attendance/prefill.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', "p.label).join(', ')", "p.name).join(', ')", ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', '`${p.name} (late)`', '`${p.name} late`', ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', 'late.has(p.id) ? ', '!late.has(p.id) ? ', ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', 'if (maybe.length) lines.push(', 'if (maybe.length >= 0) lines.push(', ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', 'if (friends.length) lines.push(', 'if (friends.length >= 0) lines.push(', ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', 'sorted(summary.tonight.map((g) => g.name))', 'sorted(summary.waiting.map((g) => g.name))', ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', "return lines.join('\\n');", "return lines.join('\\n') + '\\n';", ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', 'if (slot.venue?.trim()) head.push(slot.venue.trim());', 'if (slot.venue) head.push(slot.venue.trim());', ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', 'slot.startMin !== undefined || slot.endMin !== undefined) head.push', 'slot.startMin !== undefined && slot.endMin !== undefined) head.push', ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', 'const head = [titleFor(slot), dateLabel', 'const head = [weekdayName(slot.weekday), dateLabel', ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', 'for ${weekdayName(slot.weekday)}?', 'for ${weekdayName(slot.weekday + 1)}?', ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', "${names.slice(0, -1).join(', ')} and ${", "${names.slice(0, -1).join(', ')}, and ${", ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', "  if (names.length === 0) return '';\n", '', ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', 'answer === status && id in summary.names', 'answer === status', ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/copy.ts', '(a.toLowerCase() < b.toLowerCase() ? -1 :', '(a < b ? -1 :', ['src/sync/attendance/copy.test.ts']),
 ('A', 'src/sync/attendance/nameMatch.ts', 'roster.find((p) => norm(p.name) === key)', 'roster.find((p) => p.name === name)', ['src/sync/attendance/nameMatch.test.ts']),
 ('A', 'src/sync/attendance/nameMatch.ts', "return likely ? { kind: 'likely', player: likely }", "return likely ? { kind: 'exact', player: likely }", ['src/sync/attendance/nameMatch.test.ts']),
 ('A', 'src/sync/attendance/nameMatch.ts', "if (exact) return { kind: 'exact', player: exact };", "if (exact) return { kind: 'likely', player: exact };", ['src/sync/attendance/nameMatch.test.ts']),
 ('A', 'src/sync/attendance/nameMatch.ts', 'firstWord(p.name) === first', 'first.startsWith(firstWord(p.name))', ['src/sync/attendance/nameMatch.test.ts']),
 ('B', 'src/ui/AttendanceSheets.tsx', "'New name, asked to join'", "'New name'", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', '`Friend of ${sponsor}`', '`Friend ${sponsor}`', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', "'Friend')", "'Friend of a member')", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', "{match.kind === 'exact' && <p", "{match.kind === 'none' && <p", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', '`Already saved as ${match.player?.name}.`', '`Saved as ${match.player?.name}.`', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', '`Could be ${match.player?.name}, who is already saved.`', '`Could be ${match.player?.name}.`', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', "{match.kind === 'exact' ? 'Mark as done' : 'Add to roster'}", "{match.kind === 'exact' ? 'Add to roster' : 'Mark as done'}", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', '{friend && (', '{!friend && (', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', "mark(guest, 'play_tonight')", "mark(guest, 'added')", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', "mark(guest, 'dismissed')", "mark(guest, 'play_tonight')", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', "return mark(guest, 'added');", "return mark(guest, 'dismissed');", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'await useRosterStore.getState().add(guest.name);', "await useRosterStore.getState().add(guest.name + 'x');", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'await useRosterStore.getState().add(guest.name);', 'void guest.name;', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', ": 'Could not add that player.';", ": 'Something went wrong.';", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'return result.ok ? null : result.message;', 'return null;', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'const disabled = working === guest.id;', 'const disabled = false;', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'const disabled = working === guest.id;', 'const disabled = working !== null;', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', '    setError(null);\n    setWorking(guest.id);', '    setWorking(guest.id);', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', "Added players are saved to your roster. Tick them in Who's playing.", 'Added players are saved to your roster.', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'title={`${waiting.length} to review`}', 'title={`${waiting.length + 1} to review`}', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'if (waiting.length === 0) onEmptyRef.current();', 'if (waiting.length === 1) onEmptyRef.current();', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', '<p className="error" role="alert">\n          {error}\n        </p>\n      )}\n      <p className="muted">Added', '<p className="error" role="status">\n          {error}\n        </p>\n      )}\n      <p className="muted">Added', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', '<p className="review-name">', '<p className="review-title">', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceSheets.tsx', 'const roster = useRosterStore((s) => s.players);', 'const roster: never[] = [];', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', '{nudge && (', '{(nudge || true) && (', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'setCopied({ kind, ok: true, text });', 'setCopied({ kind, ok: false, text });', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "{copied.kind === 'list' ? 'List copied' : 'Message copied'}", "{copied.kind === 'list' ? 'Message copied' : 'List copied'}", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'Could not copy. Select the text below.', 'Could not copy.', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'className="field attendance-text" readOnly rows', 'className="field attendance-text" rows', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'copyRef.current?.select();', 'copyRef.current?.focus();', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "void copy('list', listText(slot, summary))", "void copy('list', nudgeText(slot, summary))", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "void copy('nudge', nudge)", "void copy('nudge', listText(slot, summary))", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', '{reviewed && waiting.length === 0 && (', '{waiting.length === 0 && (', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', '    setShared(null);\n    setReviewed(false);', '    setReviewed(false);', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', '    setShared(null);\n    setCopied(null);', '    setShared(null);', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'const CHARS_PER_ROW = 28;', 'const CHARS_PER_ROW = 1000;', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'const MAX_ROWS = 12;', 'const MAX_ROWS = 50;', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'className="btn attendance-btn attendance-review"', 'className="btn attendance-review"', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "setSheet('review');", "setSheet('reset');", ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'slotId={slot.id} waiting', 'slotId="x" waiting', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', 'names={summary.names}', 'names={{}}', ['src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/AttendanceCard.tsx', "plural(waiting.length, 'new name', 'new names')", "plural(waiting.length, 'new names', 'new name')", ['src/ui/AttendanceCard.test.tsx', 'src/ui/attendanceReview.test.tsx']),
 ('B', 'src/ui/HomeScreen.tsx', "status === 'signedIn' && userId !== null && ownerId === userId", "status === 'signedIn' && userId !== null", ['src/ui/attendanceStart.test.tsx']),
 ('B', 'src/ui/HomeScreen.tsx', "status === 'signedIn' && userId !== null && ownerId === userId", 'userId !== null && ownerId === userId', ['src/ui/attendanceStart.test.tsx']),
 ('B', 'src/ui/HomeScreen.tsx', 'prefillFor(summaries[slot.id], today, slot.id)', 'prefillFor(summaries[slot.id], today)', ['src/ui/attendanceStart.test.tsx']),
 ('B', 'src/ui/HomeScreen.tsx', 'Intl.DateTimeFormat().resolvedOptions().timeZone', "'UTC'", ['src/ui/attendanceStart.test.tsx']),
 ('B', 'src/ui/HomeScreen.tsx', 'if (attendance) plan.attendance = attendance;', 'if (attendance) void attendance;', ['src/ui/attendanceStart.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', 'useState<Set<string>>(() => new Set(attendance?.inIds ?? []))', 'useState<Set<string>>(() => new Set())', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', 'new Set(attendance?.friends.map((f) => f.id) ?? [])', 'new Set()', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', '!friendsOn.has(f.id) || seenNames.has(norm(f.name))', '!friendsOn.has(f.id)', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', '    seenNames.add(norm(f.name));\n', '', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', 'const total = chosen.length + friendPlayers.length;', 'const total = chosen.length;', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', 'late.has(p.id) ? { onBreak: true } : {}', '{}', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', '...friendPlayers.map((f) => ({ name: f.name })),', '...friendPlayers.map((f) => ({ name: f.name, rosterId: f.id })),', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', "'Late, starts on a break'", "'Late'", ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', 'tag="Friend, tonight only"', 'tag="Friend"', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', '`Said In, ${saidIn.length}`', '`Said In, ${attendance?.inIds.length}`', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', '`Maybe, ${maybe.length}`', '`Maybe ${maybe.length}`', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', '`Friends, ${friends.length}`', '`Friends`', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', 'const rest = grouped ? roster.filter((p) => !inGroup.has(p.id)) : roster;', 'const rest = roster;', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', "missing === 1 ? 'is' : 'are'", "missing === 1 ? 'are' : 'is'", ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', 'const missing = (attendance?.inIds.length ?? 0) - saidIn.length;', 'const missing = 0;', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', '!anyMatch && !canAdd', 'shown.length === 0 && !canAdd', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', '<h2 className="pick-group-title">Everyone else</h2>', '<h2 className="pick-group-title">Others</h2>', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', '{missing > 0 && (', '{missing > 1 && (', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', 'const canStart = total >= MIN_PLAYERS;', 'const canStart = chosen.length >= MIN_PLAYERS;', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', 'aria-describedby={tag ? tagId : undefined}', 'aria-describedby={undefined}', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/ui/SetupScreen.tsx', 'onToggle={() => toggleFriend(f.id)}', 'onToggle={() => toggle(f.id)}', ['src/ui/setupAttendance.test.tsx']),
 ('B', 'src/styles/app.css', '.pick-wide {\n  grid-column: 1 / -1;', '.pick-wide {\n  grid-column: auto;', ['src/ui/setupGroupsCss.test.ts']),
 ('B', 'src/styles/app.css', '  grid-auto-flow: dense;', '  grid-auto-flow: row;', ['src/ui/setupGroupsCss.test.ts']),
 ('B', 'src/styles/app.css', '.attendance-text {\n  font-size: 16px;', '.attendance-text {\n  font-size: 14px;', ['src/ui/attendanceCss.test.ts']),
 ('B', 'src/styles/app.css', '.review-actions {\n  display: flex;\n  flex-wrap: wrap;', '.review-actions {\n  display: flex;\n  flex-wrap: nowrap;', ['src/ui/attendanceCss.test.ts']),
 ('B', 'src/styles/app.css', '.attendance-review {\n  width: 100%;', '.attendance-review {\n  width: auto;', ['src/ui/attendanceCss.test.ts']),
 ('B', 'src/styles/app.css', '.review-name {\n  font-size: 16px;\n  font-weight: 700;\n  overflow-wrap: anywhere;', '.review-name {\n  font-size: 16px;\n  font-weight: 700;', ['src/ui/attendanceCss.test.ts']),
 ('B', 'src/styles/app.css', '    flex: 1 0 100%;', '    flex: 0 0 auto;', ['src/ui/setupGroupsCss.test.ts']),
 ('B', 'src/styles/app.css', '.pick-group-title {\n  margin: 0;\n  color: var(--muted);', '.pick-group-title {\n  margin: 0;\n  color: var(--ink);', ['src/ui/setupGroupsCss.test.ts']),
 ('B', 'src/styles/app.css', '.review-row {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  padding: 10px 12px;\n  border: 1px solid var(--line);', '.review-row {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  padding: 10px 12px;\n  border: 1px solid #ccc;', ['src/ui/attendanceCss.test.ts']),
 ('C', 'src/styles/app.css', '  min-height: min-content;\n  overflow: hidden;', '  min-height: 0;\n  overflow: hidden;', ['src/ui/homeShortCss.test.ts']),
 ('C', 'src/styles/app.css', '  overflow-y: auto;\n  overscroll-behavior: contain;', '  overflow-y: visible;\n  overscroll-behavior: contain;', ['src/ui/homeShortCss.test.ts']),
 ('C', 'src/ui/AttendanceCard.tsx', "if (status === 'unconfigured' || status === 'loading') return null;", "if (status === 'unconfigured') return null;", ['src/ui/AttendanceCard.test.tsx']),
 ('C', 'src/ui/useAttendance.ts', 'const active = signedIn;', 'const active = true;', ['src/ui/useAttendance.test.tsx']),
]

import os
originals = {}
survived, broken, killed = [], [], 0
try:
    for n, (part, path, old, new, tests) in enumerate(BREAKS, 1):
        full = os.path.join(ROOT, path)
        if path not in originals:
            originals[path] = open(full).read()
        text = originals[path]
        if text.count(old) != 1:
            broken.append((n, path, text.count(old)))
            continue
        open(full, 'w').write(text.replace(old, new))
        try:
            r = subprocess.run(['npx', 'vitest', 'run'] + tests, cwd=ROOT, capture_output=True, text=True)
        finally:
            open(full, 'w').write(text)
        if r.returncode != 0:
            killed += 1
        else:
            survived.append((n, path, old[:50]))
        print(n, 'killed' if r.returncode != 0 else 'SURVIVED', path, flush=True)
finally:
    for path, text in originals.items():
        open(os.path.join(ROOT, path), 'w').write(text)

print(f'\n{killed} of {len(BREAKS)} killed; survived: {survived}; entries that did not match exactly once: {broken}')
sys.exit(1 if survived or broken else 0)
```

- [ ] **Step 2: Run it**

Run: `python3 /tmp/mutate-flow.py .`

Expected, last line: `147 of 147 killed; survived: []; entries that did not match exactly once: []`

If a break survives, a test is missing: add the test, do not change the break. Afterwards run `git status --short` and expect nothing, because the script restores every file.

- [ ] **Step 3: Check it for real, on two phones**

The tests ran on an in-memory Postgres and a stub of the network. After this ships, on the organizer's phone (open the app and tap "Reload now" if the update banner shows, because an old service worker keeps the old app until you do):

1. Settings has no "Attendance link (preview)" row. Home shows the attendance card under the slot card, and on a short phone the slot card's chips are all visible and Home scrolls.
2. On a second phone or a private tab, open the link and, with a few different names, answer In, Maybe, "I'll arrive late", Bring a friend (type a name) and Ask to join (type a name).
3. On the organizer's phone the card shows the counts and "N new names to review". Tap it. Try "Play tonight" on the friend, "Add to roster" on the new member, and "Dismiss" on a spare name. A name that is already saved should say "Already saved as ...".
4. Tap "Copy list for the group chat" and paste it into any chat: it should read as the list (In with "(late)", Maybe, Friends). Tap "Nudge the maybes" and paste: "Ben, Ian and Kai, are you in for Tuesday?".
5. On the day of the session, tap Start on the slot. Who's playing opens with the "Said In" people ticked, the late one tagged "Late, starts on a break", the maybes unticked, and the friend in "Friends". Tick one maybe, then Start.
6. In the live screen the late player is under "On break" in the waiting sheet and not on a court. Tap them and choose "Return to play": they join the queue.
7. Start a session from the same slot on another day: Who's playing opens as it always did, with no groups.

Seen in the dev check (390 by 844 and 320 by 568, light and dark, with an in-memory remote): no sideways scroll, nothing outside the screen, no tap target under 44 px, no field under 16 px. After Start, the late player had status break, was not on a court, the friend had no roster id, and the courts filled with the other players. Not seen: a real phone, a real clipboard, or the real network.

- [ ] **Step 4: Nothing is pushed by this plan**

Shipping is a fast-forward of production after the owner says so. The plan changes no database, so there is no migration to apply. Removing the preview switch makes the attendance card visible to every signed-in organizer, so ship it after the two-phone check of the member page.

---

## Self-review

- **Spec coverage.** Audit findings O3 (late players start on a break), O4 (new names and friends are requests, reviewed before they touch the roster), P2 (friends), the "Who's playing, pre-filled" screen of the sketch, the review screen, Copy list, and the nudge to the maybes are built. The two cleanups close the short-phone clipping and remove the preview switch.
- **Not built, on purpose.** Marking the organizer In; photos; a late state for friends; auto-ticking a friend who was added to the roster; the member screen for after play starts; hiding Out answers from the database view.
- **Placeholders.** None. Every file is complete and every step has its command and expected result.
- **Names.** Types, store actions and component props match across tasks because every task is a proven commit.
- **Known limits.** The prefill only applies when the answers are for today's date on the device, so a session started early or late for another date opens as before. Who's playing now has more groups, so on a long list it scrolls. The Copy list format is a default I chose. A friend cannot be marked late. On a 320 px phone the Setup tiles cut long names, as they already did. The card is now taller (the two copy buttons each take a row on a 390 px phone). The clipboard was tested with a stub, not a real iOS Safari. Nothing has run against the real Supabase from these screens.
