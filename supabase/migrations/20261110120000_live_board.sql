-- The live board: a read-only view of a running session, for anyone who has the slot's attendance link.
--
-- The organizer's phone publishes a trimmed copy of the session (courts, who is on them, the waiting order) and
-- small face thumbnails for the players in it. Visitors never touch these tables. Two locked-down functions are the
-- only way in, and both need the link's code. Nothing here holds a rating, a score or a full name.

create table public.live_boards (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot_id text not null,
  session_id text not null check (length(session_id) between 1 and 80),
  -- What the page draws. Capped in size, and it may not carry the fields the organizer keeps private.
  snapshot jsonb not null check (
    octet_length(snapshot::text) <= 24576
    and snapshot::text !~ '"(rating|partnerCounts|opponentCounts|history|score|winner)"'
  ),
  -- Grows with every change, so a visitor can ask "anything new since this?" and get a tiny answer.
  version bigint not null,
  active boolean not null default true,
  paused boolean not null default false,
  show_photos boolean not null default true,
  -- Touched on every write, including the organizer's heartbeat, so a visitor can tell a quiet game from a lost signal.
  updated_at timestamptz not null default now(),
  primary key (owner_id, slot_id),
  foreign key (owner_id, slot_id) references public.attendance_links (owner_id, slot_id) on delete cascade
);

-- A small face for a player in the running session, as a data URI. Kept only while the board is up.
create table public.live_photos (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot_id text not null,
  roster_id uuid not null,
  photo_seq integer not null check (photo_seq >= 0),
  data text not null check (length(data) <= 16384 and data ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'),
  updated_at timestamptz not null default now(),
  primary key (owner_id, slot_id, roster_id),
  foreign key (owner_id, slot_id) references public.live_boards (owner_id, slot_id) on delete cascade
);

create function public.live_touch() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger live_boards_touch before insert or update on public.live_boards
  for each row execute function public.live_touch();
create trigger live_photos_touch before insert or update on public.live_photos
  for each row execute function public.live_touch();

alter table public.live_boards enable row level security;
alter table public.live_photos enable row level security;

create policy live_boards_select_own on public.live_boards
  for select to authenticated using (owner_id = (select auth.uid()));
create policy live_boards_insert_own on public.live_boards
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy live_boards_update_own on public.live_boards
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy live_boards_delete_own on public.live_boards
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy live_photos_select_own on public.live_photos
  for select to authenticated using (owner_id = (select auth.uid()));
create policy live_photos_insert_own on public.live_photos
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy live_photos_update_own on public.live_photos
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy live_photos_delete_own on public.live_photos
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Anonymous visitors get no table access at all.
revoke all on public.live_boards, public.live_photos from anon, authenticated;
grant select, insert, update, delete on public.live_boards to authenticated;
grant select, insert, update, delete on public.live_photos to authenticated;

-- What the live page shows for a code. Null for an unknown code. A board nobody has touched for 12 hours counts as over.
-- With the version the visitor already has, an unchanged board answers with a few bytes instead of the whole copy.
create function public.live_view(p_code text, p_since bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.attendance_links;
  b public.live_boards;
  age integer;
begin
  select * into l from public.attendance_links where code = p_code;
  if not found then
    return null;
  end if;
  select * into b from public.live_boards
    where owner_id = l.owner_id and slot_id = l.slot_id and active and updated_at > now() - interval '12 hours';
  if not found then
    return jsonb_build_object('state', 'idle');
  end if;
  age := greatest(0, extract(epoch from now() - b.updated_at)::integer);
  if b.paused then
    return jsonb_build_object('state', 'paused', 'age_s', age, 'version', b.version);
  end if;
  if p_since is not null and p_since = b.version then
    return jsonb_build_object('state', 'live', 'version', b.version, 'age_s', age, 'unchanged', true);
  end if;
  return jsonb_build_object('state', 'live', 'version', b.version, 'age_s', age, 'show_photos', b.show_photos, 'board', b.snapshot);
end;
$$;

-- The faces for a code, minus the ones the visitor already has (as "roster id:photo_seq"). Empty when photos are off.
create function public.live_photos(p_code text, p_have text[] default '{}')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.roster_id, 'seq', p.photo_seq, 'data', p.data)), '[]'::jsonb)
  from public.live_photos p
  join public.live_boards b on b.owner_id = p.owner_id and b.slot_id = p.slot_id
  join public.attendance_links l on l.owner_id = b.owner_id and l.slot_id = b.slot_id
  where l.code = p_code
    and b.active and not b.paused and b.show_photos
    and b.updated_at > now() - interval '12 hours'
    and (p.roster_id::text || ':' || p.photo_seq::text) <> all (coalesce(p_have, '{}'));
$$;

revoke execute on function public.live_view(text, bigint) from public;
revoke execute on function public.live_photos(text, text[]) from public;
grant execute on function public.live_view(text, bigint) to anon, authenticated;
grant execute on function public.live_photos(text, text[]) to anon, authenticated;
