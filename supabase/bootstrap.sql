-- ===== 0001_initial_schema.sql =====
create extension if not exists pgcrypto;

create type public.room_status as enum ('LOBBY', 'ACTIVE', 'FINISHED', 'CANCELLED');
create type public.round_status as enum ('PENDING', 'ACTIVE', 'REVEAL', 'FINISHED', 'SKIPPED');
create type public.activity_type as enum ('LIKE', 'REPOST');
create type public.social_provider as enum ('TIKTOK');

create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 30),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider public.social_provider not null,
  provider_user_id text not null,
  provider_display_name text,
  provider_avatar_url text,
  connected_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, provider_user_id),
  unique (user_id, provider)
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.social_account_tokens (
  social_account_id uuid primary key references public.social_accounts(id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  encryption_key_version integer not null default 1,
  updated_at timestamptz not null default now()
);
revoke all on private.social_account_tokens from public, anon, authenticated;

create table public.social_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider public.social_provider not null default 'TIKTOK',
  provider_activity_id text,
  video_id text not null,
  video_url text not null,
  activity_type public.activity_type not null,
  activity_date timestamptz,
  imported_at timestamptz not null default now(),
  available boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, provider, activity_type, video_id)
);
create index social_activity_user_type_available_idx on public.social_activity(user_id, activity_type, available);
create index social_activity_video_idx on public.social_activity(video_id);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code varchar(6) not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  host_user_id uuid not null references public.users(id),
  status public.room_status not null default 'LOBBY',
  round_count integer not null check (round_count in (5,10,15,20)),
  guess_duration_seconds integer not null default 15 check (guess_duration_seconds in (10,15,20,30)),
  activity_types public.activity_type[] not null default array['LIKE']::public.activity_type[] check (cardinality(activity_types) >= 1),
  current_round_number integer not null default 0 check (current_round_number >= 0),
  game_number integer not null default 1 check (game_number >= 1),
  reveal_ends_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index rooms_status_idx on public.rooms(status);

create table public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  score integer not null default 0 check (score >= 0),
  ready boolean not null default true,
  connected boolean not null default true,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (room_id, user_id)
);
create index room_players_room_active_idx on public.room_players(room_id) where left_at is null;

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  game_number integer not null,
  round_number integer not null,
  source_user_id uuid not null references public.users(id),
  activity_id uuid not null references public.social_activity(id),
  status public.round_status not null default 'PENDING',
  started_at timestamptz,
  answer_deadline timestamptz,
  revealed_at timestamptz,
  unique (room_id, game_number, round_number),
  unique (room_id, game_number, activity_id)
);
create index rounds_room_game_idx on public.rounds(room_id, game_number, round_number);

create table public.guesses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  guessing_user_id uuid not null references public.users(id),
  guessed_user_id uuid not null references public.users(id),
  submitted_at timestamptz not null default now(),
  correct boolean not null,
  points integer not null check (points in (0,1)),
  unique (round_id, guessing_user_id)
);
create index guesses_round_idx on public.guesses(round_id);

alter table public.users enable row level security;
alter table public.social_accounts enable row level security;
alter table public.social_activity enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.rounds enable row level security;
alter table public.guesses enable row level security;

create or replace function public.current_app_user_id() returns uuid
language sql stable security definer set search_path = public
as $$ select id from public.users where auth_user_id = auth.uid() limit 1 $$;

create policy users_read_self on public.users for select to authenticated
using (id = public.current_app_user_id());
create policy social_accounts_self on public.social_accounts for select to authenticated
using (user_id = public.current_app_user_id());
create policy social_activity_self on public.social_activity for select to authenticated
using (user_id = public.current_app_user_id());

create or replace function public.is_room_member(target_room_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.room_players rp
    where rp.room_id = target_room_id
      and rp.user_id = public.current_app_user_id()
      and rp.left_at is null
  )
$$;

revoke all on function public.current_app_user_id() from public, anon;
grant execute on function public.current_app_user_id() to authenticated;
revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;

create policy rooms_member_read on public.rooms for select to authenticated
using (public.is_room_member(rooms.id));

create policy room_players_member_read on public.room_players for select to authenticated
using (public.is_room_member(room_players.room_id));

-- Deliberately no client SELECT policies on rounds or guesses. Before reveal, those rows
-- contain source_user_id/correct and must only be transformed by trusted server code.

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_players;

-- ===== 0002_server_guards.sql =====
-- Production mutation helpers. These constraints are intentionally duplicated at the database
-- boundary so concurrent requests cannot overfill rooms or create multiple guesses.

