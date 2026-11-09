-- Attendance link: one permanent link per weekly slot. Members open it without an account, say In, Maybe or Out,
-- and the organizer sees the answers. Anyone with the link can read first names and answer, and nothing else:
-- the tables below are closed to anonymous visitors, and three locked-down functions are the only way in.
-- The link carries a random code, so it cannot be guessed, and "Reset link" makes a new one.

-- A random 24 character code (96 bits). gen_random_uuid() is cryptographically random; only the first 12 characters
-- of each uuid are used, which skips the fixed version digit.
create function public.new_attendance_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
      || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
$$;

-- Used as a column default, so it runs with the signed-in organizer's rights.
revoke execute on function public.new_attendance_code() from public, anon;
grant execute on function public.new_attendance_code() to authenticated;

create table public.attendance_links (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The device's slot id, such as 'tue'. Slots are still saved on the device; this is a copy of what the link shows.
  slot_id text not null check (slot_id ~ '^[a-z0-9-]{1,40}$'),
  code text not null default public.new_attendance_code() check (length(code) >= 16),
  title text not null check (btrim(title) <> '' and length(title) <= 60),
  -- 0 is Sunday, 6 is Saturday, the same as the app.
  weekday smallint not null check (weekday between 0 and 6),
  start_min integer check (start_min between 0 and 1439),
  end_min integer check (end_min between 0 and 1439),
  venue text check (length(venue) <= 40),
  courts smallint check (courts between 1 and 12),
  timezone text not null default 'Asia/Manila' check (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$'),
  -- Set when the organizer finishes a session: the link then shows the next date after it.
  closed_through date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, slot_id),
  unique (code)
);

create table public.attendance_answers (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot_id text not null,
  play_date date not null,
  player_id uuid not null,
  status text not null check (status in ('in', 'maybe', 'out')),
  late boolean not null default false check (not late or status = 'in'),
  updated_at timestamptz not null default now(),
  primary key (owner_id, slot_id, play_date, player_id),
  foreign key (owner_id, slot_id) references public.attendance_links (owner_id, slot_id) on delete cascade,
  -- Purging the roster (delete_my_players) removes the answers too.
  foreign key (owner_id, player_id) references public.players (owner_id, id) on delete cascade
);

-- A name nobody has approved yet: a new member asking to join, or a friend a member is bringing.
-- Nothing here touches the roster until the organizer acts.
create table public.attendance_guests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot_id text not null,
  play_date date not null,
  name text not null check (btrim(name) <> '' and length(name) <= 40),
  -- Set for a friend someone is bringing, empty for a new member asking to join.
  brought_by uuid,
  state text not null default 'pending' check (state in ('pending', 'play_tonight', 'added', 'dismissed')),
  created_at timestamptz not null default now(),
  foreign key (owner_id, slot_id) references public.attendance_links (owner_id, slot_id) on delete cascade,
  foreign key (owner_id, brought_by) references public.players (owner_id, id) on delete cascade
);

create index attendance_guests_by_date on public.attendance_guests (owner_id, slot_id, play_date);

create table public.attendance_cancellations (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot_id text not null,
  play_date date not null,
  reason text check (length(reason) <= 140),
  created_at timestamptz not null default now(),
  primary key (owner_id, slot_id, play_date),
  foreign key (owner_id, slot_id) references public.attendance_links (owner_id, slot_id) on delete cascade
);

create trigger attendance_links_set_updated_at
  before insert or update on public.attendance_links
  for each row execute function public.set_updated_at();

create trigger attendance_answers_set_updated_at
  before insert or update on public.attendance_answers
  for each row execute function public.set_updated_at();

alter table public.attendance_links enable row level security;
alter table public.attendance_answers enable row level security;
alter table public.attendance_guests enable row level security;
alter table public.attendance_cancellations enable row level security;

-- Each organizer sees and changes only their own rows.
create policy attendance_links_select_own on public.attendance_links
  for select to authenticated using (owner_id = (select auth.uid()));
create policy attendance_links_insert_own on public.attendance_links
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy attendance_links_update_own on public.attendance_links
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy attendance_answers_select_own on public.attendance_answers
  for select to authenticated using (owner_id = (select auth.uid()));
