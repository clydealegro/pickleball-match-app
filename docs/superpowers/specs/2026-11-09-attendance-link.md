# Attendance link

Design for replacing the "who is coming" list in the club group chat with one permanent link. Decided 9 Nov 2026.
The pictures are in `docs/superpowers/sketches/attendance-v2.png` (source: `attendance-v2.html`, eight screens).

## The problem

The organizer posts a list in the group chat the day before. Members reply, and someone copies the list, edits it and
posts it again. The list lives in a message that has to be re-posted, so every reply makes a new version and two replies at
once make a conflict. The chat is good for talking and bad as a database.

## The idea

Put **one link** in the chat, once. The app holds the list. The link always shows the next session of that slot, so it is
never re-posted. Members tap their name, then In, Maybe or Out. The organizer sees the answers on Home, and Who's playing
opens already filled in.

## Decisions

| # | Decision | Who decided |
|---|---|---|
| 1 | One permanent link per weekly slot | Clyde, 9 Nov 2026 |
| 2 | Maybe is included, and it only pre-fills. It never locks anything. Answers stay open until play starts | Clyde (Maybe), default (cutoff) |
| 3 | No cap on how many can say In. The member sees a quiet heads-up when more people are in than the courts hold | Clyde, 9 Nov 2026 |
| 4 | No login for members. They tap their name, and the phone remembers it | Design |
| 5 | The link carries a random code (24 hex characters, 96 bits), so it cannot be guessed. "Reset link" makes a new one and keeps the answers | Audit, 9 Nov 2026 |
| 6 | Members see In as faces and Maybe as a count | Design (audit P4), open to change |
| 7 | New names and friends are requests, never roster rows, until the organizer approves them | Audit O4 and P2 |

## What each screen is for

1. **First visit.** The roster as first names and photos. Tap your own name. Not on the list: ask to join.
2. **Member answers.** In, Maybe, Out. An "I'll arrive late" chip, "Bring a friend", "Not Ana?", a confirmation that names the date, an optional "answer by" note, Add to calendar.
3. **Organizer Home card.** Counts (in, maybe, out, friends), "Updated 4:12 pm", the latest change, a badge for names to review, Start with N, Copy list for the group chat, and the link with Share, Reset link and Cancel this week.
4. **Who's playing, pre-filled.** In is ticked. Maybe is listed unticked. Out is hidden. Late players start on a break. Friends have their own group.
5. **Member, after play starts.** The answers are closed. Later this page becomes the live view.
6. **Member, no play this week.** The reason and the next date.
7. **Organizer, review.** Approve a new name, merge it with an existing player, or dismiss it. A friend can play tonight only.
8. **Organizer, cancel this week.** A reason, and an undo.

## The audit, and where each finding is handled

Run on 9 Nov 2026 against the code (Ralph loop, two rounds). "Plan 1" is built and proven.