create or replace function public.assert_room_capacity(target_room_id uuid, max_players integer default 10)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.rooms where id = target_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if (select count(*) from public.room_players where room_id = target_room_id and left_at is null) >= max_players then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.submit_guess_guarded(
  p_round_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r public.rounds%rowtype;
  guess_id uuid;
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;
  if r.answer_deadline is null or clock_timestamp() > r.answer_deadline then raise exception 'DEADLINE_PASSED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessing_user_id and left_at is null) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessed_user_id and left_at is null) then raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001'; end if;

  insert into public.guesses(round_id, guessing_user_id, guessed_user_id, correct, points)
  values (r.id, p_guessing_user_id, p_guessed_user_id, p_guessed_user_id = r.source_user_id, case when p_guessed_user_id = r.source_user_id then 1 else 0 end)
  returning id into guess_id;
  return guess_id;
exception when unique_violation then
  raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
end;
$$;

revoke all on function public.assert_room_capacity(uuid, integer) from public, anon, authenticated;
revoke all on function public.submit_guess_guarded(uuid, uuid, uuid) from public, anon, authenticated;


create or replace function public.join_room_guarded(
  p_room_id uuid,
  p_user_id uuid,
  p_max_players integer default 10
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  room_state public.room_status;
  player_id uuid;
begin
  select status into room_state from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_state <> 'LOBBY' then raise exception 'ROOM_CLOSED' using errcode = 'P0001'; end if;
  if (select count(*) from public.room_players where room_id = p_room_id and left_at is null) >= p_max_players then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;

  insert into public.room_players(room_id, user_id) values (p_room_id, p_user_id)
  on conflict (room_id, user_id) do update set left_at = null, connected = true
  returning id into player_id;
  return player_id;
end;
$$;

revoke all on function public.join_room_guarded(uuid, uuid, integer) from public, anon, authenticated;

-- ===== 0003_serverless_runtime.sql =====
-- Stateless/serverless game runtime.
-- These RPCs keep room transitions authoritative and atomic when multiple Vercel
-- function instances act on the same room concurrently.

create or replace function public.join_room_guarded(
  p_room_id uuid,
  p_user_id uuid,
  p_max_players integer default 10
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  room_state public.room_status;
  player_id uuid;
begin
  select status into room_state from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_state <> 'LOBBY' then raise exception 'ROOM_CLOSED' using errcode = 'P0001'; end if;

  select id into player_id
  from public.room_players
  where room_id = p_room_id and user_id = p_user_id and left_at is null;
  if player_id is not null then
    update public.room_players set connected = true where id = player_id;
    return player_id;
  end if;

  if (select count(*) from public.room_players where room_id = p_room_id and left_at is null) >= p_max_players then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;

  insert into public.room_players(room_id, user_id, score, ready, connected, left_at)
  values (p_room_id, p_user_id, 0, true, true, null)
  on conflict (room_id, user_id) do update
    set left_at = null, connected = true, score = 0, ready = true
  returning id into player_id;
  return player_id;
end;
$$;

create or replace function private.reveal_current_round(p_room_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id;
  if not found or room_row.status <> 'ACTIVE' then return; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;

  if not found or round_row.status <> 'ACTIVE' then return; end if;

  update public.room_players rp
  set score = rp.score + g.points
  from public.guesses g
  where g.round_id = round_row.id
    and g.guessing_user_id = rp.user_id
    and rp.room_id = room_row.id
    and rp.left_at is null
    and g.correct = true;

  update public.rounds
  set status = 'REVEAL', revealed_at = clock_timestamp()
  where id = round_row.id and status = 'ACTIVE';

  update public.rooms
  set reveal_ends_at = clock_timestamp() + interval '4 seconds'
  where id = room_row.id;
end;
$$;

create or replace function private.advance_after_reveal(p_room_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  next_round public.rounds%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id;
  if not found or room_row.status <> 'ACTIVE' then return; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status not in ('REVEAL', 'SKIPPED') then return; end if;

  if round_row.status = 'REVEAL' then
    update public.rounds set status = 'FINISHED' where id = round_row.id and status = 'REVEAL';
  end if;

  if room_row.current_round_number >= room_row.round_count then
    update public.rooms
    set status = 'FINISHED', finished_at = clock_timestamp(), reveal_ends_at = null
    where id = room_row.id;
    return;
  end if;

  select * into next_round
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number + 1
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if next_round.status <> 'PENDING' then return; end if;

  update public.rooms
  set current_round_number = room_row.current_round_number + 1,
      reveal_ends_at = null
  where id = room_row.id;

  update public.rounds
  set status = 'ACTIVE',
      started_at = clock_timestamp(),
      answer_deadline = clock_timestamp() + make_interval(secs => room_row.guess_duration_seconds)
  where id = next_round.id and status = 'PENDING';
end;
$$;

create or replace function public.commit_game_start(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_game_number integer,
  p_player_ids uuid[],
  p_rounds jsonb
) returns void
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  active_count integer;
  round_count_payload integer;
  first_round_id uuid;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status <> 'LOBBY' or room_row.game_number <> p_game_number then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select count(*) into active_count from public.room_players where room_id = p_room_id and left_at is null;
  if active_count < 2 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if active_count <> cardinality(p_player_ids)
     or exists (
       select 1 from public.room_players rp
       where rp.room_id = p_room_id and rp.left_at is null and not (rp.user_id = any(p_player_ids))
     )
     or exists (
       select 1 from unnest(p_player_ids) requested(user_id)
       where not exists (
         select 1 from public.room_players rp
         where rp.room_id = p_room_id and rp.user_id = requested.user_id and rp.left_at is null
       )
     ) then
    raise exception 'PLAYER_SET_CHANGED' using errcode = 'P0001';
  end if;

  round_count_payload := jsonb_array_length(p_rounds);
  if round_count_payload <> room_row.round_count then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rounds) item
    left join public.social_activity sa on sa.id = (item->>'activityId')::uuid
    where sa.id is null
       or sa.user_id <> (item->>'sourceUserId')::uuid
       or sa.available = false
       or not (sa.activity_type = any(room_row.activity_types))
       or not ((item->>'sourceUserId')::uuid = any(p_player_ids))
  ) then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  if (
    select count(distinct sa.video_id)
    from jsonb_array_elements(p_rounds) item
    join public.social_activity sa on sa.id = (item->>'activityId')::uuid
  ) <> round_count_payload then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  if exists (
    select selected.video_id
    from (
      select sa.video_id
      from jsonb_array_elements(p_rounds) item
      join public.social_activity sa on sa.id = (item->>'activityId')::uuid
    ) selected
    join public.social_activity candidate
      on candidate.video_id = selected.video_id
     and candidate.user_id = any(p_player_ids)
     and candidate.available = true
     and candidate.activity_type = any(room_row.activity_types)
    group by selected.video_id
    having count(distinct candidate.user_id) > 1
  ) then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  delete from public.rounds where room_id = p_room_id and game_number = p_game_number;

  insert into public.rounds(room_id, game_number, round_number, source_user_id, activity_id, status)
  select p_room_id,
         p_game_number,
         ordinal::integer,
         (item->>'sourceUserId')::uuid,
         (item->>'activityId')::uuid,
         'PENDING'::public.round_status
  from jsonb_array_elements(p_rounds) with ordinality as input(item, ordinal);

  select id into first_round_id
  from public.rounds
  where room_id = p_room_id and game_number = p_game_number and round_number = 1
  for update;

  update public.room_players set score = 0 where room_id = p_room_id and left_at is null;
  update public.rooms
  set status = 'ACTIVE',
      started_at = clock_timestamp(),
      finished_at = null,
      current_round_number = 1,
      reveal_ends_at = null
  where id = p_room_id;

  update public.rounds
  set status = 'ACTIVE',
      started_at = clock_timestamp(),
      answer_deadline = clock_timestamp() + make_interval(secs => room_row.guess_duration_seconds)
  where id = first_round_id;
end;
$$;

create or replace function public.submit_guess_and_maybe_reveal(
  p_room_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  guess_id uuid;
  active_players integer;
  submitted_guesses integer;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;
  if round_row.answer_deadline is null or clock_timestamp() > round_row.answer_deadline then
    raise exception 'DEADLINE_PASSED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessing_user_id and left_at is null) then
    raise exception 'NOT_IN_ROOM' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessed_user_id and left_at is null) then
    raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001';
  end if;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, correct, points)
    values (
      round_row.id,
      p_guessing_user_id,
      p_guessed_user_id,
      p_guessed_user_id = round_row.source_user_id,
      case when p_guessed_user_id = round_row.source_user_id then 1 else 0 end
    ) returning id into guess_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
  end;

  select count(*) into active_players from public.room_players where room_id = p_room_id and left_at is null;
  select count(*) into submitted_guesses from public.guesses where round_id = round_row.id;
  if submitted_guesses >= active_players then
    perform private.reveal_current_round(p_room_id);
  end if;
  return guess_id;
end;
$$;

create or replace function public.advance_room_clock(p_room_id uuid)
returns text
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then return 'NOOP'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;

  if round_row.status = 'ACTIVE' and round_row.answer_deadline is not null and clock_timestamp() >= round_row.answer_deadline then
    perform private.reveal_current_round(p_room_id);
    return 'REVEALED';
  end if;
  if round_row.status = 'REVEAL' and room_row.reveal_ends_at is not null and clock_timestamp() >= room_row.reveal_ends_at then
    perform private.advance_after_reveal(p_room_id);
    return 'ADVANCED';
  end if;
  return 'NOOP';
end;
$$;

create or replace function public.skip_current_round(p_room_id uuid, p_actor_user_id uuid)
returns void
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into round_row from public.rounds
  where room_id = p_room_id and game_number = room_row.game_number and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status not in ('ACTIVE', 'REVEAL') then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;

  update public.rounds set status = 'SKIPPED' where id = round_row.id;
  update public.rooms set reveal_ends_at = null where id = p_room_id;
  perform private.advance_after_reveal(p_room_id);
end;
$$;

create or replace function public.end_game_guarded(p_room_id uuid, p_actor_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare room_row public.rooms%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status not in ('LOBBY', 'ACTIVE') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  update public.rooms set status = 'FINISHED', finished_at = clock_timestamp(), reveal_ends_at = null where id = p_room_id;
end;
$$;

create or replace function public.create_rematch_guarded(p_room_id uuid, p_actor_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare room_row public.rooms%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status <> 'FINISHED' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  update public.rooms
  set game_number = game_number + 1,
      status = 'LOBBY',
      current_round_number = 0,
      started_at = null,
      finished_at = null,
      reveal_ends_at = null
  where id = p_room_id;
  update public.room_players set score = 0, ready = true where room_id = p_room_id and left_at is null;
end;
$$;

create or replace function public.leave_room_guarded(p_room_id uuid, p_actor_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  room_row public.rooms%rowtype;
  replacement uuid;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_actor_user_id and left_at is null) then
    raise exception 'NOT_IN_ROOM' using errcode = 'P0001';
  end if;

  if room_row.status = 'ACTIVE' then
    update public.room_players set connected = false where room_id = p_room_id and user_id = p_actor_user_id;
  else
    update public.room_players set connected = false, left_at = clock_timestamp() where room_id = p_room_id and user_id = p_actor_user_id;
  end if;

  if room_row.host_user_id = p_actor_user_id then
    select user_id into replacement
    from public.room_players
    where room_id = p_room_id and user_id <> p_actor_user_id and left_at is null
    order by joined_at asc
    limit 1;
    if replacement is not null then update public.rooms set host_user_id = replacement where id = p_room_id; end if;
  end if;

  if room_row.status <> 'ACTIVE'
     and not exists (select 1 from public.room_players where room_id = p_room_id and left_at is null) then
    update public.rooms set status = 'CANCELLED' where id = p_room_id;
  end if;
end;
$$;

create or replace function public.kick_player_guarded(p_room_id uuid, p_actor_user_id uuid, p_target_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare room_row public.rooms%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status <> 'LOBBY' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_target_user_id = p_actor_user_id then raise exception 'INVALID_TARGET' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_target_user_id and left_at is null) then
    raise exception 'NOT_IN_ROOM' using errcode = 'P0001';
  end if;
  update public.room_players set connected = false, left_at = clock_timestamp()
  where room_id = p_room_id and user_id = p_target_user_id;
end;
$$;

-- Server-only token helpers. The underlying token table remains outside the exposed public schema.
create or replace function public.upsert_social_account_token(
  p_social_account_id uuid,
  p_access_token_ciphertext text,
  p_refresh_token_ciphertext text,
  p_access_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz,
  p_scopes text[]
) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  insert into private.social_account_tokens(
    social_account_id, access_token_ciphertext, refresh_token_ciphertext,
    access_token_expires_at, refresh_token_expires_at, scopes, updated_at
  ) values (
    p_social_account_id, p_access_token_ciphertext, p_refresh_token_ciphertext,
    p_access_token_expires_at, p_refresh_token_expires_at, coalesce(p_scopes, '{}'), clock_timestamp()
  )
  on conflict (social_account_id) do update set
    access_token_ciphertext = excluded.access_token_ciphertext,
    refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    access_token_expires_at = excluded.access_token_expires_at,
    refresh_token_expires_at = excluded.refresh_token_expires_at,
    scopes = excluded.scopes,
    updated_at = clock_timestamp();
end;
$$;

create or replace function public.get_social_account_token(p_social_account_id uuid)
returns table(
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scopes text[]
)
language sql stable security definer set search_path = public, private as $$
  select t.access_token_ciphertext, t.refresh_token_ciphertext,
         t.access_token_expires_at, t.refresh_token_expires_at, t.scopes
  from private.social_account_tokens t
  where t.social_account_id = p_social_account_id
$$;

revoke all on function public.join_room_guarded(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.advance_room_clock(uuid) from public, anon, authenticated;
revoke all on function public.skip_current_round(uuid, uuid) from public, anon, authenticated;
revoke all on function public.end_game_guarded(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_rematch_guarded(uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_room_guarded(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kick_player_guarded(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.upsert_social_account_token(uuid, text, text, timestamptz, timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.get_social_account_token(uuid) from public, anon, authenticated;

-- The Next.js server uses a Supabase secret/service-role credential. Browser clients cannot call these mutation/token RPCs.
grant execute on function public.join_room_guarded(uuid, uuid, integer) to service_role;
grant execute on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) to service_role;
grant execute on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) to service_role;
grant execute on function public.advance_room_clock(uuid) to service_role;
grant execute on function public.skip_current_round(uuid, uuid) to service_role;
grant execute on function public.end_game_guarded(uuid, uuid) to service_role;
grant execute on function public.create_rematch_guarded(uuid, uuid) to service_role;
grant execute on function public.leave_room_guarded(uuid, uuid) to service_role;
grant execute on function public.kick_player_guarded(uuid, uuid, uuid) to service_role;
grant execute on function public.upsert_social_account_token(uuid, text, text, timestamptz, timestamptz, text[]) to service_role;
grant execute on function public.get_social_account_token(uuid) to service_role;

revoke all on function private.reveal_current_round(uuid) from public, anon, authenticated;
revoke all on function private.advance_after_reveal(uuid) from public, anon, authenticated;

-- ===== 0004_tiktok_portability.sql =====
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

-- ===== 0005_shared_likes_multiple_correct_answers.sql =====
-- Shared likes are valid rounds.
-- A video can be owned by multiple players in the same room. Any player whose
-- matching activity exists for the round's video/type is a correct answer.

create or replace function public.commit_game_start(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_game_number integer,
  p_player_ids uuid[],
  p_rounds jsonb
) returns void
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  active_count integer;
  round_count_payload integer;
  first_round_id uuid;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status <> 'LOBBY' or room_row.game_number <> p_game_number then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select count(*) into active_count from public.room_players where room_id = p_room_id and left_at is null;
  if active_count < 2 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if active_count <> cardinality(p_player_ids)
     or exists (
       select 1 from public.room_players rp
       where rp.room_id = p_room_id and rp.left_at is null and not (rp.user_id = any(p_player_ids))
     )
     or exists (
       select 1 from unnest(p_player_ids) requested(user_id)
       where not exists (
         select 1 from public.room_players rp
         where rp.room_id = p_room_id and rp.user_id = requested.user_id and rp.left_at is null
       )
     ) then
    raise exception 'PLAYER_SET_CHANGED' using errcode = 'P0001';
  end if;

  round_count_payload := jsonb_array_length(p_rounds);
  if round_count_payload <> room_row.round_count then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  -- The scheduled owner must genuinely own the selected activity. It is an
  -- anchor used for fair round allocation, not necessarily the only correct user.
  if exists (
    select 1
    from jsonb_array_elements(p_rounds) item
    left join public.social_activity sa on sa.id = (item->>'activityId')::uuid
    where sa.id is null
       or sa.user_id <> (item->>'sourceUserId')::uuid
       or sa.available = false
       or not (sa.activity_type = any(room_row.activity_types))
       or not ((item->>'sourceUserId')::uuid = any(p_player_ids))
  ) then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  -- A video may only be used once per game, even if several players liked it.
  if (
    select count(distinct sa.video_id)
    from jsonb_array_elements(p_rounds) item
    join public.social_activity sa on sa.id = (item->>'activityId')::uuid
  ) <> round_count_payload then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  delete from public.rounds where room_id = p_room_id and game_number = p_game_number;

  insert into public.rounds(room_id, game_number, round_number, source_user_id, activity_id, status)
  select p_room_id,
         p_game_number,
         ordinal::integer,
         (item->>'sourceUserId')::uuid,
         (item->>'activityId')::uuid,
         'PENDING'::public.round_status
  from jsonb_array_elements(p_rounds) with ordinality as input(item, ordinal);

  select id into first_round_id
  from public.rounds
  where room_id = p_room_id and game_number = p_game_number and round_number = 1
  for update;

  update public.room_players set score = 0 where room_id = p_room_id and left_at is null;
  update public.rooms
  set status = 'ACTIVE',
      started_at = clock_timestamp(),
      finished_at = null,
      current_round_number = 1,
      reveal_ends_at = null
  where id = p_room_id;

  update public.rounds
  set status = 'ACTIVE',
      started_at = clock_timestamp(),
      answer_deadline = clock_timestamp() + make_interval(secs => room_row.guess_duration_seconds)
  where id = first_round_id;
end;
$$;

create or replace function public.submit_guess_and_maybe_reveal(
  p_room_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  active_players integer;
  submitted_guesses integer;
  is_correct boolean;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;
  if round_row.answer_deadline is null or clock_timestamp() > round_row.answer_deadline then
    raise exception 'DEADLINE_PASSED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessing_user_id and left_at is null) then
    raise exception 'NOT_IN_ROOM' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessed_user_id and left_at is null) then
    raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001';
  end if;

  select * into selected_activity from public.social_activity where id = round_row.activity_id;
  if not found or selected_activity.available = false then
    raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- The guess is correct if that room member has the same video under the same
  -- activity type. Shared likes therefore create multiple valid answers.
  select exists (
    select 1
    from public.social_activity candidate
    where candidate.user_id = p_guessed_user_id
      and candidate.provider = selected_activity.provider
      and candidate.video_id = selected_activity.video_id
      and candidate.activity_type = selected_activity.activity_type
      and candidate.available = true
      and (
        (selected_activity.import_source = 'fixture' and candidate.import_source = 'fixture')
        or
        (selected_activity.import_source <> 'fixture' and candidate.import_source <> 'fixture')
      )
  ) into is_correct;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, correct, points)
    values (
      round_row.id,
      p_guessing_user_id,
      p_guessed_user_id,
      is_correct,
      case when is_correct then 1 else 0 end
    ) returning id into guess_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
  end;

  select count(*) into active_players from public.room_players where room_id = p_room_id and left_at is null;
  select count(*) into submitted_guesses from public.guesses where round_id = round_row.id;
  if submitted_guesses >= active_players then
    perform private.reveal_current_round(p_room_id);
  end if;
  return guess_id;
end;
$$;

-- Keep the older guarded RPC consistent in case any stale deployment calls it.
create or replace function public.submit_guess_guarded(
  p_round_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r public.rounds%rowtype;
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  is_correct boolean;
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;
  if r.answer_deadline is null or clock_timestamp() > r.answer_deadline then raise exception 'DEADLINE_PASSED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessing_user_id and left_at is null) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessed_user_id and left_at is null) then raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001'; end if;

  select * into selected_activity from public.social_activity where id = r.activity_id;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;

  select exists (
    select 1 from public.social_activity candidate
    where candidate.user_id = p_guessed_user_id
      and candidate.provider = selected_activity.provider
      and candidate.video_id = selected_activity.video_id
      and candidate.activity_type = selected_activity.activity_type
      and candidate.available = true
      and (
        (selected_activity.import_source = 'fixture' and candidate.import_source = 'fixture')
        or
        (selected_activity.import_source <> 'fixture' and candidate.import_source <> 'fixture')
      )
  ) into is_correct;

  insert into public.guesses(round_id, guessing_user_id, guessed_user_id, correct, points)
  values (r.id, p_guessing_user_id, p_guessed_user_id, is_correct, case when is_correct then 1 else 0 end)
  returning id into guess_id;
  return guess_id;
exception when unique_violation then
  raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
end;
$$;

revoke all on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_guess_guarded(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) to service_role;
grant execute on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) to service_role;
grant execute on function public.submit_guess_guarded(uuid, uuid, uuid) to service_role;

-- ===== 0006_gameplay_quality.sql =====
-- Gameplay quality improvements:
-- 1) new games use 30s+ or Unlimited timers (0 = no automatic deadline),
-- 2) room members can vote to end a round early; >50% reveals it,
-- 3) votes are realtime-visible to room members.

alter table public.rooms drop constraint if exists rooms_guess_duration_seconds_check;
alter table public.rooms add constraint rooms_guess_duration_seconds_check
  check (guess_duration_seconds in (0,10,15,20,30,45,60,90,120));

create table if not exists public.round_end_votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (round_id, user_id)
);

create index if not exists round_end_votes_room_round_idx on public.round_end_votes(room_id, round_id);
alter table public.round_end_votes enable row level security;

drop policy if exists "room members can read end round votes" on public.round_end_votes;
create policy "room members can read end round votes"
  on public.round_end_votes for select
  using (exists (
    select 1 from public.room_players rp
    where rp.room_id = round_end_votes.room_id
      and rp.user_id = auth.uid()
      and rp.left_at is null
  ));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'round_end_votes'
     ) then
    alter publication supabase_realtime add table public.round_end_votes;
  end if;
end $$;

create or replace function private.advance_after_reveal(p_room_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  next_round public.rounds%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id;
  if not found or room_row.status <> 'ACTIVE' then return; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status not in ('REVEAL', 'SKIPPED') then return; end if;

  if round_row.status = 'REVEAL' then
    update public.rounds set status = 'FINISHED' where id = round_row.id and status = 'REVEAL';
  end if;

  if room_row.current_round_number >= room_row.round_count then
    update public.rooms
    set status = 'FINISHED', finished_at = clock_timestamp(), reveal_ends_at = null
    where id = room_row.id;
    return;
  end if;

  select * into next_round
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number + 1
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if next_round.status <> 'PENDING' then return; end if;

  update public.rooms
  set current_round_number = room_row.current_round_number + 1,
      reveal_ends_at = null
  where id = room_row.id;

  update public.rounds
  set status = 'ACTIVE',
      started_at = clock_timestamp(),
      answer_deadline = case when room_row.guess_duration_seconds = 0 then null else clock_timestamp() + make_interval(secs => room_row.guess_duration_seconds) end
  where id = next_round.id and status = 'PENDING';
end;
$$;

create or replace function public.commit_game_start(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_game_number integer,
  p_player_ids uuid[],
  p_rounds jsonb
) returns void
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  active_count integer;
  round_count_payload integer;
  first_round_id uuid;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status <> 'LOBBY' or room_row.game_number <> p_game_number then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select count(*) into active_count from public.room_players where room_id = p_room_id and left_at is null;
  if active_count < 2 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if active_count <> cardinality(p_player_ids)
     or exists (
       select 1 from public.room_players rp
       where rp.room_id = p_room_id and rp.left_at is null and not (rp.user_id = any(p_player_ids))
     )
     or exists (
       select 1 from unnest(p_player_ids) requested(user_id)
       where not exists (
         select 1 from public.room_players rp
         where rp.room_id = p_room_id and rp.user_id = requested.user_id and rp.left_at is null
       )
     ) then
    raise exception 'PLAYER_SET_CHANGED' using errcode = 'P0001';
  end if;

  round_count_payload := jsonb_array_length(p_rounds);
  if round_count_payload <> room_row.round_count then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  -- The scheduled owner must genuinely own the selected activity. It is an
  -- anchor used for fair round allocation, not necessarily the only correct user.
  if exists (
    select 1
    from jsonb_array_elements(p_rounds) item
    left join public.social_activity sa on sa.id = (item->>'activityId')::uuid
    where sa.id is null
       or sa.user_id <> (item->>'sourceUserId')::uuid
       or sa.available = false
       or not (sa.activity_type = any(room_row.activity_types))
       or not ((item->>'sourceUserId')::uuid = any(p_player_ids))
  ) then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  -- A video may only be used once per game, even if several players liked it.
  if (
    select count(distinct sa.video_id)
    from jsonb_array_elements(p_rounds) item
    join public.social_activity sa on sa.id = (item->>'activityId')::uuid
  ) <> round_count_payload then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  delete from public.rounds where room_id = p_room_id and game_number = p_game_number;

  insert into public.rounds(room_id, game_number, round_number, source_user_id, activity_id, status)
  select p_room_id,
         p_game_number,
         ordinal::integer,
         (item->>'sourceUserId')::uuid,
         (item->>'activityId')::uuid,
         'PENDING'::public.round_status
  from jsonb_array_elements(p_rounds) with ordinality as input(item, ordinal);

  select id into first_round_id
  from public.rounds
  where room_id = p_room_id and game_number = p_game_number and round_number = 1
  for update;

  update public.room_players set score = 0 where room_id = p_room_id and left_at is null;
  update public.rooms
  set status = 'ACTIVE',
      started_at = clock_timestamp(),
      finished_at = null,
      current_round_number = 1,
      reveal_ends_at = null
  where id = p_room_id;

  update public.rounds
  set status = 'ACTIVE',
      started_at = clock_timestamp(),
      answer_deadline = case when room_row.guess_duration_seconds = 0 then null else clock_timestamp() + make_interval(secs => room_row.guess_duration_seconds) end
  where id = first_round_id;
end;
$$;

create or replace function public.submit_guess_and_maybe_reveal(
  p_room_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  active_players integer;
  submitted_guesses integer;
  is_correct boolean;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;
  if round_row.answer_deadline is not null and clock_timestamp() > round_row.answer_deadline then
    raise exception 'DEADLINE_PASSED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessing_user_id and left_at is null) then
    raise exception 'NOT_IN_ROOM' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessed_user_id and left_at is null) then
    raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001';
  end if;

  select * into selected_activity from public.social_activity where id = round_row.activity_id;
  if not found or selected_activity.available = false then
    raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- The guess is correct if that room member has the same video under the same
  -- activity type. Shared likes therefore create multiple valid answers.
  select exists (
    select 1
    from public.social_activity candidate
    where candidate.user_id = p_guessed_user_id
      and candidate.provider = selected_activity.provider
      and candidate.video_id = selected_activity.video_id
      and candidate.activity_type = selected_activity.activity_type
      and candidate.available = true
      and (
        (selected_activity.import_source = 'fixture' and candidate.import_source = 'fixture')
        or
        (selected_activity.import_source <> 'fixture' and candidate.import_source <> 'fixture')
      )
  ) into is_correct;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, correct, points)
    values (
      round_row.id,
      p_guessing_user_id,
      p_guessed_user_id,
      is_correct,
      case when is_correct then 1 else 0 end
    ) returning id into guess_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
  end;

  select count(*) into active_players from public.room_players where room_id = p_room_id and left_at is null;
  select count(*) into submitted_guesses from public.guesses where round_id = round_row.id;
  if submitted_guesses >= active_players then
    perform private.reveal_current_round(p_room_id);
  end if;
  return guess_id;
end;
$$;

create or replace function public.submit_guess_guarded(
  p_round_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r public.rounds%rowtype;
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  is_correct boolean;
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;
  if r.answer_deadline is not null and clock_timestamp() > r.answer_deadline then raise exception 'DEADLINE_PASSED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessing_user_id and left_at is null) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessed_user_id and left_at is null) then raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001'; end if;

  select * into selected_activity from public.social_activity where id = r.activity_id;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;

  select exists (
    select 1 from public.social_activity candidate
    where candidate.user_id = p_guessed_user_id
      and candidate.provider = selected_activity.provider
      and candidate.video_id = selected_activity.video_id
      and candidate.activity_type = selected_activity.activity_type
      and candidate.available = true
      and (
        (selected_activity.import_source = 'fixture' and candidate.import_source = 'fixture')
        or
        (selected_activity.import_source <> 'fixture' and candidate.import_source <> 'fixture')
      )
  ) into is_correct;

  insert into public.guesses(round_id, guessing_user_id, guessed_user_id, correct, points)
  values (r.id, p_guessing_user_id, p_guessed_user_id, is_correct, case when is_correct then 1 else 0 end)
  returning id into guess_id;
  return guess_id;
exception when unique_violation then
  raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
end;
$$;

create or replace function public.vote_to_end_current_round(
  p_room_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  active_players integer;
  vote_count integer;
  required_votes integer;
  did_reveal boolean := false;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = p_actor_user_id and left_at is null
  ) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;

  insert into public.round_end_votes(room_id, round_id, user_id)
  values (p_room_id, round_row.id, p_actor_user_id)
  on conflict (round_id, user_id) do nothing;

  select count(*) into active_players
  from public.room_players
  where room_id = p_room_id and left_at is null;
  required_votes := floor(active_players / 2.0)::integer + 1;

  select count(*) into vote_count
  from public.round_end_votes v
  where v.round_id = round_row.id
    and exists (
      select 1 from public.room_players rp
      where rp.room_id = p_room_id and rp.user_id = v.user_id and rp.left_at is null
    );

  if vote_count >= required_votes then
    perform private.reveal_current_round(p_room_id);
    did_reveal := true;
  end if;

  return jsonb_build_object(
    'voteCount', vote_count,
    'requiredVotes', required_votes,
    'revealed', did_reveal
  );
end;
$$;


revoke all on table public.round_end_votes from anon, authenticated;
grant select on table public.round_end_votes to authenticated;

revoke all on function public.vote_to_end_current_round(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vote_to_end_current_round(uuid, uuid) to service_role;

-- Re-assert server-only execution for replaced functions.
revoke all on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_guess_guarded(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) to service_role;
grant execute on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) to service_role;
grant execute on function public.submit_guess_guarded(uuid, uuid, uuid) to service_role;

-- ===== 0007_embed_player_availability.sql =====
-- Replace unavailable TikTok rounds only after TikTok's actual Embed Player
-- reports INVALID_VIDEO (1001). This avoids false negatives from trying to
-- preflight Data Portability share URLs through oEmbed without a creator handle.

-- Migration 0006's oEmbed preflight could falsely mark perfectly valid
-- Data Portability share links unavailable. Re-admit real imported posts once;
-- from this migration onward only the actual Embed Player's INVALID_VIDEO (1001)
-- report marks a post unavailable.
update public.social_activity
set available = true
where provider = 'TIKTOK'::public.social_provider
  and import_source <> 'fixture';

create or replace function public.replace_unavailable_current_round(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_round_id uuid,
  p_video_id text
) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  current_activity public.social_activity%rowtype;
  replacement public.social_activity%rowtype;
  has_guesses boolean;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then return false; end if;
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = p_actor_user_id and left_at is null
  ) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where id = p_round_id
    and room_id = p_room_id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found or round_row.status <> 'ACTIVE' then return false; end if;

  select * into current_activity from public.social_activity where id = round_row.activity_id;
  if not found or current_activity.video_id <> p_video_id then
    -- Another client may already have replaced the same unavailable post.
    return false;
  end if;

  select exists(select 1 from public.guesses where round_id = round_row.id) into has_guesses;
  if has_guesses then
    -- The UI keeps guessing disabled until the player reports ready, so this is
    -- mainly a guard against a stale or malicious report.
    return false;
  end if;

  -- A TikTok media ID is globally unavailable, so mark every imported copy of
  -- this post unavailable regardless of which room member owned it.
  update public.social_activity
  set available = false
  where provider = current_activity.provider
    and video_id = current_activity.video_id;

  -- Prefer preserving the round's scheduled anchor owner and activity type so
  -- fairness remains as close as possible to the original allocation.
  select sa.* into replacement
  from public.social_activity sa
  join public.room_players rp
    on rp.room_id = p_room_id and rp.user_id = sa.user_id and rp.left_at is null
  where sa.provider = current_activity.provider
    and sa.available = true
    and sa.activity_type = current_activity.activity_type
    and sa.user_id = round_row.source_user_id
    and not exists (
      select 1
      from public.rounds used_round
      join public.social_activity used_activity on used_activity.id = used_round.activity_id
      where used_round.room_id = p_room_id
        and used_round.game_number = room_row.game_number
        and used_round.id <> round_row.id
        and used_activity.video_id = sa.video_id
    )
    and (
      (current_activity.import_source = 'fixture' and sa.import_source = 'fixture')
      or
      (current_activity.import_source <> 'fixture' and sa.import_source <> 'fixture')
    )
  order by random()
  limit 1;

  if not found then
    -- Fall back to any active room member and any selected activity type.
    select sa.* into replacement
    from public.social_activity sa
    join public.room_players rp
      on rp.room_id = p_room_id and rp.user_id = sa.user_id and rp.left_at is null
    where sa.provider = current_activity.provider
      and sa.available = true
      and sa.activity_type = any(room_row.activity_types)
      and not exists (
        select 1
        from public.rounds used_round
        join public.social_activity used_activity on used_activity.id = used_round.activity_id
        where used_round.room_id = p_room_id
          and used_round.game_number = room_row.game_number
          and used_round.id <> round_row.id
          and used_activity.video_id = sa.video_id
      )
      and (
        (current_activity.import_source = 'fixture' and sa.import_source = 'fixture')
        or
        (current_activity.import_source <> 'fixture' and sa.import_source <> 'fixture')
      )
    order by case when sa.user_id = round_row.source_user_id then 0 else 1 end, random()
    limit 1;
  end if;

  if not found then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  delete from public.round_end_votes where round_id = round_row.id;
  delete from public.guesses where round_id = round_row.id;

  update public.rounds
  set source_user_id = replacement.user_id,
      activity_id = replacement.id,
      started_at = clock_timestamp(),
      answer_deadline = case
        when room_row.guess_duration_seconds = 0 then null
        else clock_timestamp() + make_interval(secs => room_row.guess_duration_seconds)
      end,
      revealed_at = null
  where id = round_row.id;

  return true;
end;
$$;

revoke all on function public.replace_unavailable_current_round(uuid, uuid, uuid, text) from public, anon, authenticated;

-- The client listens for in-place round replacements so all players switch to
-- the new hidden/player-preflight video immediately.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rounds'
     ) then
    alter publication supabase_realtime add table public.rounds;
  end if;
end $$;

-- ===== 0008_time_decay_scoring.sql =====
-- Time-decay scoring:
-- - correct answer at round start: 1000 points
-- - linear decay through the configured timed round
-- - correct answer immediately before deadline: 100 points
-- - wrong/no answer: 0 points
-- - Unlimited rounds: fixed 1000 points for a correct answer

alter table public.guesses drop constraint if exists guesses_points_check;
alter table public.guesses add constraint guesses_points_check check (points between 0 and 1000);

create or replace function private.calculate_timed_guess_points(
  p_started_at timestamptz,
  p_answer_deadline timestamptz,
  p_submitted_at timestamptz
) returns integer
language plpgsql immutable set search_path = public, private as $$
declare
  duration_seconds double precision;
  remaining_seconds double precision;
  score_value integer;
begin
  -- Unlimited rounds have no deadline and therefore no time decay.
  if p_answer_deadline is null then
    return 1000;
  end if;

  if p_started_at is null or p_answer_deadline <= p_started_at then
    return 100;
  end if;

  duration_seconds := extract(epoch from (p_answer_deadline - p_started_at));
  remaining_seconds := greatest(0.0, least(duration_seconds, extract(epoch from (p_answer_deadline - p_submitted_at))));

  score_value := round(100.0 + 900.0 * (remaining_seconds / duration_seconds))::integer;
  return greatest(100, least(1000, score_value));
end;
$$;

create or replace function public.submit_guess_and_maybe_reveal(
  p_room_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  active_players integer;
  submitted_guesses integer;
  is_correct boolean;
  submitted_at_value timestamptz;
  awarded_points integer;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;

  submitted_at_value := clock_timestamp();
  if round_row.answer_deadline is not null and submitted_at_value >= round_row.answer_deadline then
    raise exception 'DEADLINE_PASSED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessing_user_id and left_at is null) then
    raise exception 'NOT_IN_ROOM' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessed_user_id and left_at is null) then
    raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001';
  end if;

  select * into selected_activity from public.social_activity where id = round_row.activity_id;
  if not found or selected_activity.available = false then
    raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from public.social_activity candidate
    where candidate.user_id = p_guessed_user_id
      and candidate.provider = selected_activity.provider
      and candidate.video_id = selected_activity.video_id
      and candidate.activity_type = selected_activity.activity_type
      and candidate.available = true
      and (
        (selected_activity.import_source = 'fixture' and candidate.import_source = 'fixture')
        or
        (selected_activity.import_source <> 'fixture' and candidate.import_source <> 'fixture')
      )
  ) into is_correct;

  awarded_points := case when is_correct then private.calculate_timed_guess_points(
    round_row.started_at,
    round_row.answer_deadline,
    submitted_at_value
  ) else 0 end;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, submitted_at, correct, points)
    values (
      round_row.id,
      p_guessing_user_id,
      p_guessed_user_id,
      submitted_at_value,
      is_correct,
      awarded_points
    ) returning id into guess_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
  end;

  select count(*) into active_players from public.room_players where room_id = p_room_id and left_at is null;
  select count(*) into submitted_guesses from public.guesses where round_id = round_row.id;
  if submitted_guesses >= active_players then
    perform private.reveal_current_round(p_room_id);
  end if;
  return guess_id;