create policy attendance_answers_insert_own on public.attendance_answers
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy attendance_answers_update_own on public.attendance_answers
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy attendance_guests_select_own on public.attendance_guests
  for select to authenticated using (owner_id = (select auth.uid()));
create policy attendance_guests_update_own on public.attendance_guests
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy attendance_cancellations_select_own on public.attendance_cancellations
  for select to authenticated using (owner_id = (select auth.uid()));
create policy attendance_cancellations_insert_own on public.attendance_cancellations
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy attendance_cancellations_delete_own on public.attendance_cancellations
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Take back Supabase's default grants and give only what is needed. Anonymous visitors get no table access at all.
revoke all on public.attendance_links, public.attendance_answers, public.attendance_guests, public.attendance_cancellations
  from anon, authenticated;
grant select, insert, update on public.attendance_links to authenticated;
grant select, insert, update on public.attendance_answers to authenticated;
grant select, update on public.attendance_guests to authenticated;
grant select, insert, delete on public.attendance_cancellations to authenticated;

-- The date a link is about: the first date on the slot's weekday that is not over yet.
-- It is today until the planned end time passes (in the link's own time zone), and it skips any date the organizer
-- has already closed. Called only by the functions below.
create function public.attendance_play_date(
  p_weekday smallint, p_closed_through date, p_tz text, p_end_min integer, p_now timestamptz
)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  local_now timestamp := p_now at time zone p_tz;
  first_day date := local_now::date;
begin
  if p_end_min is not null
     and (extract(hour from local_now)::integer * 60 + extract(minute from local_now)::integer) >= p_end_min then
    first_day := first_day + 1;
  end if;
  if p_closed_through is not null and p_closed_through >= first_day then
    first_day := p_closed_through + 1;
  end if;
  return first_day + ((p_weekday - extract(dow from first_day)::integer + 7) % 7);
end;
$$;

revoke execute on function public.attendance_play_date(smallint, date, text, integer, timestamptz)
  from public, anon, authenticated;

-- What the public page shows. First names and a last initial only, never a full name, an owner id or an email.
create function public.attendance_view(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.attendance_links;
  the_date date;
begin
  select * into l from public.attendance_links where code = p_code;
  if not found then
    return null;
  end if;
  the_date := public.attendance_play_date(l.weekday, l.closed_through, l.timezone, l.end_min, now());
  return jsonb_build_object(
    'title', l.title,
    'weekday', l.weekday,
    'venue', l.venue,
    'start_min', l.start_min,
    'end_min', l.end_min,
    'courts', l.courts,
    'play_date', the_date,
    'cancelled', (
      select jsonb_build_object('reason', c.reason)
      from public.attendance_cancellations c
      where c.owner_id = l.owner_id and c.slot_id = l.slot_id and c.play_date = the_date
    ),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'first_name', split_part(btrim(p.name), ' ', 1),
        'last_initial', nullif(upper(left(btrim(substr(btrim(p.name), length(split_part(btrim(p.name), ' ', 1)) + 1)), 1)), ''),
        'has_photo', p.photo_version > 0,
        'photo_seq', p.photo_seq
      ) order by lower(p.name)), '[]'::jsonb)
      from public.players p
      where p.owner_id = l.owner_id and p.deleted_at is null
    ),
    'answers', (
      select coalesce(jsonb_agg(jsonb_build_object('player_id', a.player_id, 'status', a.status, 'late', a.late)), '[]'::jsonb)
      from public.attendance_answers a
      where a.owner_id = l.owner_id and a.slot_id = l.slot_id and a.play_date = the_date
    ),
    'friends', (
      select count(*)
      from public.attendance_guests g
      where g.owner_id = l.owner_id and g.slot_id = l.slot_id and g.play_date = the_date
        and g.brought_by is not null and g.state <> 'dismissed'
    )
  );
end;
$$;

