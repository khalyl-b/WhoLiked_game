-- TikTok Data Portability import tracking and privacy controls.

-- Distinguish development fixtures from user-imported activity so a production
-- switch cannot accidentally count fixture likes as real TikTok data.
alter table public.social_activity
  add column import_source text not null default 'legacy'
  check (import_source in ('legacy','fixture','provider','portability_api','manual_archive'));

update public.social_activity
set import_source = 'fixture'
where metadata @> '{"fixture": true}'::jsonb;

create index social_activity_user_source_idx
  on public.social_activity(user_id, import_source);

create table public.tiktok_portability_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  request_id text not null unique check (request_id ~ '^[1-9][0-9]{0,18}$'),
  status text not null check (status in ('pending','downloading','importing','completed','expired','cancelled','failed')),
  data_format text not null default 'json' check (data_format in ('json','text')),
  category_selection_list text[] not null default array['all_data']::text[],
  apply_time timestamptz,
  collect_time timestamptz,
  ready_at timestamptz,
  imported_at timestamptz,
  last_checked_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tiktok_portability_requests_user_created_idx
  on public.tiktok_portability_requests(user_id, created_at desc);
create index tiktok_portability_requests_status_idx
  on public.tiktok_portability_requests(status);

alter table public.tiktok_portability_requests enable row level security;

create policy tiktok_portability_requests_self_read
  on public.tiktok_portability_requests
  for select to authenticated
  using (user_id = public.current_app_user_id());

alter publication supabase_realtime add table public.tiktok_portability_requests;

-- Let trusted server code remove all TikTok-derived records in a single atomic call.
create or replace function public.delete_tiktok_user_data(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, private as $$
begin
  delete from public.tiktok_portability_requests where user_id = p_user_id;
  delete from public.social_activity where user_id = p_user_id and provider = 'TIKTOK';
  delete from public.social_accounts where user_id = p_user_id and provider = 'TIKTOK';
end;
$$;

revoke all on function public.delete_tiktok_user_data(uuid) from public, anon, authenticated;

-- Server-side activity import. The application still validates and normalises all
-- URLs before calling this function; the unique key makes repeated imports idempotent.
create or replace function public.import_tiktok_activity(
  p_user_id uuid,
  p_items jsonb,
  p_import_source text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  imported_count integer;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ACTIVITY_PAYLOAD' using errcode = 'P0001';
  end if;

  insert into public.social_activity(
    user_id,
    provider,
    provider_activity_id,
    video_id,
    video_url,
    activity_type,
    activity_date,
    imported_at,
    available,
    metadata,
    import_source
  )
  select
    p_user_id,
    'TIKTOK'::public.social_provider,
    nullif(item->>'providerActivityId',''),
    item->>'videoId',
    item->>'videoUrl',
    coalesce(nullif(item->>'activityType',''), 'LIKE')::public.activity_type,
    case when nullif(item->>'activityDate','') is null then null else (item->>'activityDate')::timestamptz end,
    clock_timestamp(),
    true,
    jsonb_build_object(
      'importSource', p_import_source,
      'title', nullif(item->>'title',''),
      'creator', nullif(item->>'creator','')
    ),
    p_import_source
  from jsonb_array_elements(p_items) item
  where nullif(item->>'videoId','') is not null
    and nullif(item->>'videoUrl','') is not null
    and coalesce(nullif(item->>'activityType',''), 'LIKE') in ('LIKE','REPOST')
  on conflict (user_id, provider, activity_type, video_id)
  do update set
    video_url = excluded.video_url,
    activity_date = coalesce(excluded.activity_date, public.social_activity.activity_date),
    imported_at = excluded.imported_at,
    available = true,
    metadata = public.social_activity.metadata || excluded.metadata,
    import_source = excluded.import_source;

  get diagnostics imported_count = row_count;
  return imported_count;
end;
$$;

revoke all on function public.import_tiktok_activity(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.delete_tiktok_user_data(uuid) to service_role;
grant execute on function public.import_tiktok_activity(uuid,jsonb,text) to service_role;