end;
$$;

-- Keep the older guarded RPC consistent in case a stale deployment calls it.
create or replace function public.submit_guess_guarded(
  p_round_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  r public.rounds%rowtype;
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  is_correct boolean;
  submitted_at_value timestamptz;
  awarded_points integer;
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;

  submitted_at_value := clock_timestamp();
  if r.answer_deadline is not null and submitted_at_value >= r.answer_deadline then
    raise exception 'DEADLINE_PASSED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessing_user_id and left_at is null) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessed_user_id and left_at is null) then raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001'; end if;

  select * into selected_activity from public.social_activity where id = r.activity_id;
  if not found or selected_activity.available = false then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;

  select exists (
    select 1 from public.social_activity candidate
    where candidate.user_id = p_guessed_user_id
      and candidate.provider = selected_activity.provider
      and candidate.video_id = selected_activity.video_id
      and candidate.activity_type = selected_activity.activity_type
      and candidate.available = true
      and (
        (selected_activity.import_source = 'fixture' and candidate.import_source = 'fixture')
        or
        (selected_activity.import_source <> 'fixture' and candidate.import_source <> 'fixture')
      )
  ) into is_correct;

  awarded_points := case when is_correct then private.calculate_timed_guess_points(
    r.started_at,
    r.answer_deadline,
    submitted_at_value
  ) else 0 end;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, submitted_at, correct, points)
    values (r.id, p_guessing_user_id, p_guessed_user_id, submitted_at_value, is_correct, awarded_points)
    returning id into guess_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
  end;
  return guess_id;
