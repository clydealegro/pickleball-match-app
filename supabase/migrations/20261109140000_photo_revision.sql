-- Apply before deploying the client that writes immutable photo revisions.
alter table public.players add column photo_revision uuid;