-- Records one member's answer for the link's current date. Changing your mind replaces the answer.
create function public.attendance_answer(p_code text, p_player_id uuid, p_status text, p_late boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l public.attendance_links;
  the_date date;
  is_late boolean := coalesce(p_late, false) and p_status = 'in';
begin
  if p_status is null or p_status not in ('in', 'maybe', 'out') then
    raise exception 'bad_status';
  end if;
  select * into l from public.attendance_links where code = p_code;
  if not found then
    raise exception 'unknown_link';
  end if;
  the_date := public.attendance_play_date(l.weekday, l.closed_through, l.timezone, l.end_min, now());
  if exists (
    select 1 from public.attendance_cancellations c
    where c.owner_id = l.owner_id and c.slot_id = l.slot_id and c.play_date = the_date
  ) then
    raise exception 'cancelled';
  end if;
  if not exists (
    select 1 from public.players p
    where p.owner_id = l.owner_id and p.id = p_player_id and p.deleted_at is null
  ) then
    raise exception 'unknown_player';
  end if;
  insert into public.attendance_answers (owner_id, slot_id, play_date, player_id, status, late)
  values (l.owner_id, l.slot_id, the_date, p_player_id, p_status, is_late)
  on conflict (owner_id, slot_id, play_date, player_id)
  do update set status = excluded.status, late = excluded.late;
  return jsonb_build_object('play_date', the_date, 'status', p_status, 'late', is_late);
end;
$$;

-- A new member asking to join, or a friend a member brings. It waits for the organizer; at most 20 wait per date.
create function public.attendance_add_guest(p_code text, p_name text, p_brought_by uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l public.attendance_links;
  the_date date;
  clean text := btrim(coalesce(p_name, ''));
  new_id uuid;
begin
  if clean = '' or length(clean) > 40 then
    raise exception 'bad_name';
  end if;
  select * into l from public.attendance_links where code = p_code;
  if not found then
    raise exception 'unknown_link';
  end if;
  the_date := public.attendance_play_date(l.weekday, l.closed_through, l.timezone, l.end_min, now());
  if exists (
    select 1 from public.attendance_cancellations c
    where c.owner_id = l.owner_id and c.slot_id = l.slot_id and c.play_date = the_date
  ) then
    raise exception 'cancelled';
  end if;
  if p_brought_by is not null and not exists (
    select 1 from public.players p
    where p.owner_id = l.owner_id and p.id = p_brought_by and p.deleted_at is null
  ) then
    raise exception 'unknown_player';
  end if;
  if (
    select count(*) from public.attendance_guests g
    where g.owner_id = l.owner_id and g.slot_id = l.slot_id and g.play_date = the_date and g.state = 'pending'
  ) >= 20 then
    raise exception 'too_many';
  end if;
  insert into public.attendance_guests (owner_id, slot_id, play_date, name, brought_by)
  values (l.owner_id, l.slot_id, the_date, clean, p_brought_by)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'play_date', the_date);
end;
$$;

revoke execute on function public.attendance_view(text) from public;
revoke execute on function public.attendance_answer(text, uuid, text, boolean) from public;
revoke execute on function public.attendance_add_guest(text, text, uuid) from public;
grant execute on function public.attendance_view(text) to anon, authenticated;
grant execute on function public.attendance_answer(text, uuid, text, boolean) to anon, authenticated;
grant execute on function public.attendance_add_guest(text, text, uuid) to anon, authenticated;

-- "Reset link": a new code for one of the caller's own slots. The old code stops working at once; answers are kept.
-- It runs with the caller's rights, so the row-level rules decide whose slot it is.
create function public.reset_attendance_link(p_slot_id text)
returns text
language sql
volatile
set search_path = ''
as $$
  update public.attendance_links
  set code = public.new_attendance_code()
  where slot_id = p_slot_id
  returning code;
$$;

revoke execute on function public.reset_attendance_link(text) from public, anon;
grant execute on function public.reset_attendance_link(text) to authenticated;

-- "Delete all my data" must reach the attendance data too. A name waiting to join has no player to cascade from, and
-- organizers cannot delete links themselves, so the existing purge now removes the caller's links as well.
-- Deleting a link removes its answers, waiting names and cancellations. It returns the same count as before: players.
create or replace function public.delete_my_players()
returns integer
language sql
security definer
set search_path = ''
as $$
  with dropped_links as (
    delete from public.attendance_links
    where owner_id = (select auth.uid())
    returning 1
  ),
  gone as (
    delete from public.players
    where owner_id = (select auth.uid())
    returning 1
  )
  select count(*)::integer from gone;
$$;