end;
$$;

revoke all on function private.calculate_timed_guess_points(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_guess_guarded(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) to service_role;
grant execute on function public.submit_guess_guarded(uuid, uuid, uuid) to service_role;

-- ===== 0009_playback_started_timer_and_500_floor.sql =====
-- Gameplay timing polish:
-- 1) a round timer does not start until every active room member's TikTok player
--    has actually entered TikTok's onStateChange=1 (playing) state,
-- 2) timed correct guesses decay from 1000 to 500 points instead of 100,
-- 3) round replacement resets playback acknowledgements and waits again.

create table if not exists public.round_playback_starts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (round_id, user_id)
);

create index if not exists round_playback_starts_room_round_idx
  on public.round_playback_starts(room_id, round_id);

alter table public.round_playback_starts enable row level security;
revoke all on table public.round_playback_starts from anon, authenticated;

create or replace function private.calculate_timed_guess_points(
  p_started_at timestamptz,
  p_answer_deadline timestamptz,
  p_submitted_at timestamptz
) returns integer
language plpgsql immutable set search_path = public, private as $$
declare
  duration_seconds double precision;
  remaining_seconds double precision;
  score_value integer;
begin
  -- Unlimited rounds have no deadline and therefore no time decay.
  if p_answer_deadline is null then
    return 1000;
  end if;

  if p_started_at is null or p_answer_deadline <= p_started_at then
    return 500;
  end if;

  duration_seconds := extract(epoch from (p_answer_deadline - p_started_at));
  remaining_seconds := greatest(0.0, least(duration_seconds, extract(epoch from (p_answer_deadline - p_submitted_at))));

  score_value := round(500.0 + 500.0 * (remaining_seconds / duration_seconds))::integer;
  return greatest(500, least(1000, score_value));
