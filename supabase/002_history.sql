-- Version history snapshots (one row per snapshot). Data is a compact, history-free Yjs update
-- of the flow's content. Access only through room-code RPCs, like the rest of the schema.
create table if not exists public.flow_snapshots (
  id bigserial primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  name text,
  kind text not null check (kind in ('auto', 'manual')),
  created_at timestamptz not null default now(),
  created_by text,
  summary text,
  data text not null
);
create index if not exists flow_snapshots_room_idx on public.flow_snapshots (room_code, created_at desc);
alter table public.flow_snapshots enable row level security;
revoke all on public.flow_snapshots from anon, authenticated;

-- Save a snapshot. Auto snapshots are de-duplicated (one per ~4 minutes per flow, whoever sends it)
-- and thinned: all kept for 48h, then the newest per hour until 14 days, then the newest per day,
-- capped at 150 auto snapshots per flow. Manual (named) snapshots are never auto-deleted.
create or replace function public.pf_save_snapshot(
  p_code text, p_name text, p_kind text, p_by text, p_summary text, p_data text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if p_code !~ '^[A-Z2-9]{8}$' then raise exception 'invalid code'; end if;
  if p_kind not in ('auto', 'manual') then raise exception 'invalid kind'; end if;
  if length(p_data) > 3000000 then raise exception 'snapshot too large'; end if;
  insert into rooms(code) values (p_code) on conflict (code) do nothing;
  if p_kind = 'auto' and exists (
    select 1 from flow_snapshots
    where room_code = p_code and kind = 'auto' and created_at > now() - interval '4 minutes'
  ) then
    return null;
  end if;
  insert into flow_snapshots(room_code, name, kind, created_by, summary, data)
  values (p_code, left(p_name, 120), p_kind, left(p_by, 40), left(p_summary, 600), p_data)
  returning id into new_id;

  delete from flow_snapshots s using (
    select id, row_number() over (
      partition by case when created_at > now() - interval '14 days'
                        then date_trunc('hour', created_at) else date_trunc('day', created_at) end
      order by created_at desc) as rn
    from flow_snapshots
    where room_code = p_code and kind = 'auto' and created_at < now() - interval '48 hours'
  ) x where s.id = x.id and x.rn > 1;

  delete from flow_snapshots where id in (
    select id from flow_snapshots where room_code = p_code and kind = 'auto'
    order by created_at desc offset 150
  );
  return new_id;
end $$;

create or replace function public.pf_list_snapshots(p_code text)
returns table(id bigint, name text, kind text, created_at timestamptz, created_by text, summary text)
language sql security definer set search_path = public stable as $$
  select id, name, kind, created_at, created_by, summary from flow_snapshots
  where room_code = p_code order by created_at desc limit 300;
$$;

create or replace function public.pf_get_snapshot(p_code text, p_id bigint) returns text
language sql security definer set search_path = public stable as $$
  select data from flow_snapshots where room_code = p_code and id = p_id;
$$;

revoke all on function public.pf_save_snapshot(text,text,text,text,text,text),
  public.pf_list_snapshots(text), public.pf_get_snapshot(text,bigint) from public;
grant execute on function public.pf_save_snapshot(text,text,text,text,text,text),
  public.pf_list_snapshots(text), public.pf_get_snapshot(text,bigint) to anon, authenticated;
