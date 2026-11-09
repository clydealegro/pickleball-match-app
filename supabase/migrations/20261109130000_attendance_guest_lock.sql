-- Serialize guest submissions for a link before counting pending rows.
-- The row lock is held until the RPC transaction commits; later requests see the committed count.
create or replace function public.attendance_add_guest(p_code text, p_name text, p_brought_by uuid default null)
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
  select * into l from public.attendance_links where code = p_code for update;
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