end;
$$;

create or replace function public.commit_game_start(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_game_number integer,
  p_player_ids uuid[],
  p_rounds jsonb
) returns void
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  active_count integer;
  round_count_payload integer;
  first_round_id uuid;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status <> 'LOBBY' or room_row.game_number <> p_game_number then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select count(*) into active_count from public.room_players where room_id = p_room_id and left_at is null;
  if active_count < 2 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if active_count <> cardinality(p_player_ids)
     or exists (
       select 1 from public.room_players rp
       where rp.room_id = p_room_id and rp.left_at is null and not (rp.user_id = any(p_player_ids))
     )
     or exists (
       select 1 from unnest(p_player_ids) requested(user_id)
       where not exists (
         select 1 from public.room_players rp
         where rp.room_id = p_room_id and rp.user_id = requested.user_id and rp.left_at is null
       )
     ) then
    raise exception 'PLAYER_SET_CHANGED' using errcode = 'P0001';
  end if;

  round_count_payload := jsonb_array_length(p_rounds);
  if round_count_payload <> room_row.round_count then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rounds) item
    left join public.social_activity sa on sa.id = (item->>'activityId')::uuid
    where sa.id is null
       or sa.user_id <> (item->>'sourceUserId')::uuid
       or sa.available = false
       or not (sa.activity_type = any(room_row.activity_types))
       or not ((item->>'sourceUserId')::uuid = any(p_player_ids))
  ) then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  if (
    select count(distinct sa.video_id)
    from jsonb_array_elements(p_rounds) item
    join public.social_activity sa on sa.id = (item->>'activityId')::uuid
  ) <> round_count_payload then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  delete from public.rounds where room_id = p_room_id and game_number = p_game_number;

  insert into public.rounds(room_id, game_number, round_number, source_user_id, activity_id, status)
  select p_room_id,
         p_game_number,
         ordinal::integer,
         (item->>'sourceUserId')::uuid,
         (item->>'activityId')::uuid,
         'PENDING'::public.round_status
  from jsonb_array_elements(p_rounds) with ordinality as input(item, ordinal);

  select id into first_round_id
  from public.rounds
  where room_id = p_room_id and game_number = p_game_number and round_number = 1
  for update;

  update public.room_players set score = 0 where room_id = p_room_id and left_at is null;
  update public.rooms
  set status = 'ACTIVE',
      started_at = clock_timestamp(),
      finished_at = null,
      current_round_number = 1,
      reveal_ends_at = null
  where id = p_room_id;

  -- The TikTok is allowed to load/play first. report_round_playback_started()
  -- begins the timer only after every active player has actually reached PLAYING.
  update public.rounds
  set status = 'ACTIVE',
      started_at = null,
      answer_deadline = null
  where id = first_round_id;
