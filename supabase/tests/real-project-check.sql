-- Checks the security rules on a REAL Supabase project, after the three migrations are applied.
-- Run it in the SQL editor, or through the Supabase MCP `execute_sql`. It succeeds silently; a broken rule
-- stops it with a message. It runs in one transaction that ends in ROLLBACK, so it leaves nothing behind:
-- not the two test users, not the rows, not the photo entries.
-- If your project refuses the two test rows in auth.users, this check cannot run there: the rules are then
-- proven only by the in-memory tests, so say so rather than calling the real project checked.

begin;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2');

do $check$
declare
  alice constant uuid := '00000000-0000-4000-8000-0000000000a1';
  bob   constant uuid := '00000000-0000-4000-8000-0000000000b2';
  n integer;
begin
  -- Alice saves a player and a photo entry.
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.players (id, name) values ('00000000-0000-4000-8000-000000000001', 'Ann');
  insert into storage.objects (bucket_id, name)
    values ('player-photos', alice || '/00000000-0000-4000-8000-000000000001/1.jpg');
  reset role;

  -- Bob sees none of it, and cannot change it.
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.players;
  assert n = 0, 'Bob can see Alice''s players';
  select count(*) into n from storage.objects where bucket_id = 'player-photos';
  assert n = 0, 'Bob can see Alice''s photo files';

  update public.players set name = 'Hacked';
  get diagnostics n = row_count;
  assert n = 0, 'Bob changed Alice''s player';

  begin
    insert into public.players (owner_id, id, name) values (alice, '00000000-0000-4000-8000-000000000009', 'Fake');
    raise exception 'Bob wrote a player row for Alice';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into storage.objects (bucket_id, name) values ('player-photos', alice || '/x/1.jpg');
    raise exception 'Bob wrote a file into Alice''s folder';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.players;
    raise exception 'Bob could hard-delete players';
  exception when insufficient_privilege then null;
  end;

  -- Bob's purge removes only Bob's own rows.
  insert into public.players (id, name) values ('00000000-0000-4000-8000-000000000002', 'Ben');
  select public.delete_my_players() into n;
  assert n = 1, 'The purge should delete exactly Bob''s one player';
  reset role;

  -- A signed-out visitor gets nothing.
  set local role anon;
  begin
    perform 1 from public.players;
    raise exception 'A signed-out visitor could read players';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.delete_my_players();
    raise exception 'A signed-out visitor could run the purge';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Alice's data survived Bob's purge, and the photo bucket is private and small.
  select count(*) into n from public.players where owner_id = alice;
  assert n = 1, 'Bob''s purge touched Alice''s players';
  select count(*) into n from storage.buckets
    where id = 'player-photos' and public = false and file_size_limit = 204800 and allowed_mime_types = array['image/jpeg'];
  assert n = 1, 'The player-photos bucket should be private, limited to 200 KB, and accept only image/jpeg';
end
$check$;

rollback;