| Finding | Handled in |
|---|---|
| O1 Weak signal at the venue: cache the list, show "Updated" | Plan 2 |
| O2 Slots live only on the device, so the link needs a server copy | Plan 1 (the link row holds the slot's weekday, times, venue and courts) and Plan 2 (writing it) |
| O3 Late players start on a break (the engine has a break status) | Plan 4 |
| O4 New names are requests, not roster rows | Plan 1 (waiting names table), Plan 4 (review screen) |
| O5 Cancel this week | Plan 1 (table and rule), Plan 2 (organizer sheet), Plan 3 (member screen) |
| O6 The link rolls to next week when the session ends or the planned end passes | Plan 1 (`attendance_play_date`, `closed_through`), Plan 2 (setting `closed_through` on Done) |
| O7 Show last-minute changes on Home | Plan 2 |
| O8 The "Copy list" text must match the format the club uses today | Plan 4, needs one real message from the organizer |
| O9 The busy heads-up uses the slot's courts (slots already store them) | Plan 1 (courts on the link), Plan 3 |
| O10 The organizer is pre-marked In | Plan 2 |
| P1 Not Ana? | Plan 3 |
| P2 Bring a friend | Plan 1 (guests with `brought_by`), Plan 3, Plan 4 |
| P3 Maybe tiles at full strength (faded tiles measured 2.54 to 3.02:1, 4.5:1 needed) | Plan 3 |
| P4 Maybe as a count | Plan 3 |
| P5 States for play started and cancelled | Plan 3 |
| P6 Optional "answer by" note, display only | Plan 3 |
| P7 Confirmation after tapping | Plan 3 |

Delight, in order: one link all day (answers before play, find my name during, recap after), Add to calendar, a copy
button that nudges the maybes, a friendly busy meter. Later: a streak line (needs history synced first) and a rich link
preview in chat apps (not verified, previews may be cached).

## Data model (built in Plan 1)

- `attendance_links`: one row per organizer and slot. Holds the code, title, weekday, start and end minutes, venue, courts, a time zone (default `Asia/Manila`) and `closed_through`.
- `attendance_answers`: one row per link, date and player. Status `in`, `maybe` or `out`, and `late` (only with `in`).
- `attendance_guests`: a name waiting for the organizer. `brought_by` is set for a friend and empty for a new member asking to join. At most 20 wait per date.
- `attendance_cancellations`: one row per link and date, with an optional reason up to 140 characters.

Which date a link is about: the first date on the slot's weekday that is not over. It is today until the planned end passes
in the link's own time zone, and it skips any date up to `closed_through`.

## Privacy and abuse

- Anyone with the link can read first names, a last initial, whether a photo exists, and the answers. Never a full name, an owner id or an email. The answers are what the group chat list shows today.
- The view the database returns includes every member's answer, Out included, next to the player list. The member page never shows Out answers, but anyone who calls the function directly with the link's code can read them. That is the same information the group chat list shows today. Hiding Out from the data itself would be a small database change if it is ever wanted.
- Visitors have no access to any table. Three functions are the only way in: view, answer, and add a guest. Each takes the code.
- Anyone with the link can answer as anyone. That is a trust model for a friendly club. The confirmation, the organizer's "latest change" line and Reset link are the safeguards.
- Spam is bounded: 20 waiting names per date, and every name is 1 to 40 characters.
- "Delete all my data" removes the links, answers, waiting names and cancellations too: the existing `delete_my_players()` now deletes the caller's links, and the rest cascades.

## The four plans

| Plan | What | State |
|---|---|---|
| 1 | The database: tables, rules, three public functions, tests | Built and proven. `docs/superpowers/plans/2026-11-09-attendance-link-database.md` |
| 2 | The organizer side: write the link from the slot, Reset, Cancel this week, close the date when a session ends, read answers and names, the Home card with an offline copy. It was hidden behind a Settings switch until the member page was live; Plan 4 removes the switch | Shipped 9 Nov 2026 (behind the preview switch, off by default). The switch is removed in Plan 4. `docs/superpowers/plans/2026-11-09-attendance-link-organizer.md` |
| 3 | The public page at a hash link, `/#/j/<code>` (a path link would 404 and break the relative asset paths, and the part after `#` never reaches server logs): member screens 1, 2 and 6, remembered pick, polling, an offline copy, Add to calendar. Not in it: screen 5, the "answer by" note, photos. The preview switch stayed until the page was checked on the real project | Shipped 9 Nov 2026 (`2198ad9`). `docs/superpowers/plans/2026-11-09-attendance-link-member.md` |
| 4 | The session flow: Who's playing pre-filled from the answers, late players on a break, the review screen for new names and friends, Copy list, nudge the maybes. Also removes the preview switch and stops the slot card clipping on a short phone | Built and proven, not yet shipped. `docs/superpowers/plans/2026-11-09-attendance-link-flow.md` |

## Open items

- **No sample list message is needed** (decided 9 Nov 2026). Copy list uses a default format: the title and date, `In (n): names` with "(late)", `Maybe (n): names`, `Friends (n): names`. It is a one-line change if the wording should differ.
- **Photos on the public page.** Photos sit in a private storage bucket. The public page needs a safe way to show them, most likely a small function that checks the code and hands out a short-lived address. Decided when Plan 3 starts. Until then the page shows initials.
- **Applying the migration to the real Supabase project** (`pikl`). The tests run on an in-memory stand-in, as for the other migrations. The real project needs the migration applied and the security advisor read. That is outward-facing, so it waits for the organizer's yes.
- **Time zone.** Every link uses `Asia/Manila` for now. A setting comes later if a club needs another.

## Known limits

- After Plan 2 the organizer can manage a link, but only behind the preview switch, and members cannot open it until Plan 3. A slot edit that cannot reach the link (offline) is not retried until the slot is saved again.
- Plan 1 was database only.
- The three public functions will show in the security advisor as callable by anyone. That is the intent, and it is the reason each one is narrow.
- The database tests prove the rules on an in-memory Postgres. They have not run against the real project.