end;
$$;

create or replace function private.advance_after_reveal(p_room_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  next_round public.rounds%rowtype;
begin
  select * into room_row from public.rooms where id = p_room_id;
  if not found or room_row.status <> 'ACTIVE' then return; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status not in ('REVEAL', 'SKIPPED') then return; end if;

  if round_row.status = 'REVEAL' then
    update public.rounds set status = 'FINISHED' where id = round_row.id and status = 'REVEAL';
  end if;

  if room_row.current_round_number >= room_row.round_count then
    update public.rooms
    set status = 'FINISHED', finished_at = clock_timestamp(), reveal_ends_at = null
    where id = room_row.id;
    return;
  end if;

  select * into next_round
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number + 1
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if next_round.status <> 'PENDING' then return; end if;

  update public.rooms
  set current_round_number = room_row.current_round_number + 1,
      reveal_ends_at = null
  where id = room_row.id;

  update public.rounds
  set status = 'ACTIVE',
      started_at = null,
      answer_deadline = null
  where id = next_round.id and status = 'PENDING';
end;
$$;

create or replace function public.report_round_playback_started(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_round_id uuid,
  p_video_id text
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  activity_row public.social_activity%rowtype;
  active_players integer;
  playback_players integer;
  started_value timestamptz;
  did_start boolean := false;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = p_actor_user_id and left_at is null
  ) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where id = p_round_id
    and room_id = p_room_id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;

  select * into activity_row from public.social_activity where id = round_row.activity_id;
  if not found or activity_row.video_id <> p_video_id or activity_row.available = false then
    raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.round_playback_starts(room_id, round_id, user_id)
  values (p_room_id, round_row.id, p_actor_user_id)
  on conflict (round_id, user_id) do nothing;

  select count(*) into active_players
  from public.room_players
  where room_id = p_room_id and left_at is null;

  select count(*) into playback_players
  from public.round_playback_starts ps
  where ps.round_id = round_row.id
    and exists (
      select 1 from public.room_players rp
      where rp.room_id = p_room_id and rp.user_id = ps.user_id and rp.left_at is null
    );

  if round_row.started_at is null and playback_players >= active_players then
    started_value := clock_timestamp();
    update public.rounds
    set started_at = started_value,
        answer_deadline = case
          when room_row.guess_duration_seconds = 0 then null
          else started_value + make_interval(secs => room_row.guess_duration_seconds)
        end
    where id = round_row.id and started_at is null;
    did_start := true;
  end if;

  return jsonb_build_object(
    'readyCount', playback_players,
    'required', active_players,
    'started', did_start or round_row.started_at is not null
  );
end;
$$;

create or replace function public.submit_guess_and_maybe_reveal(
  p_room_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  active_players integer;
  submitted_guesses integer;
  is_correct boolean;
  submitted_at_value timestamptz;
  awarded_points integer;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;
  if round_row.started_at is null then raise exception 'ROUND_NOT_STARTED' using errcode = 'P0001'; end if;

  submitted_at_value := clock_timestamp();
  if round_row.answer_deadline is not null and submitted_at_value >= round_row.answer_deadline then
    raise exception 'DEADLINE_PASSED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessing_user_id and left_at is null) then
    raise exception 'NOT_IN_ROOM' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessed_user_id and left_at is null) then
    raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001';
  end if;

  select * into selected_activity from public.social_activity where id = round_row.activity_id;
  if not found or selected_activity.available = false then
    raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from public.social_activity candidate
    where candidate.user_id = p_guessed_user_id
      and candidate.provider = selected_activity.provider
      and candidate.video_id = selected_activity.video_id
      and candidate.activity_type = selected_activity.activity_type
      and candidate.available = true
      and (
        (selected_activity.import_source = 'fixture' and candidate.import_source = 'fixture')
        or
        (selected_activity.import_source <> 'fixture' and candidate.import_source <> 'fixture')
      )
  ) into is_correct;

  awarded_points := case when is_correct then private.calculate_timed_guess_points(
    round_row.started_at,
    round_row.answer_deadline,
    submitted_at_value
  ) else 0 end;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, submitted_at, correct, points)
    values (round_row.id, p_guessing_user_id, p_guessed_user_id, submitted_at_value, is_correct, awarded_points)
    returning id into guess_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
  end;

  select count(*) into active_players from public.room_players where room_id = p_room_id and left_at is null;
  select count(*) into submitted_guesses from public.guesses where round_id = round_row.id;
  if submitted_guesses >= active_players then
    perform private.reveal_current_round(p_room_id);
  end if;
  return guess_id;
end;
$$;

create or replace function public.submit_guess_guarded(
  p_round_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  r public.rounds%rowtype;
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  is_correct boolean;
  submitted_at_value timestamptz;
  awarded_points integer;
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;
  if r.started_at is null then raise exception 'ROUND_NOT_STARTED' using errcode = 'P0001'; end if;

  submitted_at_value := clock_timestamp();
  if r.answer_deadline is not null and submitted_at_value >= r.answer_deadline then
    raise exception 'DEADLINE_PASSED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessing_user_id and left_at is null) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessed_user_id and left_at is null) then raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001'; end if;

  select * into selected_activity from public.social_activity where id = r.activity_id;
  if not found or selected_activity.available = false then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;

  select exists (
    select 1
    from public.social_activity candidate
    where candidate.user_id = p_guessed_user_id
      and candidate.provider = selected_activity.provider
      and candidate.video_id = selected_activity.video_id
      and candidate.activity_type = selected_activity.activity_type
      and candidate.available = true
      and (
        (selected_activity.import_source = 'fixture' and candidate.import_source = 'fixture')
        or
        (selected_activity.import_source <> 'fixture' and candidate.import_source <> 'fixture')
      )
  ) into is_correct;

  awarded_points := case when is_correct then private.calculate_timed_guess_points(
    r.started_at,
    r.answer_deadline,
    submitted_at_value
  ) else 0 end;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, submitted_at, correct, points)
    values (r.id, p_guessing_user_id, p_guessed_user_id, submitted_at_value, is_correct, awarded_points)
    returning id into guess_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
  end;
  return guess_id;
end;
$$;

create or replace function public.vote_to_end_current_round(
  p_room_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  active_players integer;
  vote_count integer;
  required_votes integer;
  did_reveal boolean := false;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = p_actor_user_id and left_at is null
  ) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;
  if round_row.started_at is null then raise exception 'ROUND_NOT_STARTED' using errcode = 'P0001'; end if;

  insert into public.round_end_votes(room_id, round_id, user_id)
  values (p_room_id, round_row.id, p_actor_user_id)
  on conflict (round_id, user_id) do nothing;

  select count(*) into active_players
  from public.room_players
  where room_id = p_room_id and left_at is null;
  required_votes := floor(active_players / 2.0)::integer + 1;

  select count(*) into vote_count
  from public.round_end_votes v
  where v.round_id = round_row.id
    and exists (
      select 1 from public.room_players rp
      where rp.room_id = p_room_id and rp.user_id = v.user_id and rp.left_at is null
    );

  if vote_count >= required_votes then
    perform private.reveal_current_round(p_room_id);
    did_reveal := true;
  end if;

  return jsonb_build_object('voteCount', vote_count, 'requiredVotes', required_votes, 'revealed', did_reveal);
