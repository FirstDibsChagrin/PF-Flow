-- PF Flow database schema. Run once in the Supabase SQL editor (or via `supabase db push`).
-- No auth: every function requires the (high-entropy) room code; tables are not directly accessible.

create table if not exists public.rooms (
  code text primary key check (code ~ '^[A-Z2-9]{8}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.doc_updates (
  id bigserial primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  doc_id text not null check (length(doc_id) between 1 and 64),
  update text not null,
  created_at timestamptz not null default now()
);
create index if not exists doc_updates_room_doc_idx on public.doc_updates (room_code, doc_id, id);

alter table public.rooms enable row level security;
alter table public.doc_updates enable row level security;
-- No RLS policies => anon/authenticated roles cannot read or write rows directly.
revoke all on public.rooms from anon, authenticated;
revoke all on public.doc_updates from anon, authenticated;

create or replace function public.pf_create_room(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into rooms(code) values (p_code);
  return true;
exception when unique_violation then
  return false;
end $$;

create or replace function public.pf_room_exists(p_code text) returns boolean
language sql security definer set search_path = public stable as $$
  select exists(select 1 from rooms where code = p_code);
$$;

create or replace function public.pf_get_updates(p_code text, p_doc text, p_after bigint default 0)
returns table(id bigint, update text)
language sql security definer set search_path = public stable as $$
  select u.id, u.update from doc_updates u
  where u.room_code = p_code and u.doc_id = p_doc and u.id > p_after
  order by u.id;
$$;

create or replace function public.pf_push_update(p_code text, p_doc text, p_update text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if p_code !~ '^[A-Z2-9]{8}$' then
    raise exception 'invalid code';
  end if;
  if length(p_update) > 2000000 then
    raise exception 'update too large';
  end if;
  -- codes generated while offline (or during a failed registration) are registered on first save
  insert into rooms(code) values (p_code) on conflict (code) do nothing;
  insert into doc_updates(room_code, doc_id, update) values (p_code, p_doc, p_update)
  returning doc_updates.id into new_id;
  return new_id;
end $$;

-- Replace a set of rows with one merged update (merged must contain all listed rows).
create or replace function public.pf_compact(p_code text, p_doc text, p_merged text, p_ids bigint[])
returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if p_code !~ '^[A-Z2-9]{8}$' then
    raise exception 'invalid code';
  end if;
  insert into rooms(code) values (p_code) on conflict (code) do nothing;
  insert into doc_updates(room_code, doc_id, update) values (p_code, p_doc, p_merged)
  returning doc_updates.id into new_id;
  delete from doc_updates where room_code = p_code and doc_id = p_doc and id = any(p_ids);
  return new_id;
end $$;

create or replace function public.pf_delete_doc(p_code text, p_doc text) returns void
language sql security definer set search_path = public as $$
  delete from doc_updates where room_code = p_code and doc_id = p_doc;
$$;

create or replace function public.pf_server_time() returns double precision
language sql stable as $$ select extract(epoch from clock_timestamp()) * 1000; $$;

revoke all on function public.pf_create_room(text), public.pf_room_exists(text),
  public.pf_get_updates(text,text,bigint), public.pf_push_update(text,text,text),
  public.pf_compact(text,text,text,bigint[]), public.pf_delete_doc(text,text) from public;
grant execute on function public.pf_create_room(text), public.pf_room_exists(text),
  public.pf_get_updates(text,text,bigint), public.pf_push_update(text,text,text),
  public.pf_compact(text,text,text,bigint[]), public.pf_delete_doc(text,text),
  public.pf_server_time() to anon, authenticated;