end;
$$;

create or replace function public.replace_unavailable_current_round(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_round_id uuid,
  p_video_id text
) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  current_activity public.social_activity%rowtype;
  replacement public.social_activity%rowtype;
  has_guesses boolean;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then return false; end if;
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = p_actor_user_id and left_at is null
  ) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where id = p_round_id
    and room_id = p_room_id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found or round_row.status <> 'ACTIVE' then return false; end if;

  select * into current_activity from public.social_activity where id = round_row.activity_id;
  if not found or current_activity.video_id <> p_video_id then return false; end if;

  select exists(select 1 from public.guesses where round_id = round_row.id) into has_guesses;
  if has_guesses then return false; end if;

  update public.social_activity
  set available = false
  where provider = current_activity.provider and video_id = current_activity.video_id;

  select sa.* into replacement
  from public.social_activity sa
  join public.room_players rp
    on rp.room_id = p_room_id and rp.user_id = sa.user_id and rp.left_at is null
  where sa.provider = current_activity.provider
    and sa.available = true
    and sa.activity_type = current_activity.activity_type
    and sa.user_id = round_row.source_user_id
    and not exists (
      select 1 from public.rounds used_round
      join public.social_activity used_activity on used_activity.id = used_round.activity_id
      where used_round.room_id = p_room_id
        and used_round.game_number = room_row.game_number
        and used_round.id <> round_row.id
        and used_activity.video_id = sa.video_id
    )
    and (
      (current_activity.import_source = 'fixture' and sa.import_source = 'fixture')
      or (current_activity.import_source <> 'fixture' and sa.import_source <> 'fixture')
    )
  order by random()
  limit 1;

  if not found then
    select sa.* into replacement
    from public.social_activity sa
    join public.room_players rp
      on rp.room_id = p_room_id and rp.user_id = sa.user_id and rp.left_at is null
    where sa.provider = current_activity.provider
      and sa.available = true
      and sa.activity_type = any(room_row.activity_types)
      and not exists (
        select 1 from public.rounds used_round
        join public.social_activity used_activity on used_activity.id = used_round.activity_id
        where used_round.room_id = p_room_id
          and used_round.game_number = room_row.game_number
          and used_round.id <> round_row.id
          and used_activity.video_id = sa.video_id
      )
      and (
        (current_activity.import_source = 'fixture' and sa.import_source = 'fixture')
        or (current_activity.import_source <> 'fixture' and sa.import_source <> 'fixture')
      )
    order by case when sa.user_id = round_row.source_user_id then 0 else 1 end, random()
    limit 1;
  end if;

  if not found then raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001'; end if;

  delete from public.round_end_votes where round_id = round_row.id;
  delete from public.round_playback_starts where round_id = round_row.id;
  delete from public.guesses where round_id = round_row.id;

  update public.rounds
  set source_user_id = replacement.user_id,
      activity_id = replacement.id,
      started_at = null,
      answer_deadline = null,
      revealed_at = null
  where id = round_row.id;

  return true;
end;
$$;

revoke all on function private.calculate_timed_guess_points(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.report_round_playback_started(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_guess_guarded(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.vote_to_end_current_round(uuid, uuid) from public, anon, authenticated;
revoke all on function public.replace_unavailable_current_round(uuid, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.report_round_playback_started(uuid, uuid, uuid, text) to service_role;
grant execute on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) to service_role;
grant execute on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) to service_role;
grant execute on function public.submit_guess_guarded(uuid, uuid, uuid) to service_role;
grant execute on function public.vote_to_end_current_round(uuid, uuid) to service_role;
grant execute on function public.replace_unavailable_current_round(uuid, uuid, uuid, text) to service_role;

-- ===== 0010_remove_playback_sync_and_expand_rounds.sql =====
-- Remove cross-player playback synchronisation and expand the round-count choices.
-- Active rounds now start their timer immediately when the round becomes active.
-- New-room round counts: 10, 20, 30, 50, 100. Legacy 5/15 values remain DB-valid so existing rooms can finish cleanly.

alter table public.rooms drop constraint if exists rooms_round_count_check;
alter table public.rooms add constraint rooms_round_count_check
  check (round_count in (5,10,15,20,30,50,100));

-- Playback synchronisation is no longer part of the game model.
drop function if exists public.report_round_playback_started(uuid, uuid, uuid, text);
drop table if exists public.round_playback_starts;

-- Keep the 1000 -> 500 timed scoring curve introduced in migration 0009.
create or replace function private.calculate_timed_guess_points(
  p_started_at timestamptz,
  p_answer_deadline timestamptz,
  p_submitted_at timestamptz
) returns integer
language plpgsql immutable set search_path = public, private as $$
declare
  duration_seconds double precision;
  remaining_seconds double precision;
  score_value integer;
begin
  if p_answer_deadline is null then
    return 1000;
  end if;

  if p_started_at is null or p_answer_deadline <= p_started_at then
    return 500;
  end if;

  duration_seconds := extract(epoch from (p_answer_deadline - p_started_at));
  remaining_seconds := greatest(0.0, least(duration_seconds, extract(epoch from (p_answer_deadline - p_submitted_at))));

  score_value := round(500.0 + 500.0 * (remaining_seconds / duration_seconds))::integer;
  return greatest(500, least(1000, score_value));
end;
$$;

create or replace function public.commit_game_start(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_game_number integer,
  p_player_ids uuid[],
  p_rounds jsonb
) returns void
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  active_count integer;
  round_count_payload integer;
  first_round_id uuid;
  started_value timestamptz;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.host_user_id <> p_actor_user_id then raise exception 'HOST_ONLY' using errcode = 'P0001'; end if;
  if room_row.status <> 'LOBBY' or room_row.game_number <> p_game_number then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select count(*) into active_count from public.room_players where room_id = p_room_id and left_at is null;
  if active_count < 2 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if active_count <> cardinality(p_player_ids)
     or exists (
       select 1 from public.room_players rp
       where rp.room_id = p_room_id and rp.left_at is null and not (rp.user_id = any(p_player_ids))
     )
     or exists (
       select 1 from unnest(p_player_ids) requested(user_id)
       where not exists (
         select 1 from public.room_players rp
         where rp.room_id = p_room_id and rp.user_id = requested.user_id and rp.left_at is null
       )
     ) then
    raise exception 'PLAYER_SET_CHANGED' using errcode = 'P0001';
  end if;

  round_count_payload := jsonb_array_length(p_rounds);
  if round_count_payload <> room_row.round_count then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rounds) item
    left join public.social_activity sa on sa.id = (item->>'activityId')::uuid
    where sa.id is null
       or sa.user_id <> (item->>'sourceUserId')::uuid
       or sa.available = false
       or not (sa.activity_type = any(room_row.activity_types))
       or not ((item->>'sourceUserId')::uuid = any(p_player_ids))
  ) then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  if (
    select count(distinct sa.video_id)
    from jsonb_array_elements(p_rounds) item
    join public.social_activity sa on sa.id = (item->>'activityId')::uuid
  ) <> round_count_payload then
    raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001';
  end if;

  delete from public.rounds where room_id = p_room_id and game_number = p_game_number;

  insert into public.rounds(room_id, game_number, round_number, source_user_id, activity_id, status)
  select p_room_id,
         p_game_number,
         ordinal::integer,
         (item->>'sourceUserId')::uuid,
         (item->>'activityId')::uuid,
         'PENDING'::public.round_status
  from jsonb_array_elements(p_rounds) with ordinality as input(item, ordinal);

  select id into first_round_id
  from public.rounds
  where room_id = p_room_id and game_number = p_game_number and round_number = 1
  for update;

  update public.room_players set score = 0 where room_id = p_room_id and left_at is null;
  started_value := clock_timestamp();

  update public.rooms
  set status = 'ACTIVE',
      started_at = started_value,
      finished_at = null,
      current_round_number = 1,
      reveal_ends_at = null
  where id = p_room_id;

  update public.rounds
  set status = 'ACTIVE',
      started_at = started_value,
      answer_deadline = case
        when room_row.guess_duration_seconds = 0 then null
        else started_value + make_interval(secs => room_row.guess_duration_seconds)
      end
  where id = first_round_id;
end;
$$;

create or replace function private.advance_after_reveal(p_room_id uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  next_round public.rounds%rowtype;
  started_value timestamptz;
begin
  select * into room_row from public.rooms where id = p_room_id;
  if not found or room_row.status <> 'ACTIVE' then return; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status not in ('REVEAL', 'SKIPPED') then return; end if;

  if round_row.status = 'REVEAL' then
    update public.rounds set status = 'FINISHED' where id = round_row.id and status = 'REVEAL';
  end if;

  if room_row.current_round_number >= room_row.round_count then
    update public.rooms
    set status = 'FINISHED', finished_at = clock_timestamp(), reveal_ends_at = null
    where id = room_row.id;
    return;
  end if;

  select * into next_round
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number + 1
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if next_round.status <> 'PENDING' then return; end if;

  update public.rooms
  set current_round_number = room_row.current_round_number + 1,
      reveal_ends_at = null
  where id = room_row.id;

  started_value := clock_timestamp();
  update public.rounds
  set status = 'ACTIVE',
      started_at = started_value,
      answer_deadline = case
        when room_row.guess_duration_seconds = 0 then null
        else started_value + make_interval(secs => room_row.guess_duration_seconds)
      end
  where id = next_round.id and status = 'PENDING';
end;
$$;

create or replace function public.submit_guess_and_maybe_reveal(
  p_room_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  active_players integer;
  submitted_guesses integer;
  is_correct boolean;
  submitted_at_value timestamptz;
  awarded_points integer;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;

  submitted_at_value := clock_timestamp();
  if round_row.answer_deadline is not null and submitted_at_value >= round_row.answer_deadline then
    raise exception 'DEADLINE_PASSED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessing_user_id and left_at is null) then
    raise exception 'NOT_IN_ROOM' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.room_players where room_id = p_room_id and user_id = p_guessed_user_id and left_at is null) then
    raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001';
  end if;

  select * into selected_activity from public.social_activity where id = round_row.activity_id;
  if not found or selected_activity.available = false then
    raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from public.social_activity candidate
    where candidate.user_id = p_guessed_user_id
      and candidate.provider = selected_activity.provider
      and candidate.video_id = selected_activity.video_id
      and candidate.activity_type = selected_activity.activity_type
      and candidate.available = true
      and (
        (selected_activity.import_source = 'fixture' and candidate.import_source = 'fixture')
        or
        (selected_activity.import_source <> 'fixture' and candidate.import_source <> 'fixture')
      )
  ) into is_correct;

  awarded_points := case when is_correct then private.calculate_timed_guess_points(
    round_row.started_at,
    round_row.answer_deadline,
    submitted_at_value
  ) else 0 end;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, submitted_at, correct, points)
    values (round_row.id, p_guessing_user_id, p_guessed_user_id, submitted_at_value, is_correct, awarded_points)
    returning id into guess_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
  end;

  select count(*) into active_players from public.room_players where room_id = p_room_id and left_at is null;
  select count(*) into submitted_guesses from public.guesses where round_id = round_row.id;
  if submitted_guesses >= active_players then
    perform private.reveal_current_round(p_room_id);
  end if;
  return guess_id;
end;
$$;

create or replace function public.submit_guess_guarded(
  p_round_id uuid,
  p_guessing_user_id uuid,
  p_guessed_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  r public.rounds%rowtype;
  selected_activity public.social_activity%rowtype;
  guess_id uuid;
  is_correct boolean;
  submitted_at_value timestamptz;
  awarded_points integer;
begin
  select * into r from public.rounds where id = p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;

  submitted_at_value := clock_timestamp();
  if r.answer_deadline is not null and submitted_at_value >= r.answer_deadline then
    raise exception 'DEADLINE_PASSED' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessing_user_id and left_at is null) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.room_players where room_id = r.room_id and user_id = p_guessed_user_id and left_at is null) then raise exception 'INVALID_GUESSED_PLAYER' using errcode = 'P0001'; end if;

  select * into selected_activity from public.social_activity where id = r.activity_id;
  if not found or selected_activity.available = false then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;

  select exists (
    select 1
    from public.social_activity candidate
    where candidate.user_id = p_guessed_user_id
      and candidate.provider = selected_activity.provider
      and candidate.video_id = selected_activity.video_id
      and candidate.activity_type = selected_activity.activity_type
      and candidate.available = true
      and (
        (selected_activity.import_source = 'fixture' and candidate.import_source = 'fixture')
        or
        (selected_activity.import_source <> 'fixture' and candidate.import_source <> 'fixture')
      )
  ) into is_correct;

  awarded_points := case when is_correct then private.calculate_timed_guess_points(
    r.started_at,
    r.answer_deadline,
    submitted_at_value
  ) else 0 end;

  begin
    insert into public.guesses(round_id, guessing_user_id, guessed_user_id, submitted_at, correct, points)
    values (r.id, p_guessing_user_id, p_guessed_user_id, submitted_at_value, is_correct, awarded_points)
    returning id into guess_id;
  exception when unique_violation then
    raise exception 'DUPLICATE_GUESS' using errcode = 'P0001';
  end;
  return guess_id;
end;
$$;

create or replace function public.vote_to_end_current_round(
  p_room_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  active_players integer;
  vote_count integer;
  required_votes integer;
  did_reveal boolean := false;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = p_actor_user_id and left_at is null
  ) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where room_id = room_row.id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if round_row.status <> 'ACTIVE' then raise exception 'ROUND_CLOSED' using errcode = 'P0001'; end if;

  insert into public.round_end_votes(room_id, round_id, user_id)
  values (p_room_id, round_row.id, p_actor_user_id)
  on conflict (round_id, user_id) do nothing;

  select count(*) into active_players
  from public.room_players
  where room_id = p_room_id and left_at is null;
  required_votes := floor(active_players / 2.0)::integer + 1;

  select count(*) into vote_count
  from public.round_end_votes v
  where v.round_id = round_row.id
    and exists (
      select 1 from public.room_players rp
      where rp.room_id = p_room_id and rp.user_id = v.user_id and rp.left_at is null
    );

  if vote_count >= required_votes then
    perform private.reveal_current_round(p_room_id);
    did_reveal := true;
  end if;

  return jsonb_build_object('voteCount', vote_count, 'requiredVotes', required_votes, 'revealed', did_reveal);
end;
$$;

create or replace function public.replace_unavailable_current_round(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_round_id uuid,
  p_video_id text
) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  current_activity public.social_activity%rowtype;
  replacement public.social_activity%rowtype;
  has_guesses boolean;
  started_value timestamptz;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001'; end if;
  if room_row.status <> 'ACTIVE' then return false; end if;
  if not exists (
    select 1 from public.room_players
    where room_id = p_room_id and user_id = p_actor_user_id and left_at is null
  ) then raise exception 'NOT_IN_ROOM' using errcode = 'P0001'; end if;

  select * into round_row
  from public.rounds
  where id = p_round_id
    and room_id = p_room_id
    and game_number = room_row.game_number
    and round_number = room_row.current_round_number
  for update;
  if not found or round_row.status <> 'ACTIVE' then return false; end if;

  select * into current_activity from public.social_activity where id = round_row.activity_id;
  if not found or current_activity.video_id <> p_video_id then return false; end if;

  select exists(select 1 from public.guesses where round_id = round_row.id) into has_guesses;
  if has_guesses then return false; end if;

  update public.social_activity
  set available = false
  where provider = current_activity.provider and video_id = current_activity.video_id;

  select sa.* into replacement
  from public.social_activity sa
  join public.room_players rp
    on rp.room_id = p_room_id and rp.user_id = sa.user_id and rp.left_at is null
  where sa.provider = current_activity.provider
    and sa.available = true
    and sa.activity_type = current_activity.activity_type
    and sa.user_id = round_row.source_user_id
    and not exists (
      select 1 from public.rounds used_round
      join public.social_activity used_activity on used_activity.id = used_round.activity_id
      where used_round.room_id = p_room_id
        and used_round.game_number = room_row.game_number
        and used_round.id <> round_row.id
        and used_activity.video_id = sa.video_id
    )
    and (
      (current_activity.import_source = 'fixture' and sa.import_source = 'fixture')
      or (current_activity.import_source <> 'fixture' and sa.import_source <> 'fixture')
    )
  order by random()
  limit 1;

  if not found then
    select sa.* into replacement
    from public.social_activity sa
    join public.room_players rp
      on rp.room_id = p_room_id and rp.user_id = sa.user_id and rp.left_at is null
    where sa.provider = current_activity.provider
      and sa.available = true
      and sa.activity_type = any(room_row.activity_types)
      and not exists (
        select 1 from public.rounds used_round
        join public.social_activity used_activity on used_activity.id = used_round.activity_id
        where used_round.room_id = p_room_id
          and used_round.game_number = room_row.game_number
          and used_round.id <> round_row.id
          and used_activity.video_id = sa.video_id
      )
      and (
        (current_activity.import_source = 'fixture' and sa.import_source = 'fixture')
        or (current_activity.import_source <> 'fixture' and sa.import_source <> 'fixture')
      )
    order by case when sa.user_id = round_row.source_user_id then 0 else 1 end, random()
    limit 1;
  end if;

  if not found then raise exception 'INSUFFICIENT_ACTIVITY' using errcode = 'P0001'; end if;

  delete from public.round_end_votes where round_id = round_row.id;
  delete from public.guesses where round_id = round_row.id;

  started_value := clock_timestamp();
  update public.rounds
  set source_user_id = replacement.user_id,
      activity_id = replacement.id,
      started_at = started_value,
      answer_deadline = case
        when room_row.guess_duration_seconds = 0 then null
        else started_value + make_interval(secs => room_row.guess_duration_seconds)
      end,
      revealed_at = null
  where id = round_row.id;

  return true;
end;
$$;

revoke all on function private.calculate_timed_guess_points(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_guess_guarded(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.vote_to_end_current_round(uuid, uuid) from public, anon, authenticated;
revoke all on function public.replace_unavailable_current_round(uuid, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.commit_game_start(uuid, uuid, integer, uuid[], jsonb) to service_role;
grant execute on function public.submit_guess_and_maybe_reveal(uuid, uuid, uuid) to service_role;
grant execute on function public.submit_guess_guarded(uuid, uuid, uuid) to service_role;
grant execute on function public.vote_to_end_current_round(uuid, uuid) to service_role;
grant execute on function public.replace_unavailable_current_round(uuid, uuid, uuid, text) to service_role;

